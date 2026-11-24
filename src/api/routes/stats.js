const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const activityTracker = require('../../utils/activityTracker');
const activityConfig = require('../../../activity.config');

const TOP_GAMES_CACHE_TTL_MS = activityConfig.STATS_CACHE_TTL_MS || 60 * 1000;
const SUMMARY_CACHE_TTL_MS = activityConfig.STATS_CACHE_TTL_MS || 60 * 1000;

const topGamesCache = new Map();
let summaryCache = null;

// Önbellekte olmayan üyelerin sunucuda olup olmadığını doğrulamak için sınırlı bellek önbelleği (1 saat TTL)
// ve kullanıcı başına 10 dk bekleme süresi haritası (tam üye listesi REST çağrısı ASLA yapılmaz)
const defaultMemberLookupState = {
  cache: new Map(),     // Map<uid, { inGuild: boolean, isBot: boolean, hasRegisteredRole: boolean, fetchedAt: number }>
  cooldowns: new Map(), // Map<uid, number>
};

function clearTopGamesCache() {
  topGamesCache.clear();
}

function clearSummaryCache() {
  summaryCache = null;
}

function clearMemberLookupCache(userId = null, state = defaultMemberLookupState) {
  if (!state) return;
  if (userId) {
    const uid = String(userId);
    state.cache.delete(uid);
    state.cooldowns.delete(uid);
  } else {
    state.cache.clear();
    state.cooldowns.clear();
  }
}

// Veritabanı her diske yazıldığında (checkpoint, aylık sıfırlama, yeni kayıt onayı, takip kapatma vb.) önbelleği tazele
if (typeof database.onSaveResult === 'function') {
  database.onSaveResult(() => {
    clearTopGamesCache();
    clearSummaryCache();
  });
}

/**
 * Discord hata nesnesinin "üye sunucuda değil" (10007 / 404) anlamına gelip gelmediğini kontrol eder.
 */
function isUnknownMemberError(err) {
  if (!err) return false;
  const code = err.code ?? err.status;
  if (code === 10007 || code === 404) return true;
  return /unknown member/i.test(String(err.message || ''));
}

/**
 * Sunucu geneli anonim en çok oynanan oyunlar sıralamasını hesaplar.
 * - Aile gruplaması tek merkezi activityConfig.groupStatsByFamily üzerinden yapılır (saklama biçimi DEĞİŞMEZ).
 * - Tüm Roblox oyunları (roblox_unknown + GAMES içindeki family:'roblox' kayıtları) tek "Roblox" satırında toplanır.
 * - Minecraft, CS2 ve Zula kendi satırlarında kalır; ad/emoji yalnızca activity.config.js'ten okunur.
 * - Geriye dönük uyumluluk için hem yeni `families` hem eski `games` alanı birlikte döndürülür.
 * - Hiçbir koşulda kullanıcı ID'si veya kullanıcı adı içermez.
 */
