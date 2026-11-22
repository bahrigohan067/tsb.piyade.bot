const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const activityTracker = require('../../utils/activityTracker');
const activityConfig = require('../../../activity.config');
const { formatDuration } = require('../../commands/aktivitem');

const TOP_GAMES_CACHE_TTL_MS = 60 * 1000;
const SUMMARY_CACHE_TTL_MS = 60 * 1000;
const SUMMARY_GUILD_FETCH_COOLDOWN_MS = 5 * 60 * 1000;
const topGamesCache = new Map();
let summaryCache = null;
let lastSummaryGuildFetchAt = 0;

function clearTopGamesCache() {
  topGamesCache.clear();
}

function clearSummaryCache() {
  summaryCache = null;
}

// Veritabanı her diske yazıldığında (checkpoint, aylık sıfırlama, yeni kayıt onayı, takip kapatma vb.) önbelleği tazele
if (typeof database.onSaveResult === 'function') {
  database.onSaveResult(() => {
    clearTopGamesCache();
    clearSummaryCache();
  });
}

const FAMILY_DISPLAY = {
  roblox: { id: 'roblox', name: 'Roblox', emoji: '🧱', family: 'roblox' },
  zula: { id: 'zula', name: 'Zula', emoji: '🔫', family: 'zula' },
  minecraft: { id: 'minecraft', name: 'Minecraft', emoji: '⛏️', family: 'minecraft' },
  cs2: { id: 'cs2', name: 'CS2', emoji: '🎯', family: 'cs2' },
};

function resolveTopGameDisplay(id, group, lang) {
  const isEn = lang === 'en';
  if (group === 'family') {
    const fam = FAMILY_DISPLAY[id] || activityConfig.FAMILIES?.[id];
    return {
      id,
      name: fam?.name || String(id),
      emoji: fam?.emoji || '🎮',
      family: id,
    };
  }

  if (id === 'roblox_unknown') {
    const unk = activityConfig.ROBLOX_UNKNOWN || {};
    return {
      id: 'roblox_unknown',
      name: isEn ? 'Roblox (other)' : 'Roblox (diğer)',
      emoji: unk.emoji || '🧱',
      family: unk.family || 'roblox',
    };
  }

  const info = activityConfig.getGameDisplayInfo(id, lang);
  return {
    id: info.id,
    name: info.name,
    emoji: info.emoji || '🎮',
    family: info.family || null,
  };
}

/**
 * Sunucu geneli anonim en çok oynanan oyunlar sıralamasını hesaplar.
 * Hiçbir koşulda kullanıcı ID'si veya kullanıcı adı içermez.
 */
function computeTopGamesStats({
  scope = 'month',
  limit = 8,
  lang = 'tr',
  group = 'game',
  db = database,
  tracker = activityTracker,
} = {}) {
  const cleanScope = scope === 'all' ? 'all' : 'month';
  const cleanGroup = group === 'family' ? 'family' : 'game';
  const cleanLang = lang === 'en' ? 'en' : 'tr';
  const rawLimit = Number.parseInt(String(limit ?? 8), 10);
  const cleanLimit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 8;

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

  // Canlı oturumdaki henüz checkpoint ile yazılmamış saniyeleri (unsavedSec) ekle
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

  // 2. Oyun veya aile bazında toplam saniye ve tekil oyuncu sayısı
  const secondsByBucket = new Map();
  const playersByBucket = new Map();

  const resolveBucketKey = (gameId) => {
    if (cleanGroup === 'family') {
      const info = activityConfig.getGameDisplayInfo(gameId, cleanLang);
      return info.family || 'roblox';
    }
    return String(gameId);
  };

  for (const [uid, userGames] of currentMonthByUser.entries()) {
    for (const [gid, sec] of Object.entries(userGames)) {
      if (!(sec > 0)) continue;
      const bucketKey = resolveBucketKey(gid);
      secondsByBucket.set(bucketKey, (secondsByBucket.get(bucketKey) || 0) + sec);

      let playerSet = playersByBucket.get(bucketKey);
      if (!playerSet) {
        playerSet = new Set();
        playersByBucket.set(bucketKey, playerSet);
      }
      playerSet.add(uid);
    }
  }

  // 3. scope === 'all' ise önceki aylardan birikmiş anonim toplamları (activityAllTime.games) ekle
  if (cleanScope === 'all') {
    for (const [gid, allTimeSec] of Object.entries(allTimeInfo.games || {})) {
      if (!(allTimeSec > 0)) continue;
      const bucketKey = resolveBucketKey(gid);
      secondsByBucket.set(bucketKey, (secondsByBucket.get(bucketKey) || 0) + allTimeSec);
    }
  }

  // 4. Sırala, toplamı ve yüzdeleri hesapla
  const allEntries = [];
  for (const [bucketKey, totalSec] of secondsByBucket.entries()) {
    const cleanSec = Math.floor(Number(totalSec) || 0);
    if (cleanSec <= 0) continue;
    const display = resolveTopGameDisplay(bucketKey, cleanGroup, cleanLang);
    const activePlayersCount = playersByBucket.get(bucketKey)?.size || 0;
    allEntries.push({
      id: display.id,
      name: display.name,
      emoji: display.emoji,
      family: display.family,
      seconds: cleanSec,
      players: activePlayersCount,
    });
  }

  allEntries.sort((a, b) => b.seconds - a.seconds || b.players - a.players || a.id.localeCompare(b.id));

  const totalSeconds = allEntries.reduce((sum, item) => sum + item.seconds, 0);
  const games = allEntries.slice(0, cleanLimit).map((item) => {
    const hours = Number((item.seconds / 3600).toFixed(1));
    const percent = totalSeconds > 0 ? Math.round((item.seconds / totalSeconds) * 100) : 0;
    return {
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      family: item.family,
      seconds: item.seconds,
      hours,
      percent,
      players: item.players,
      formattedDuration: formatDuration(item.seconds, cleanLang),
    };
  });

  return {
    scope: cleanScope,
    group: cleanGroup,
    month,
    since,
    updatedAt: Date.now(),
    totalSeconds,
    games,
  };
}

