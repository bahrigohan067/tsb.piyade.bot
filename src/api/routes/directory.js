/**
 * Kayıtlı Üye Rehberi (Directory) REST API Rotaları
 * Site üzerindeki "Sohbet" özelliği için yalnızca sunucudaki kayıtlı ve bot olmayan üyelerin
 * herkese açık/güvenli rehber bilgilerini döndürür.
 *
 * Güvenlik ve Gizlilik Kuralları:
 * - Bearer API_SECRET (server.js) + X-Actor-Id (requireActor) doğrulaması zorunludur.
 * - Aktör başına dakikada en çok 60 istek (429 RATE_LIMITED).
 * - Yalnızca izin verilen 7 alan döndürülür: id, displayName, discordAvatarUrl,
 *   robloxId, robloxUsername, robloxAvatarUrl, hasRoblox.
 * - Cinsiyet, gerçek ad, oyun listesi, roller veya iç veriler ASLA döndürülmez.
 * - Konsola hiçbir kullanıcı kimliği, adı veya arama sorgusu yazılmaz.
 */

const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const robloxService = require('../../services/roblox');
const { ACTOR_TYPES, requireActor } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { sanitizeTextInput } = require('../../utils/inputSanitizer');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_QUERY_LEN = 40;
const MAX_LOOKUP_IDS = 100;
const MAX_CURSOR_LEN = 256;
const DIRECTORY_CACHE_TTL_MS = 30 * 1000; // 30 saniye bellek önbelleği
const COLD_FETCH_COOLDOWN_MS = 5 * 60 * 1000; // Soğuk önbellek için 5 dk fetch bekleme süresi
const LOOKUP_SINGLE_FETCH_CAP = 25; // lookup isteği başına en çok tekil üye fetch sınırı
const LOOKUP_MISS_CACHE_TTL_MS = 5 * 60 * 1000; // Sunucuda olmayan ID için 5 dk negatif önbellek

// Aktör başına hız sınırı: discord 60/dk, site-service 120/dk
const directoryRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: (req) => (req.actorType === ACTOR_TYPES.SITE_SERVICE ? 120 : 60),
  code: 'RATE_LIMITED',
  message: 'Rehber istek sınırı aşıldı. Lütfen kısa süre sonra tekrar deneyin.',
  keyGenerator: (req) =>
    `${req.actorType || ACTOR_TYPES.DISCORD}:${req.actorId || req.headers['x-actor-id'] || req.ip || 'anonymous'}`,
});

// Bellek içi önbellek ve soğuk önbellek fetch durumları
const directorySnapshotCache = new Map(); // Map<guildId, { entries: Array, expiresAt: number }>
const coldFetchStateByGuild = new Map();  // Map<guildId, { lastFetchAt: number, inFlight: Promise|null }>
const lookupMissCache = new Map();        // Map<`${guildId}:${uid}`, number (expiresAt)>

function clearDirectoryCache(guildId = null) {
  if (guildId) {
    const gid = String(guildId);
    directorySnapshotCache.delete(gid);
    coldFetchStateByGuild.delete(gid);
    for (const key of lookupMissCache.keys()) {
      if (key.startsWith(`${gid}:`)) {
        lookupMissCache.delete(key);
      }
    }
  } else {
    directorySnapshotCache.clear();
    coldFetchStateByGuild.clear();
    lookupMissCache.clear();
  }
}

function clearDirectoryMemberCache(userId = null) {
  // Üye ayrıldığında tüm 30 sn rehber anlık görüntüsünü tazele
  directorySnapshotCache.clear();
  if (userId) {
    const suffix = `:${String(userId)}`;
    for (const key of lookupMissCache.keys()) {
      if (key.endsWith(suffix)) {
        lookupMissCache.delete(key);
      }
    }
  }
}

function resetDirectoryRateLimiter() {
  if (typeof directoryRateLimiter.reset === 'function') {
    directoryRateLimiter.reset();
  }
}

// Veritabanı güncellendiğinde (yeni kayıt, kayıt sıfırlama vb.) 30 sn rehber önbelleğini temizle
if (typeof database.onSaveResult === 'function') {
  database.onSaveResult(() => {
    directorySnapshotCache.clear();
  });
}

/**
 * Türkçe ve İngilizce harf/aksan farkına duyarsız arama ve sıralama için metni normalleştirir.
 * Örn: "Şule" -> "sule", "IŞIK" / "İşık" -> "isik", "Çağrı" -> "cagri", "Özgür" -> "ozgur"
 */