function computeTopGamesStats({
  scope = 'month',
  limit = 8,
  lang = 'tr',
  group = 'family',
  db = database,
  tracker = activityTracker,
  cfg = activityConfig,
  showBreakdown = null,
  nowMs = null,
} = {}) {
  const cleanScope = scope === 'all' ? 'all' : 'month';
  const cleanLang = lang === 'en' ? 'en' : 'tr';
  const rawLimit = Number.parseInt(String(limit ?? 8), 10);
  const cleanLimit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 8;
  const now =
    typeof nowMs === 'number' && Number.isFinite(nowMs)
      ? nowMs
      : typeof tracker?.now === 'function'
        ? tracker.now()
        : Date.now();

  const month = db.data.activityStats?.month || db.getCurrentIstanbulMonth();
  const allTimeInfo = db.getActivityAllTimeStats();
  const since = allTimeInfo.since;

  // 1. Bu ayın takip açık üyelerinin oyun sürelerini (canlı unsavedSec dahil) topla
  const currentMonthByUser = new Map();
  const rawUsers = db.data.activityStats?.users;
  if (rawUsers && typeof rawUsers === 'object') {
    for (const [uid, userObj] of Object.entries(rawUsers)) {
      if (!db.isActivityTrackingEnabled(uid)) continue;
      const userGames = userObj?.games;
      if (!userGames || typeof userGames !== 'object') continue;

      const gameMap = {};
      for (const [gid, rawSec] of Object.entries(userGames)) {
        const sec = Math.floor(Number(rawSec));
        if (gid && Number.isFinite(sec) && sec > 0) {
          gameMap[String(gid)] = sec;
        }
      }
      if (Object.keys(gameMap).length > 0) {
        currentMonthByUser.set(String(uid), gameMap);
      }
    }
  }

  // Canlı oturumdaki henüz checkpoint ile yazılmamış saniyeleri (boşluk ve B3 sınırlı unsavedSec) ekle
  if (tracker && tracker.sessions instanceof Map && typeof tracker.getLivePlayingInfo === 'function') {
    for (const uid of tracker.sessions.keys()) {
      const cleanUid = String(uid);
      if (!db.isActivityTrackingEnabled(cleanUid)) continue;
      const liveInfo = tracker.getLivePlayingInfo(cleanUid);
      if (!liveInfo || !liveInfo.gameId || !(liveInfo.unsavedSec > 0)) continue;

      const existing = currentMonthByUser.get(cleanUid) || {};
      const gid = String(liveInfo.gameId);
      existing[gid] = (Number(existing[gid]) || 0) + Math.floor(Number(liveInfo.unsavedSec));
      currentMonthByUser.set(cleanUid, existing);
    }
  }

  // 2. Tek merkezi aile gruplaması (Roblox tüm alt oyunlarıyla tek "Roblox" başlığında toplanır)
  const groupFn = cfg.groupStatsByFamily || activityConfig.groupStatsByFamily;
  const grouped = groupFn(currentMonthByUser, {
    cfg,
    lang: cleanLang,
    showBreakdown,
    limit: cleanLimit,
    extraGameTotals: cleanScope === 'all' ? allTimeInfo.games || {} : null,
  });

  // Yeni sözleşme alanı: families
  const families = grouped.families.map((item) => ({
    key: item.key,
    label: item.label,
    emoji: item.emoji,
    totalSeconds: item.totalSeconds,
    uniquePlayers: item.uniquePlayers,
    rank: item.rank,
    percent: item.percent,
    hours: item.hours,
    formattedDuration: item.formattedDuration,
    ...(item.breakdown ? { breakdown: item.breakdown } : {}),
  }));

  // Geriye dönük uyumluluk alanı: games (eski site de otomatik olarak gruplanmış "Roblox" görür)
  const games = grouped.families.map((item) => ({
    id: item.key,
    name: item.label,
    emoji: item.emoji,
    family: item.family,
    seconds: item.totalSeconds,
    hours: item.hours,
    percent: item.percent,
    players: item.uniquePlayers,
    rank: item.rank,
    formattedDuration: item.formattedDuration,
    ...(item.breakdown ? { breakdown: item.breakdown } : {}),
  }));

  return {
    scope: cleanScope,
    group: group === 'family' ? 'family' : 'family',
    month,
    since,
    updatedAt: now,
    computedAt: new Date(now).toISOString(),
    totalSeconds: grouped.totalSeconds,
    families,
    games,
  };
}

/**
 * GET /api/stats/top-games?scope=month|all&limit=8&lang=tr|en&group=family
 * Sunucuda en çok oynanan oyunların anonim sıralamasını döndürür (60 sn bellek önbellekli).
 */
router.get('/top-games', (req, res) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'month';
    const lang = req.query.lang === 'en' ? 'en' : 'tr';
    const rawLimit = Number.parseInt(String(req.query.limit ?? 8), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 8;
    const month = database.data.activityStats?.month || database.getCurrentIstanbulMonth();
    const breakdownFlag = Boolean(activityConfig.SHOW_FAMILY_BREAKDOWN === true);

    const cacheKey = `${scope}:${lang}:${limit}:${month}:${breakdownFlag ? 1 : 0}`;
    const now = Date.now();
    const cached = topGamesCache.get(cacheKey);
    if (cached && now - cached.at < TOP_GAMES_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const payload = computeTopGamesStats({ scope, limit, lang });
    topGamesCache.set(cacheKey, { at: now, payload });

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: `Oyun istatistikleri alınırken hata oluştu: ${err.message}` });
  }
});