/**
 * GET /api/stats/top-games?scope=month|all&limit=8&lang=tr|en&group=game|family
 * Sunucuda en çok oynanan oyunların anonim sıralamasını döndürür (60 sn bellek önbellekli).
 */
router.get('/top-games', (req, res) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'month';
    const group = req.query.group === 'family' ? 'family' : 'game';
    const lang = req.query.lang === 'en' ? 'en' : 'tr';
    const rawLimit = Number.parseInt(String(req.query.limit ?? 8), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 8;
    const month = database.data.activityStats?.month || database.getCurrentIstanbulMonth();

    const cacheKey = `${scope}:${group}:${lang}:${limit}:${month}`;
    const now = Date.now();
    const cached = topGamesCache.get(cacheKey);
    if (cached && now - cached.at < TOP_GAMES_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const payload = computeTopGamesStats({ scope, limit, lang, group });
    topGamesCache.set(cacheKey, { at: now, payload });

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: `Oyun istatistikleri alınırken hata oluştu: ${err.message}` });
  }
});

/**
 * Sunucu geneli anonim özet sayılarını hesaplar (aktif kayıtlı oyuncu, toplam üye, çevrimiçi ve şu an oynayan).
 * Hiçbir kullanıcı ID'si veya kullanıcı adı içermez.
 */
async function computeServerStatsSummary({ guild = null, db = database, tracker = activityTracker } = {}) {
  const allRegs = typeof db.getAllRegistrations === 'function' ? db.getAllRegistrations() : [];
  const regIdSet = new Set(allRegs.map((r) => String(r.discordId)).filter(Boolean));

  let activeRegisteredCount = 0;
  let totalMemberCount = 0;
  let onlineCount = 0;

  if (guild && guild.members?.cache) {
    const reportedCount = Number(guild.memberCount) || 0;
    const now = Date.now();
    if (
      reportedCount > 0 &&
      guild.members.cache.size < Math.floor(reportedCount * 0.8) &&
      typeof guild.members.fetch === 'function' &&
      now - lastSummaryGuildFetchAt >= SUMMARY_GUILD_FETCH_COOLDOWN_MS
    ) {
      lastSummaryGuildFetchAt = now;
      await guild.members.fetch({ limit: 1000 }).catch(() => null);
    }

    const cachedMembers = Array.from(guild.members.cache.values());
    const humanMembers = cachedMembers.filter((m) => m && !m.user?.bot);

    if (humanMembers.length > 0) {
      for (const member of humanMembers) {
        if (config.isRegisteredMember(member) || regIdSet.has(String(member.id))) {
          activeRegisteredCount += 1;
        }
        const presenceStatus =
          member.presence?.status || guild.presences?.cache?.get?.(member.id)?.status || null;
        if (presenceStatus === 'online' || presenceStatus === 'idle' || presenceStatus === 'dnd') {
          onlineCount += 1;
        }
      }
      totalMemberCount = reportedCount > humanMembers.length ? reportedCount : humanMembers.length;
    } else {
      activeRegisteredCount = regIdSet.size;
      totalMemberCount = reportedCount || regIdSet.size;
    }
  } else {
    activeRegisteredCount = regIdSet.size;
    totalMemberCount = regIdSet.size;
  }

  let playingCount = 0;
  if (tracker && tracker.sessions instanceof Map) {
    for (const [uid, session] of tracker.sessions.entries()) {
      if (!session || !session.confirmed || !session.gameId) continue;
      if (session.currentlyDetectedGameId !== session.gameId) continue;
      if (typeof db.isActivityTrackingEnabled === 'function' && !db.isActivityTrackingEnabled(uid)) {
        continue;
      }
      playingCount += 1;
    }
  }

  return {
    activeRegisteredCount,
    totalMemberCount,
    onlineCount,
    playingCount,
    updatedAt: Date.now(),
  };
}

/**
 * GET /api/stats/summary
 * Web sitesi üst çubuk ve anasayfa için anonim sunucu özet istatistiklerini döndürür (60 sn önbellekli).
 */
router.get('/summary', async (req, res) => {
  try {
    const now = Date.now();
    if (summaryCache && now - summaryCache.at < SUMMARY_CACHE_TTL_MS) {
      return res.json(summaryCache.payload);
    }

    const payload = await computeServerStatsSummary({ guild: req.guild });
    summaryCache = { at: now, payload };
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: `Sunucu özeti alınırken hata oluştu: ${err.message}` });
  }
});

router.computeTopGamesStats = computeTopGamesStats;
router.clearTopGamesCache = clearTopGamesCache;
router.computeServerStatsSummary = computeServerStatsSummary;
router.clearSummaryCache = clearSummaryCache;

module.exports = router;