function normalizeTurkishSearch(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * İki (sortKey, id) çiftini kararlı alfabetik sırayla karşılaştırır.
 */
function compareSortKeyAndId(aKey, aId, bKey, bId) {
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * Kararlı keyset sayfalama imlecini (base64url) kodlar.
 */
function encodeCursor(sortKey, id) {
  return Buffer.from(JSON.stringify({ k: String(sortKey), id: String(id) }), 'utf8').toString('base64url');
}

/**
 * Sayfalama imlecini doğrular ve çözer; geçersizse null döner.
 */
function decodeCursor(rawCursor) {
  if (typeof rawCursor !== 'string') return null;
  const trimmed = rawCursor.trim();
  if (!trimmed || trimmed.length > MAX_CURSOR_LEN) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(trimmed, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.k !== 'string' || typeof parsed.id !== 'string') return null;
    if (!/^\d{1,21}$/.test(parsed.id)) return null;
    if (parsed.k.length > 128) return null;
    return { k: parsed.k, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Üyenin Discord avatar URL'sini (128 px png) güvenli şekilde üretir.
 */
function resolveDiscordAvatarUrl(member) {
  if (!member) return null;
  const opts = { extension: 'png', size: 128, forceStatic: true };
  if (typeof member.displayAvatarURL === 'function') {
    return member.displayAvatarURL(opts) || null;
  }
  if (typeof member.user?.displayAvatarURL === 'function') {
    return member.user.displayAvatarURL(opts) || null;
  }
  return null;
}

/**
 * Kayıt kaydından yalnızca izin verilen Roblox kimlik/kullanıcı adı bilgisini okur.
 */
function extractRobloxFromRegistration(reg) {
  if (!reg || typeof reg !== 'object') {
    return { robloxId: null, robloxUsername: null, hasRoblox: false };
  }

  let robloxEntry = null;
  if (Array.isArray(reg.games)) {
    robloxEntry = reg.games.find((g) => g && String(g.id).toLowerCase() === 'roblox') || null;
  }

  const rawId = robloxEntry?.robloxId || reg.robloxId || null;
  const cleanId = rawId !== null && rawId !== undefined ? String(rawId).trim() : '';
  const robloxId = /^\d{1,20}$/.test(cleanId) ? cleanId : null;

  const rawName = robloxEntry?.username || reg.robloxUsername || null;
  const cleanName = typeof rawName === 'string' ? rawName.trim() : '';
  const robloxUsername = cleanName ? cleanName : null;

  return {
    robloxId,
    robloxUsername,
    hasRoblox: Boolean(robloxId || robloxUsername),
  };
}

/**
 * Tek bir kayıtlı üye için iç sıralama/arama önbellek nesnesi oluşturur.
 */
function buildBaseDirectoryEntry(member, reg) {
  const id = String(member.id);
  const displayName = String(
    member.displayName || member.user?.globalName || member.user?.username || id
  ).trim() || id;
  const discordAvatarUrl = resolveDiscordAvatarUrl(member);
  const { robloxId, robloxUsername, hasRoblox } = extractRobloxFromRegistration(reg);

  return {
    id,
    displayName,
    discordAvatarUrl,
    robloxId,
    robloxUsername,
    hasRoblox,
    _sortKey: normalizeTurkishSearch(displayName),
    _robloxNorm: robloxUsername ? normalizeTurkishSearch(robloxUsername) : '',
  };
}

/**
 * Dışarıya dönecek tam 7 alanlı (fazladan alan sızdırmayan) rehber öğesini oluşturur.
 */
function toPublicDirectoryItem(baseEntry, avatarMap) {
  const robloxAvatarUrl =
    baseEntry.robloxId && avatarMap instanceof Map
      ? avatarMap.get(baseEntry.robloxId) || null
      : null;

  return {
    id: baseEntry.id,
    displayName: baseEntry.displayName,
    discordAvatarUrl: baseEntry.discordAvatarUrl,
    robloxId: baseEntry.robloxId,
    robloxUsername: baseEntry.robloxUsername,
    robloxAvatarUrl,
    hasRoblox: baseEntry.hasRoblox,
  };
}

/**
 * Üye önbelleği soğuksa (boş veya sunucunun yarısından azı önbellekteyse)
 * cooldown (5 dk) ve tek-uçuş (in-flight) korumasıyla tek seferlik fetch yapar.
 * Her istekte tüm üyeleri ASLA çekmez.
 */
async function ensureGuildMembersWarm(guild, now = Date.now()) {
  if (!guild || !guild.members?.cache) return;
  if (typeof guild.members.fetch !== 'function') return;

  const cacheSize = guild.members.cache.size || 0;
  const expectedCount =
    typeof guild.memberCount === 'number' && Number.isFinite(guild.memberCount)
      ? guild.memberCount
      : 0;

  const isCold =
    cacheSize === 0 || (expectedCount > 1 && cacheSize < Math.ceil(expectedCount * 0.5));
  if (!isCold) return;

  const gid = String(guild.id || 'default');
  let state = coldFetchStateByGuild.get(gid);
  if (!state) {
    state = { lastFetchAt: 0, inFlight: null };
    coldFetchStateByGuild.set(gid, state);
  }

  if (state.inFlight) {
    await state.inFlight;
    return;
  }

  if (state.lastFetchAt > 0 && now - state.lastFetchAt < COLD_FETCH_COOLDOWN_MS) {
    return;
  }

  state.lastFetchAt = now;
  state.inFlight = Promise.resolve()
    .then(() => guild.members.fetch())
    .catch(() => null)
    .finally(() => {
      state.inFlight = null;
    });

  await state.inFlight;
}

/**
 * Sunucudaki kayıtlı, bot olmayan üyelerin alfabetik sıralı 30 sn önbellekli temel listesini döndürür.
 */
async function getDirectorySnapshot(guild, { db = database, now = Date.now() } = {}) {
  const gid = String(guild.id || 'default');
  const cached = directorySnapshotCache.get(gid);
  if (cached && cached.expiresAt > now) {
    return cached.entries;
  }

  await ensureGuildMembersWarm(guild, now);

  // Kayıt tablosunu tek geçişte Discord ID -> kayıt haritasına al (O(N))
  const regByDiscordId = new Map();
  const allRegs = typeof db.getAllRegistrations === 'function' ? db.getAllRegistrations() : [];
  for (const reg of allRegs) {
    if (reg && reg.discordId) {
      regByDiscordId.set(String(reg.discordId), reg);
    }
  }

  const entries = [];
  for (const member of guild.members.cache.values()) {
    if (!member || !member.id) continue;
    if (member.user?.bot) continue;
    if (!config.isRegisteredMember(member)) continue;

    const reg = regByDiscordId.get(String(member.id)) || null;
    entries.push(buildBaseDirectoryEntry(member, reg));
  }

  entries.sort((a, b) => compareSortKeyAndId(a._sortKey, a.id, b._sortKey, b.id));

  directorySnapshotCache.set(gid, {
    entries,
    expiresAt: now + DIRECTORY_CACHE_TTL_MS,
  });

  return entries;
}

// Tüm /api/directory uçları için X-Actor-Id doğrulaması ve aktör başına 60/dk hız sınırı
router.use(requireActor, directoryRateLimiter);

/**
 * GET /api/directory?query=&limit=&cursor=&excludeSelf=1
 * Yalnızca kayıtlı, sunucuda bulunan ve bot olmayan üyeleri alfabetik ve cursor sayfalamalı döndürür.
 */
router.get('/', async (req, res) => {
  // 1. Sorgu (query) doğrulama ve temizleme (en çok 40 karakter)
  const rawQueryParam = req.query?.query;
  if (rawQueryParam !== undefined && typeof rawQueryParam !== 'string') {
    return res.status(400).json({
      error: 'Geçersiz arama sorgusu (query) parametresi.',
      code: 'INVALID_QUERY',
    });
  }
  if (typeof rawQueryParam === 'string' && rawQueryParam.length > 200) {
    return res.status(400).json({
      error: `Arama sorgusu en fazla ${MAX_QUERY_LEN} karakter olabilir.`,
      code: 'QUERY_TOO_LONG',
    });
  }
  const cleanedQuery = sanitizeTextInput(rawQueryParam || '');
  if (cleanedQuery.length > MAX_QUERY_LEN) {
    return res.status(400).json({
      error: `Arama sorgusu en fazla ${MAX_QUERY_LEN} karakter olabilir.`,
      code: 'QUERY_TOO_LONG',
    });
  }
  const normalizedQuery = normalizeTurkishSearch(cleanedQuery);

  // 2. Limit doğrulama (varsayılan 30, en çok 50)
  let limit = DEFAULT_LIMIT;
  const rawLimitParam = req.query?.limit;
  if (rawLimitParam !== undefined && rawLimitParam !== '') {
    if (typeof rawLimitParam !== 'string' || !/^\d+$/.test(rawLimitParam.trim())) {
      return res.status(400).json({
        error: 'Geçersiz limit parametresi (pozitif tam sayı olmalıdır).',
        code: 'INVALID_LIMIT',
      });
    }
    const parsedLimit = Number.parseInt(rawLimitParam.trim(), 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({
        error: 'Limit en az 1 olmalıdır.',
        code: 'INVALID_LIMIT',
      });
    }
    limit = Math.min(MAX_LIMIT, parsedLimit);
  }

  // 3. Cursor doğrulama
  let decodedCursor = null;
  const rawCursorParam = req.query?.cursor;
  if (rawCursorParam !== undefined && rawCursorParam !== '') {
    decodedCursor = decodeCursor(rawCursorParam);
    if (!decodedCursor) {
      return res.status(400).json({
        error: 'Geçersiz sayfalama imleci (cursor).',
        code: 'INVALID_CURSOR',
      });
    }
  }

  // 4. excludeSelf parametresi
  const rawExcludeSelf = req.query?.excludeSelf;
  if (rawExcludeSelf !== undefined && typeof rawExcludeSelf !== 'string') {
    return res.status(400).json({
      error: 'Geçersiz excludeSelf parametresi.',
      code: 'INVALID_PARAM',
    });
  }
  const excludeSelf = rawExcludeSelf === '1' || rawExcludeSelf === 'true';
  const actorId = String(req.actorId || req.actorMember?.id || '');

  try {
    if (!req.guild) {
      return res.status(503).json({
        error: 'Discord sunucusu henüz hazır değil veya önbelleğe alınamadı.',
        code: 'GUILD_UNAVAILABLE',
      });
    }

    const allEntries = await getDirectorySnapshot(req.guild);

    // Filtreleme: excludeSelf + Türkçe/İngilizce harf farkına duyarsız içerir araması
    const filtered = allEntries.filter((entry) => {
      if (excludeSelf && entry.id === actorId) return false;
      if (!normalizedQuery) return true;
      return (
        entry._sortKey.includes(normalizedQuery) ||
        (entry._robloxNorm && entry._robloxNorm.includes(normalizedQuery))
      );
    });

    const total = filtered.length;

    // Kararlı keyset cursor uygulaması
    const afterCursor = decodedCursor
      ? filtered.filter(
          (entry) => compareSortKeyAndId(entry._sortKey, entry.id, decodedCursor.k, decodedCursor.id) > 0
        )
      : filtered;

    const hasMore = afterCursor.length > limit;
    const pageBase = afterCursor.slice(0, limit);
    const nextCursor =
      hasMore && pageBase.length > 0
        ? encodeCursor(pageBase[pageBase.length - 1]._sortKey, pageBase[pageBase.length - 1].id)
        : null;

    // Yalnızca dönen sayfadaki Roblox ID'leri için toplu avatar başlıklarını (6 sa önbellekli) çek
    const pageRobloxIds = pageBase.map((e) => e.robloxId).filter(Boolean);
    const avatarMap =
      pageRobloxIds.length > 0
        ? await robloxService.getAvatarHeadshots(pageRobloxIds)
        : new Map();

    const items = pageBase.map((entry) => toPublicDirectoryItem(entry, avatarMap));

    return res.json({
      items,
      nextCursor,
      hasMore,
      total,
    });
  } catch {
    return res.status(500).json({
      error: 'Üye rehberi alınırken beklenmedik bir hata oluştu.',
      code: 'DIRECTORY_FETCH_FAILED',
    });
  }
});

/**
 * Kayıt kaydından yalnızca site-service includeGames: true isteği için sade { id, username } oyun listesi çıkarır.
 * Eski kayıtlarda games yoksa database.normalizeGamesForRead üzerinden robloxUsername'i okuma sırasında dönüştürür.
 */
function extractPublicGamesForService(reg) {
  if (!reg || typeof reg !== 'object') return [];
  const normalizedGames = Array.isArray(reg.games)
    ? reg.games
    : typeof database.normalizeGamesForRead === 'function'
      ? database.normalizeGamesForRead(reg)
      : [];

  const result = [];
  const seen = new Set();
  for (const g of normalizedGames) {
    if (!g || !g.id || !g.username) continue;
    const id = String(g.id).trim().toLowerCase();
    const username = String(g.username).trim();
    if (!id || !username || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, username });
  }
  return result;
}

/**
 * POST /api/directory/lookup
 * Gövde: { ids: [en çok 100 Discord ID], includeGames?: boolean }
 * Verilen Discord ID'leri arasından yalnızca kayıtlı, sunucuda bulunan ve bot olmayan üyeleri
 * İSTEK SIRASIYLA ve aynı 7 alanla döndürür.
 * Not: includeGames: true yalnızca site-service aktöründe geçerlidir; diğer aktörlerde games alanı ASLA eklenmez.
 */
router.post('/lookup', async (req, res) => {
  const rawIds = req.body?.ids;
  if (!Array.isArray(rawIds)) {
    return res.status(400).json({
      error: 'İstek gövdesinde "ids" alanı bir Discord ID dizisi olmalıdır.',
      code: 'INVALID_IDS',
    });
  }

  if (rawIds.length > MAX_LOOKUP_IDS) {
    return res.status(400).json({
      error: `Tek seferde en çok ${MAX_LOOKUP_IDS} Discord ID sorgulanabilir.`,
      code: 'TOO_MANY_IDS',
    });
  }

  // Tüm ID'leri doğrula ve ilk görülme sırasını koruyarak tekilleştir
  const orderedIds = [];
  const seenIds = new Set();
  for (const item of rawIds) {
    if (typeof item !== 'string') {
      return res.status(400).json({
        error: 'Her Discord ID yalnızca rakamlardan oluşan bir metin olmalıdır.',
        code: 'INVALID_ID_FORMAT',
      });
    }
    const cleanId = item.trim();
    if (!/^\d{1,21}$/.test(cleanId)) {
      return res.status(400).json({
        error: 'Geçersiz Discord ID formatı.',
        code: 'INVALID_ID_FORMAT',
      });
    }
    if (!seenIds.has(cleanId)) {
      seenIds.add(cleanId);
      orderedIds.push(cleanId);
    }
  }

  if (orderedIds.length === 0) {
    return res.json({ items: [] });
  }

  // includeGames: true yalnızca site-service aktörü için etkindir
  const includeGames = req.body?.includeGames === true && req.actorType === ACTOR_TYPES.SITE_SERVICE;

  try {
    if (!req.guild) {
      return res.status(503).json({
        error: 'Discord sunucusu henüz hazır değil veya önbelleğe alınamadı.',
        code: 'GUILD_UNAVAILABLE',
      });
    }

    const now = Date.now();
    await ensureGuildMembersWarm(req.guild, now);

    const gid = String(req.guild.id || 'default');
    let singleFetches = 0;
    const matchedEntries = [];

    for (const uid of orderedIds) {
      let member = req.guild.members.cache.get(uid) || null;

      if (!member && typeof req.guild.members.fetch === 'function') {
        const missKey = `${gid}:${uid}`;
        const missUntil = lookupMissCache.get(missKey) || 0;
        if (now >= missUntil && singleFetches < LOOKUP_SINGLE_FETCH_CAP) {
          singleFetches += 1;
          member = await req.guild.members.fetch(uid).catch(() => null);
          if (!member) {
            lookupMissCache.set(missKey, now + LOOKUP_MISS_CACHE_TTL_MS);
          }
        }
      }

      // Sunucudan ayrılanları, botları ve kayıtlı olmayanları sessizce atla
      if (!member || member.user?.bot || !config.isRegisteredMember(member)) {
        continue;
      }

      const reg = database.getRegistrationByDiscordId(uid);
      matchedEntries.push({
        base: buildBaseDirectoryEntry(member, reg),
        games: includeGames ? extractPublicGamesForService(reg) : null,
      });
    }

    const robloxIds = matchedEntries.map((e) => e.base.robloxId).filter(Boolean);
    const avatarMap =
      robloxIds.length > 0
        ? await robloxService.getAvatarHeadshots(robloxIds)
        : new Map();

    const items = matchedEntries.map(({ base, games }) => {
      const publicItem = toPublicDirectoryItem(base, avatarMap);
      if (includeGames) {
        publicItem.games = games;
      }
      return publicItem;
    });

    return res.json({ items });
  } catch {
    return res.status(500).json({
      error: 'Üye bilgileri sorgulanırken beklenmedik bir hata oluştu.',
      code: 'DIRECTORY_LOOKUP_FAILED',
    });
  }
});

module.exports = router;
module.exports.normalizeTurkishSearch = normalizeTurkishSearch;
module.exports.encodeCursor = encodeCursor;
module.exports.decodeCursor = decodeCursor;
module.exports.clearDirectoryCache = clearDirectoryCache;
module.exports.clearDirectoryMemberCache = clearDirectoryMemberCache;
module.exports.resetDirectoryRateLimiter = resetDirectoryRateLimiter;
module.exports.DIRECTORY_CACHE_TTL_MS = DIRECTORY_CACHE_TTL_MS;
module.exports.COLD_FETCH_COOLDOWN_MS = COLD_FETCH_COOLDOWN_MS;
module.exports.MAX_LOOKUP_IDS = MAX_LOOKUP_IDS;
module.exports.MAX_QUERY_LEN = MAX_QUERY_LEN;
module.exports.MAX_LIMIT = MAX_LIMIT;
module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