/**
 * Sunucu geneli anonim aktif oyuncu ve şu an oyunda özetini hesaplar.
 * - activeThisMonth: KAYITLI VE sunucuda HÂLÂ bulunan VE bot olmayan VE takibi AÇIK VE bu ay
 *   en az MIN_ACTIVE_MINUTES (varsayılan 1) dakika süresi olan BENZERSİZ üye sayısı.
 * - playingNow: KAYITLI VE sunucuda HÂLÂ bulunan VE bot olmayan VE takibi AÇIK VE
 *   canlı Discord presence verisiyle doğrulanan onaylı (CONFIRM_SEC geçmiş) oyun oturumu olan BENZERSİZ üye sayısı.
 * - uncertainCount: Önbellekte/fetch sınırında doğrulanamayan veya canlı presence verisi eksik olan benzersiz üye sayısı.
 * - Tam üye listesi için toplu REST çağrısı ASLA yapılmaz; önbellekte olmayan en çok SAYIM_MEMBER_LOOKUP_CAP (25)
 *   üye saatlik önbellek ve kullanıcı başına 10 dk bekleme süresiyle doğrulanır.
 * - Hiçbir kullanıcı ID'si veya kullanıcı adı döndürmez.
 */
async function computeServerStatsSummary({
  guild = null,
  db = database,
  tracker = activityTracker,
  cfg = activityConfig,
  nowMs = null,
  lookupState = defaultMemberLookupState,
  lang = 'tr',
} = {}) {
  const now =
    typeof nowMs === 'number' && Number.isFinite(nowMs)
      ? nowMs
      : typeof tracker?.now === 'function'
        ? tracker.now()
        : Date.now();

  const minActiveMinutes = Math.max(0, Number(cfg.MIN_ACTIVE_MINUTES ?? activityConfig.MIN_ACTIVE_MINUTES ?? 1));
  const minActiveSec = Math.floor(minActiveMinutes * 60);
  const lookupCap = Math.max(0, Number(cfg.SAYIM_MEMBER_LOOKUP_CAP ?? activityConfig.SAYIM_MEMBER_LOOKUP_CAP ?? 25));
  const cacheTtlMs = Math.max(
    1000,
    Number(cfg.SAYIM_MEMBER_CACHE_TTL_MS ?? activityConfig.SAYIM_MEMBER_CACHE_TTL_MS ?? 60 * 60 * 1000)
  );
  const userCooldownMs = Math.max(
    0,
    Number(cfg.SAYIM_MEMBER_USER_COOLDOWN_MS ?? activityConfig.SAYIM_MEMBER_USER_COOLDOWN_MS ?? 10 * 60 * 1000)
  );

  const allRegs = typeof db.getAllRegistrations === 'function' ? db.getAllRegistrations() : [];
  const regIdSet = new Set(allRegs.map((r) => String(r.discordId)).filter(Boolean));

  // Bu sayım turunda yapılan fetch sayısı ve kullanıcı bazlı çözüm önbelleği
  let fetchesThisRun = 0;
  const runResolutionMemo = new Map();

  const resolveGuildMemberStatus = async (uid) => {
    if (runResolutionMemo.has(uid)) {
      return runResolutionMemo.get(uid);
    }

    // 1. Önce guild.members.cache'e bak (sıfır REST çağrısı)
    const cachedMember = guild?.members?.cache?.get?.(uid) || null;
    if (cachedMember) {
      const res = {
        verified: true,
        inGuild: true,
        isBot: Boolean(cachedMember.user?.bot),
        hasRegisteredRole: config.isRegisteredMember(cachedMember),
        member: cachedMember,
      };
      runResolutionMemo.set(uid, res);
      return res;
    }

    // 2. Saatlik bellek önbelleğine bak (sıfır REST çağrısı)
    const stored = lookupState?.cache?.get?.(uid) || null;
    if (stored && now - stored.fetchedAt < cacheTtlMs) {
      const res = {
        verified: true,
        inGuild: Boolean(stored.inGuild),
        isBot: Boolean(stored.isBot),
        hasRegisteredRole: Boolean(stored.hasRegisteredRole),
        member: null,
      };
      runResolutionMemo.set(uid, res);
      return res;
    }

    // 3. Guild yoksa veya fetch desteklenmiyorsa doğrulanamıyor -> belirsiz
    if (!guild || typeof guild.members?.fetch !== 'function') {
      const res = { verified: false, inGuild: false, isBot: false, hasRegisteredRole: false, member: null };
      runResolutionMemo.set(uid, res);
      return res;
    }

    // 4. Tur başına üst sınır (SAYIM_MEMBER_LOOKUP_CAP = 25) ve kullanıcı başına 10 dk bekleme süresi
    const lastAttemptAt = lookupState?.cooldowns?.get?.(uid) || 0;
    if (fetchesThisRun >= lookupCap || (userCooldownMs > 0 && lastAttemptAt > 0 && now - lastAttemptAt < userCooldownMs)) {
      const res = { verified: false, inGuild: false, isBot: false, hasRegisteredRole: false, member: null };
      runResolutionMemo.set(uid, res);
      return res;
    }

    if (lookupState?.cooldowns) {
      lookupState.cooldowns.set(uid, now);
    }
    fetchesThisRun += 1;

    try {
      const fetched = await guild.members.fetch(uid);
      const resolvedMember =
        typeof fetched?.get === 'function'
          ? fetched.get(uid) || null
          : fetched?.id === uid
            ? fetched
            : null;

      if (resolvedMember) {
        const entry = {
          inGuild: true,
          isBot: Boolean(resolvedMember.user?.bot),
          hasRegisteredRole: config.isRegisteredMember(resolvedMember),
          fetchedAt: now,
        };
        lookupState?.cache?.set?.(uid, entry);
        const res = { verified: true, ...entry, member: resolvedMember };
        runResolutionMemo.set(uid, res);
        return res;
      }

      const missingEntry = { inGuild: false, isBot: false, hasRegisteredRole: false, fetchedAt: now };
      lookupState?.cache?.set?.(uid, missingEntry);
      const res = { verified: true, ...missingEntry, member: null };
      runResolutionMemo.set(uid, res);
      return res;
    } catch (err) {
      if (isUnknownMemberError(err)) {
        const missingEntry = { inGuild: false, isBot: false, hasRegisteredRole: false, fetchedAt: now };
        lookupState?.cache?.set?.(uid, missingEntry);
        const res = { verified: true, ...missingEntry, member: null };
        runResolutionMemo.set(uid, res);
        return res;
      }

      // Geçici REST / hız sınırı / ağ hatası sayımı bozmaz; üye "belirsiz" olarak ayrılır
      const res = { verified: false, inGuild: false, isBot: false, hasRegisteredRole: false, member: null };
      runResolutionMemo.set(uid, res);
      return res;
    }
  };

  const uncertainUsers = new Set();
  const playingNowUsers = new Set();
  const activeThisMonthUsers = new Set();
  const verifiedLiveUnsavedByUser = new Map();

  // A) playingNow: onaylı (CONFIRM_SEC geçmiş) canlı oturum + canlı presence uzlaştırması
  // Önbellekten yüklenmiş ama canlı presence'ı artık oyun göstermeyen bayat oturumlar SAYILMAZ;
  // presence verisi yoksa sayılmaz, uncertainCount'a eklenir.
  if (tracker && tracker.sessions instanceof Map) {
    const disabledIds = tracker.disabledGameIds || new Set();
    for (const [rawUid, session] of tracker.sessions.entries()) {
      const uid = String(rawUid || '');
      if (!uid || !session || !session.confirmed || !session.gameId) continue;
      if (session.currentlyDetectedGameId !== session.gameId) continue;
      if (typeof db.isActivityTrackingEnabled === 'function' && !db.isActivityTrackingEnabled(uid)) {
        continue;
      }

      const memberStatus = await resolveGuildMemberStatus(uid);
      if (!memberStatus.verified) {
        uncertainUsers.add(uid);
        continue;
      }
      if (!memberStatus.inGuild || memberStatus.isBot) continue;

      const isRegistered = regIdSet.has(uid) || memberStatus.hasRegisteredRole;
      if (!isRegistered) continue;

      const livePresence =
        memberStatus.member?.presence || guild?.presences?.cache?.get?.(uid) || null;
      if (!livePresence) {
        uncertainUsers.add(uid);
        continue;
      }

      const liveDetected = activityTracker.detectGame(livePresence, cfg, disabledIds);
      if (!liveDetected) {
        // Bayat oturum: canlı presence artık desteklenen bir oyun göstermiyor -> playingNow'a girmez
        continue;
      }

      playingNowUsers.add(uid);
      if (typeof tracker.getLivePlayingInfo === 'function') {
        const liveInfo = tracker.getLivePlayingInfo(uid);
        if (liveInfo && liveInfo.unsavedSec > 0) {
          verifiedLiveUnsavedByUser.set(uid, Math.floor(Number(liveInfo.unsavedSec) || 0));
        }
      }
    }
  }

  // B) activeThisMonth: kayıtlı + sunucuda hâlâ bulunan + bot olmayan + takibi açık +
  //    bu ay en az MIN_ACTIVE_MINUTES dakika süresi olan benzersiz kullanıcılar
  //    (/oyun manuel rolleri activityStats'a yazılmaz, dolayısıyla sayıma girmez)
  const monthlyTotalByUser = new Map();
  const rawUsers = db.data.activityStats?.users;
  if (rawUsers && typeof rawUsers === 'object') {
    for (const [rawUid, userObj] of Object.entries(rawUsers)) {
      const uid = String(rawUid || '');
      if (!uid) continue;
      const userGames = userObj?.games;
      if (!userGames || typeof userGames !== 'object') continue;
      let sumSec = 0;
      for (const rawSec of Object.values(userGames)) {
        const sec = Math.floor(Number(rawSec));
        if (Number.isFinite(sec) && sec > 0) sumSec += sec;
      }
      if (sumSec > 0) {
        monthlyTotalByUser.set(uid, sumSec);
      }
    }
  }

  for (const [uid, unsavedSec] of verifiedLiveUnsavedByUser.entries()) {
    monthlyTotalByUser.set(uid, (monthlyTotalByUser.get(uid) || 0) + unsavedSec);
  }

  for (const [uid, totalSec] of monthlyTotalByUser.entries()) {
    if (totalSec < minActiveSec) continue;
    if (typeof db.isActivityTrackingEnabled === 'function' && !db.isActivityTrackingEnabled(uid)) {
      continue;
    }

    const memberStatus = await resolveGuildMemberStatus(uid);
    if (!memberStatus.verified) {
      uncertainUsers.add(uid);
      continue;
    }
    if (!memberStatus.inGuild || memberStatus.isBot) continue;

    const isRegistered = regIdSet.has(uid) || memberStatus.hasRegisteredRole;
    if (!isRegistered) continue;

    activeThisMonthUsers.add(uid);
  }

  // C) Geriye dönük yardımcı alanlar (tam üye listesi için toplu REST çağrısı YAPILMAZ)
  let totalMemberCount = 0;
  let onlineCount = 0;
  if (guild && guild.members?.cache) {
    const reportedCount = Number(guild.memberCount) || 0;
    const cachedHumans = Array.from(guild.members.cache.values()).filter((m) => m && !m.user?.bot);
    for (const member of cachedHumans) {
      const status = member.presence?.status || guild.presences?.cache?.get?.(member.id)?.status || null;
      if (status === 'online' || status === 'idle' || status === 'dnd') {
        onlineCount += 1;
      }
    }
    totalMemberCount = reportedCount > cachedHumans.length ? reportedCount : cachedHumans.length;
  } else {
    totalMemberCount = regIdSet.size;
  }

  const activeThisMonth = activeThisMonthUsers.size;
  const playingNow = playingNowUsers.size;
  const uncertainCount = uncertainUsers.size;
  const computedAt = new Date(now).toISOString();

  // Bu ayın gruplanmış oyun aileleri özeti (yeni sözleşme alanı: families)
  const topGamesSnapshot = computeTopGamesStats({
    scope: 'month',
    limit: 8,
    lang,
    db,
    tracker,
    cfg,
    nowMs: now,
  });

  // Tracker üzerindeki son kimliksiz sayım özetini güncelle (🛠️ Sistem Durumu ve saatlik konsol satırı için)
  if (tracker && typeof tracker.updateLastStatsSummary === 'function') {
    tracker.updateLastStatsSummary({
      activeThisMonth,
      playingNow,
      uncertainCount,
      computedAt,
    });
  }

  return {
    // Yeni sözleşme alanları
    activeThisMonth,
    playingNow,
    uncertainCount,
    computedAt,
    families: topGamesSnapshot.families,
    // Geriye dönük uyumluluk alanları (eski site bozulmadan çalışır)
    activeRegisteredCount: activeThisMonth,
    totalMemberCount,
    onlineCount,
    playingCount: playingNow,
    updatedAt: now,
  };
}

/**
 * GET /api/stats/summary
 * Web sitesi üst çubuk ve anasayfa için anonim sunucu özet istatistiklerini döndürür (60 sn önbellekli).
 */
router.get('/summary', async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'tr';
    const now = Date.now();
    if (summaryCache && summaryCache.lang === lang && now - summaryCache.at < SUMMARY_CACHE_TTL_MS) {
      return res.json(summaryCache.payload);
    }

    const payload = await computeServerStatsSummary({ guild: req.guild, lang });
    summaryCache = { at: now, lang, payload };
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: `Sunucu özeti alınırken hata oluştu: ${err.message}` });
  }
});

router.computeTopGamesStats = computeTopGamesStats;
router.clearTopGamesCache = clearTopGamesCache;
router.computeServerStatsSummary = computeServerStatsSummary;
router.clearSummaryCache = clearSummaryCache;
router.clearMemberLookupCache = clearMemberLookupCache;
router.defaultMemberLookupState = defaultMemberLookupState;

module.exports = router;
