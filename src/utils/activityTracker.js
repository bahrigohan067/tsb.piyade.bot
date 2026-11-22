/**
 * Oyun Etkinliği Algılama, Durum Makinesi, Aktiflik Rolleri,
 * Otomatik Ses Aktarımı (evaluateTransfer), Karar İzi, Sayaçlar ve Aylık Süre Takibi Yöneticisi.
 *
 * Kesin kurallar:
 * - Yalnızca Discord presence/activity verisi kullanılır (Roblox API/çerez YOK).
 * - Hiçbir oyun geçmişi veya zaman çizelgesi saklanmaz; kalıcı olarak yalnızca
 *   aylık toplam saniye (activityStats), kullanıcı tercihleri (activityPrefs) ve activityMeta tutulur.
 * - Karar izi (lastDecisions) yalnızca bellekte kullanıcı başına SON kararı tutar ve 30 dk sonra silinir.
 * - Sayaçlar (counters) yalnızca bellekte ve kullanıcı kimliği içermeyen toplam sayılardır.
 * - Konsola kullanıcı kimliği, kullanıcı adı veya kullanıcıya özel oyun bilgisi yazılmaz.
 * - Bot hesapları yoksayılır.
 */

const {
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const activityConfig = require('../../activity.config');
const database = require('./database');
const { resolveLang } = require('./i18n');

const { TRANSFER_REASONS } = activityConfig;

// =========================================================================
// 1. SAF NORMALİZASYON VE OYUN EŞLEŞTİRME FONKSİYONLARI (Test Edilebilir)
// =========================================================================

/**
 * Etkinlik metinlerini ve eşleşme değerlerini tek biçime indirger.
 * Unicode NFKC, Türkçe harf katlama, birleşik işaret / emoji temizleme,
 * noktalama/ayırıcıları boşluğa çevirme ve boşlukları teke indirme uygular.
 */
function normalizeActivityText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bir Playing etkinliğinin eşleştirmede kullanılacak alanlarını (ham + normalize) çıkarır.
 */
function extractActivityFields(activity) {
  const raw = {
    name: typeof activity?.name === 'string' ? activity.name : '',
    details: typeof activity?.details === 'string' ? activity.details : '',
    state: typeof activity?.state === 'string' ? activity.state : '',
    largeText: typeof activity?.assets?.largeText === 'string' ? activity.assets.largeText : '',
  };

  const normalized = {
    name: normalizeActivityText(raw.name),
    details: normalizeActivityText(raw.details),
    state: normalizeActivityText(raw.state),
    largeText: normalizeActivityText(raw.largeText),
  };

  return {
    raw,
    normalized,
    rawValues: [raw.name, raw.details, raw.state, raw.largeText].filter(Boolean),
    normalizedValues: [
      normalized.name,
      normalized.details,
      normalized.state,
      normalized.largeText,
    ].filter(Boolean),
  };
}

/**
 * Etkinlik adı yoksayılacaklar (VS Code, OBS, Roblox Studio vb.) listesinde mi?
 */
function isIgnoredActivity(activity, cfg = activityConfig) {
  const normName = normalizeActivityText(activity?.name || '');
  if (!normName) return false;
  if (normName === 'roblox studio' || normName.startsWith('roblox studio ')) return true;
  const list = Array.isArray(cfg.IGNORED_ACTIVITIES) ? cfg.IGNORED_ACTIVITIES : [];
  return list.some((entry) => normalizeActivityText(entry) === normName);
}

/**
 * Normalize edilmiş etkinlik adının genel Roblox ("roblox", "roblox player", "roblox beta" vb.)
 * olup olmadığını kontrol eder ("roblox studio" hariç).
 */
function isGeneralRobloxActivityName(normName) {
  if (!normName || typeof normName !== 'string') return false;
  if (normName === 'roblox studio' || normName.startsWith('roblox studio ')) return false;
  return normName === 'roblox' || normName.startsWith('roblox ');
}

/**
 * Tek bir Discord etkinliğini activity.config.js kurallarına göre değerlendirir.
 */
function matchSingleActivity(activity, cfg = activityConfig, disabledGameIds = new Set()) {
  if (!activity || activity.type !== ActivityType.Playing) {
    return { status: 'non_playing', game: null, rawName: activity?.name || null };
  }

  const fields = extractActivityFields(activity);

  if (isIgnoredActivity(activity, cfg)) {
    return { status: 'ignored', game: null, rawName: fields.raw.name || null };
  }

  const startedAt = Number(activity.timestamps?.start) || 0;

  // 1. Önce GAMES listesindeki belirli oyunları (sırayla) kontrol et
  for (const game of cfg.GAMES || []) {
    if (!game || !game.id || disabledGameIds.has(game.id)) continue;

    let matched = false;

    // 1a. Matcher listesi (biri tutarsa eşleşir)
    for (const matcher of game.matchers || []) {
      if (!matcher || !matcher.value) continue;
      const needle = normalizeActivityText(matcher.value);
      if (!needle) continue;

      const fieldName = matcher.field || 'any';
      const candidates =
        fieldName === 'any'
          ? fields.normalizedValues
          : [fields.normalized[fieldName]].filter(Boolean);

      if (matcher.op === 'equals') {
        if (candidates.some((val) => val === needle)) {
          matched = true;
          break;
        }
      } else if (matcher.op === 'contains') {
        if (candidates.some((val) => val.includes(needle))) {
          matched = true;
          break;
        }
      }
    }

    // 1b. Ek eşleşme: placeId rakam dizisi ham alanlardan birinde geçiyorsa eşle
    if (!matched && game.placeId) {
      const placeRegex = new RegExp(`(?:^|\\D)${escapeRegExp(String(game.placeId))}(?:\\D|$)`);
      if (fields.rawValues.some((rawVal) => placeRegex.test(rawVal))) {
        matched = true;
      }
    }

    if (matched) {
      return {
        status: 'matched',
        game,
        priority: game.family === 'roblox' ? 3 : 2,
        startedAt,
        rawName: fields.raw.name || game.name,
      };
    }
  }

  // 2. Hiçbiri eşleşmediyse ve etkinlik adı 'roblox' ile başlıyorsa ('roblox', 'roblox player', 'roblox beta' vb.) -> ROBLOX_UNKNOWN
  if (
    isGeneralRobloxActivityName(fields.normalized.name) &&
    cfg.ROBLOX_UNKNOWN &&
    !disabledGameIds.has('roblox_unknown')
  ) {
    return {
      status: 'roblox_unknown',
      game: cfg.ROBLOX_UNKNOWN,
      priority: 1,
      startedAt,
      rawName: fields.raw.name || 'Roblox',
    };
  }

  return { status: 'unmatched', game: null, rawName: fields.raw.name || null };
}

/**
 * Bir üyenin Discord presence nesnesinden birincil oynanan oyunu tespit eder.
 * Öncelik: belirli Roblox oyunu (3) > zula/minecraft/cs2 (2) > ROBLOX_UNKNOWN (1).
 * Eşitlikte timestamps.start değeri en yeni olan, yoksa listedeki ilk etkinlik seçilir.
 */
function detectGame(presence, cfg = activityConfig, disabledGameIds = new Set()) {
  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  if (activities.length === 0) return null;

  let best = null;
  let bestIndex = -1;

  for (let i = 0; i < activities.length; i++) {
    const res = matchSingleActivity(activities[i], cfg, disabledGameIds);
    if (res.status !== 'matched' && res.status !== 'roblox_unknown') continue;

    if (!best) {
      best = res;
      bestIndex = i;
      continue;
    }

    if (res.priority > best.priority) {
      best = res;
      bestIndex = i;
    } else if (res.priority === best.priority) {
      if (res.startedAt > best.startedAt) {
        best = res;
        bestIndex = i;
      } else if (res.startedAt === best.startedAt && i < bestIndex) {
        best = res;
        bestIndex = i;
      }
    }
  }

  if (!best || !best.game) return null;

  return {
    gameId: best.game.id,
    family: best.game.family,
    game: best.game,
    isUnknownRoblox: best.status === 'roblox_unknown',
    startedAt: best.startedAt || 0,
    rawName: best.rawName || best.game.name,
  };
}

/**
 * Presence nesnesini sayaçlar ve evaluateTransfer için ayrıntılı sınıflandırır.
 */
function classifyPresence(presence, cfg = activityConfig, disabledGameIds = new Set()) {
  if (!presence || typeof presence !== 'object') {
    return { kind: 'no_presence', hasPlaying: false, detected: null, rawName: null };
  }

  const activities = Array.isArray(presence.activities) ? presence.activities : [];
  const playingActivities = activities.filter((a) => a && a.type === ActivityType.Playing);

  if (playingActivities.length === 0) {
    return { kind: 'not_playing', hasPlaying: false, detected: null, rawName: null };
  }

  const detected = detectGame(presence, cfg, disabledGameIds);
  if (detected) {
    return {
      kind: detected.isUnknownRoblox ? 'roblox_unknown' : 'matched',
      hasPlaying: true,
      detected,
      rawName: detected.rawName,
    };
  }

  let unmatchedRawName = null;
  let ignoredRawName = null;

  for (const act of playingActivities) {
    const res = matchSingleActivity(act, cfg, disabledGameIds);
    if (res.status === 'unmatched' && !unmatchedRawName) {
      unmatchedRawName = res.rawName || act.name || 'Bilinmeyen';
    } else if (res.status === 'ignored' && !ignoredRawName) {
      ignoredRawName = res.rawName || act.name || 'Yoksayılan';
    }
  }

  if (unmatchedRawName) {
    return {
      kind: 'unmatched',
      hasPlaying: true,
      detected: null,
      rawName: unmatchedRawName,
    };
  }

  return {
    kind: 'ignored',
    hasPlaying: true,
    detected: null,
    rawName: ignoredRawName,
  };
}

/**
 * presenceUpdate içinde gereksiz işlem yapmamak için Playing etkinliklerinin hafif imzasını üretir.
 */
function getPlayingActivitiesSignature(presence) {
  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  let sig = '';
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    if (!a || a.type !== ActivityType.Playing) continue;
    sig += `${a.name || ''}\x1f${a.details || ''}\x1f${a.state || ''}\x1f${a.assets?.largeText || ''}\x1f${a.timestamps?.start || ''}\x1e`;
  }
  return sig;
}

/**
 * Teşhis aracı için üyenin gördüğümüz tüm Playing etkinliklerini ve eşleşme sonuçlarını üretir.
 * Hiçbir veriyi kalıcı veya geçici olarak saklamaz.
 */
function diagnosePresence(presence, cfg = activityConfig, disabledGameIds = new Set()) {
  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  const playing = activities.filter((a) => a && a.type === ActivityType.Playing);

  return playing.map((act) => {
    const match = matchSingleActivity(act, cfg, disabledGameIds);
    return {
      raw: {
        name: act.name || null,
        applicationId: act.applicationId || null,
        details: act.details || null,
        state: act.state || null,
        largeText: act.assets?.largeText || null,
      },
      status: match.status,
      rawName: match.rawName || act.name || null,
      game: match.game
        ? {
            id: match.game.id,
            name: match.game.name,
            emoji: match.game.emoji,
            family: match.game.family,
          }
        : null,
    };
  });
}

/**
 * Çok kanallı oyunlarda (örn: Minecraft) en uygun hedef ses kanalını seçer.
 * 1. Aynı oyunda onaylı oturumu olan üye içeren (dolu olmayan) kanal
 * 2. Yoksa dolu olmayan ve en çok üyesi olan kanal
 * 3. Yoksa listedeki ilk dolu olmayan kanal
 * Tüm kanallar doluysa { channel: null, allFull: true } döner.
 */
function selectTargetVoiceChannel({
  guild,
  gameId,
  candidateChannelIds,
  sessionsMap,
  excludeUserId = null,
}) {
  if (!guild || !Array.isArray(candidateChannelIds) || candidateChannelIds.length === 0) {
    return { channel: null, allFull: false, noPermission: false, notFound: true };
  }

  const botMember = guild.members?.me || null;
  const existingVoiceChannels = [];
  const permittedVoiceChannels = [];

  for (const chId of candidateChannelIds) {
    const ch = guild.channels?.cache?.get?.(chId) || null;
    if (!ch || !activityConfig.isRegularVoiceChannel(ch)) continue;
    existingVoiceChannels.push(ch);

    let hasChannelPerm = true;
    if (botMember && typeof ch.permissionsFor === 'function') {
      const perms = ch.permissionsFor(botMember);
      if (perms && typeof perms.has === 'function') {
        if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
          hasChannelPerm = false;
        }
      }
    }
    if (hasChannelPerm) {
      permittedVoiceChannels.push(ch);
    }
  }

  if (existingVoiceChannels.length === 0) {
    return { channel: null, allFull: false, noPermission: false, notFound: true };
  }

  if (permittedVoiceChannels.length === 0) {
    return { channel: null, allFull: false, noPermission: true, notFound: false };
  }

  const openChannels = permittedVoiceChannels.filter((ch) => {
    const limit = Number(ch.userLimit) || 0;
    const count = ch.members?.size ?? 0;
    return limit === 0 || count < limit;
  });

  if (openChannels.length === 0) {
    return { channel: null, allFull: true, noPermission: false, notFound: false };
  }

  if (openChannels.length === 1) {
    return { channel: openChannels[0], allFull: false, noPermission: false, notFound: false };
  }

  // Aynı oyunda onaylı oturumlu oyuncu sayısını her kanal için hesapla
  const scored = openChannels.map((ch, idx) => {
    let sameGameConfirmedCount = 0;
    if (ch.members && sessionsMap) {
      for (const [mId] of ch.members) {
        if (excludeUserId && String(mId) === String(excludeUserId)) continue;
        const s = sessionsMap.get(String(mId));
        if (s && s.confirmed && s.gameId === gameId) {
          sameGameConfirmedCount += 1;
        }
      }
    }
    const totalMembers = ch.members?.size ?? 0;
    return { ch, idx, sameGameConfirmedCount, totalMembers };
  });

  // 1. Önce aynı oyunda onaylı oyuncu bulunan kanal
  const withSameGame = scored.filter((item) => item.sameGameConfirmedCount > 0);
  if (withSameGame.length > 0) {
    withSameGame.sort(
      (a, b) =>
        b.sameGameConfirmedCount - a.sameGameConfirmedCount ||
        b.totalMembers - a.totalMembers ||
        a.idx - b.idx
    );
    return { channel: withSameGame[0].ch, allFull: false, noPermission: false, notFound: false };
  }

  // 2. Yoksa dolu olmayan ve en çok üyesi olan kanal
  const withMembers = scored.filter((item) => item.totalMembers > 0);
  if (withMembers.length > 0) {
    withMembers.sort((a, b) => b.totalMembers - a.totalMembers || a.idx - b.idx);
    return { channel: withMembers[0].ch, allFull: false, noPermission: false, notFound: false };
  }

  // 3. Yoksa listedeki ilk kanal
  return { channel: openChannels[0], allFull: false, noPermission: false, notFound: false };
}

/**
 * Yeni boş sayaç nesnesi oluşturur (kullanıcı kimliği içermez).
 */
function createEmptyCounters() {
  const reasons = {};
  for (const key of Object.keys(TRANSFER_REASONS)) {
    reasons[key] = 0;
  }
  return {
    presenceReceived: 0,
    presenceProcessed: 0,
    presenceWithPlaying: 0,
    matchedGame: 0,
    generalRoblox: 0,
    unmatchedActivity: 0,
    ignoredActivity: 0,
    sessionConfirmed: 0,
    roleAdded: 0,
    roleFailed: 0,
    checkpointWritten: 0,
    dbSaveSuccess: 0,
    dbSaveFailed: 0,
    voiceChangesReceived: 0,
    transfersMoved: 0,
    reasons,
  };
}

// =========================================================================
// 2. HAFİF HIZ SINIRLI KUYRUKLAR (Rol & Ses Taşıma)
// =========================================================================

class RateLimitedQueue {
  constructor({ maxConcurrency = 1, gapMs = 500, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, nowFn = Date.now }) {
    this._maxConcurrency = Math.max(1, maxConcurrency);
    this._gapMs = Math.max(0, gapMs);
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this._now = nowFn;
    this._queue = [];
    this._active = 0;
    this._lastDispatchAt = 0;
    this._pauseUntil = 0;
    this._drainTimer = null;
    this._closed = false;
  }

  enqueue(taskFn) {
    if (this._closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._queue.push({ taskFn, resolve });
      this._drain();
    });
  }

  pauseFor(ms) {
    const until = this._now() + Math.max(0, ms);
    if (until > this._pauseUntil) {
      this._pauseUntil = until;
    }
  }

  _drain() {
    if (this._closed || this._active >= this._maxConcurrency || this._queue.length === 0) {
      return;
    }

    const now = this._now();
    const waitGap = this._gapMs > 0 ? Math.max(0, this._lastDispatchAt + this._gapMs - now) : 0;
    const waitPause = Math.max(0, this._pauseUntil - now);
    const delay = Math.max(waitGap, waitPause);

    if (delay > 0) {
      if (!this._drainTimer) {
        this._drainTimer = this._setTimeout(() => {
          this._drainTimer = null;
          this._drain();
        }, delay);
        this._drainTimer?.unref?.();
      }
      return;
    }

    const item = this._queue.shift();
    if (!item) return;

    this._active += 1;
    this._lastDispatchAt = this._now();

    Promise.resolve()
      .then(() => item.taskFn())
      .then((res) => item.resolve(res))
      .catch(() => item.resolve(null))
      .finally(() => {
        this._active -= 1;
        this._drain();
      });

    if (this._active < this._maxConcurrency && this._queue.length > 0) {
      this._drain();
    }
  }

  reopen() {
    this._closed = false;
  }

  clear() {
    this._closed = true;
    if (this._drainTimer) {
      this._clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      item.resolve(null);
    }
  }
}

// =========================================================================
// 3. OYUN ETKİNLİĞİ ANA YÖNETİCİSİ
// =========================================================================

class ActivityTracker {
  constructor(options = {}) {
    this.config = options.config || activityConfig;
    this.db = options.db || database;
    this.now = options.nowFn || (() => Date.now());
    this._setTimeout = options.setTimeoutFn || setTimeout;
    this._clearTimeout = options.clearTimeoutFn || clearTimeout;
    this._setInterval = options.setIntervalFn || setInterval;
    this._clearInterval = options.clearIntervalFn || clearInterval;
    this.logger = options.logger || console;

    this.guild = null;
    this.client = null;
    this.presenceEnabled = true;

    // Yapılandırma doğrulama sonucu
    this.disabledGameIds = new Set();
    this.disabledFamilyIds = new Set();
    this.validChannelIdsByGame = new Map();

    // Sadece şu an oyun oynayan (veya onay/bekleme aşamasındaki) üyeler; bitince silinir
    this.sessions = new Map();

    // Üye başına en fazla 1 aktif geri sayım: Map<userId, { token, trigger, gameId, fromChannelId, targetChannelId, displayGameName, message, timer }>
    this.activeCountdowns = new Map();

    // Üye başına eşzamanlı evaluateTransfer kilidi
    this.evaluatingUsers = new Set();

    // Üye başına 3 sn ses kanalı değişimi debounce zamanlayıcıları
    this.voiceDebounceTimers = new Map();

    // Botun kendi taşımasının 5 sn boyunca voiceStateUpdate'i tekrar tetiklememesi için harita
    this.botMoveIgnoreUntil = new Map();

    // Kullanıcı başına bellekte SON aktarma kararı (30 dk TTL, kalıcı olarak hiçbir yere yazılmaz)
    this.lastDecisions = new Map();

    // Kimliksiz zincir sayaçları (bot açıldığından beri toplam)
    this.counters = createEmptyCounters();

    // İptal sonrası 5 sn silme zamanlayıcıları (kapanışta temizlenir)
    this.pendingDeleteTimers = new Set();

    // Aynı hata sebebini saatte en fazla 1 kez konsola yazmak için harita
    this.errorLogTimestamps = new Map();

    // Veritabanı kayıt sonucu dinleyicisi
    this._unsubscribeDbSave =
      typeof this.db?.onSaveResult === 'function'
        ? this.db.onSaveResult((ok, err) => {
            if (ok) {
              this.counters.dbSaveSuccess += 1;
            } else {
              this.counters.dbSaveFailed += 1;
              this.logErrorThrottled(
                'db:save_failed',
                `[OYUN ETKİNLİĞİ DB UYARISI] Veritabanı kaydı başarısız oldu (${err?.message || 'bilinmeyen hata'}).`
              );
            }
          })
        : null;

    // Kuyruklar
    this.roleQueue = new RateLimitedQueue({
      maxConcurrency: 1,
      gapMs: this.config.TIMINGS.ROLE_QUEUE_GAP_MS,
      setTimeoutFn: this._setTimeout,
      clearTimeoutFn: this._clearTimeout,
      nowFn: this.now,
    });
    this.moveQueue = new RateLimitedQueue({
      maxConcurrency: 2,
      gapMs: this.config.TIMINGS.MOVE_QUEUE_GAP_MS,
      setTimeoutFn: this._setTimeout,
      clearTimeoutFn: this._clearTimeout,
      nowFn: this.now,
    });

    // Arka plan zamanlayıcıları
    this.checkpointInterval = null;
    this.monthlyCheckInterval = null;
    this.startupCleanupTimer = null;
    this.sweepInterval = null;
    this.hourlyLogInterval = null;
  }

  /**
   * Tek merkezi kullanıcı etkinlik tercihi okuyucusu.
   * activityPrefs'te kaydı olmayan her üyeye { tracking: true, autoMove: true } döner.
   */
  getPrefs(userId) {
    if (typeof this.db?.getPrefs === 'function') {
      return this.db.getPrefs(userId);
    }
    if (typeof this.db?.getActivityPrefs === 'function') {
      return this.db.getActivityPrefs(userId);
    }
    return { tracking: true, autoMove: true };
  }

  getGameLabel(gameId, lang = 'tr') {
    const info = this.config.getGameDisplayInfo(gameId, lang, this.config);
    return info.shortName || info.name || String(gameId || 'Roblox');
  }

  /**
   * Aynı hata anahtarı için saatte en fazla bir kez konsola tek satır uyarı yazar.
   */
  logErrorThrottled(reasonKey, message) {
    const now = this.now();
    const last = this.errorLogTimestamps.get(reasonKey) || 0;
    if (now - last < 60 * 60 * 1000) return false;
    this.errorLogTimestamps.set(reasonKey, now);
    this.logger.warn(message);
    return true;
  }

  /**
   * Kimliksiz zincir sayaçlarını tek satır olarak konsola yazar (açılışta ve saat başı).
   */
  logCounterSummary(periodLabel = 'son 1 saat') {
    const c = this.counters;
    const dbStatus = this.db?.lastSaveOk === false ? 'ERR' : 'OK';
    this.logger.log(
      `[OYUN ETKİNLİĞİ] ${periodLabel}: presence=${c.presenceReceived} playing=${c.presenceWithPlaying} matched=${c.matchedGame} roblox=${c.generalRoblox} oturum=${c.sessionConfirmed} rol=${c.roleAdded} süreYazıldı=${c.checkpointWritten} dbKayıt=${dbStatus} | aktarma: MOVED=${c.transfersMoved} NOT_IN_VOICE=${c.reasons.NOT_IN_VOICE}`
    );
  }

  setPresenceEnabled(enabled) {
    this.presenceEnabled = Boolean(enabled);
  }

  isPresenceIntentAvailable() {
    if (!this.presenceEnabled) return false;
    if (this.client?.activityPresenceDisabled) return false;
    return true;
  }

  /**
   * Kullanıcı başına bellekte SON aktarma kararını kaydeder (30 dk TTL) ve sebep sayacını artırır.
   * Kalıcı olarak hiçbir yere yazılmaz.
   */
  recordDecision(
    userId,
    {
      trigger = 'game-confirmed',
      result = 'skipped',
      reason = TRANSFER_REASONS.NOT_PLAYING,
      game = null,
      fromChannelId = null,
      toChannelId = null,
    } = {}
  ) {
    if (reason && Object.prototype.hasOwnProperty.call(this.counters.reasons, reason)) {
      this.counters.reasons[reason] += 1;
    }
    if (reason === TRANSFER_REASONS.MOVED) {
      this.counters.transfersMoved += 1;
    }

    const now = this.now();
    const ttlMin = Math.max(1, Number(this.config.TIMINGS?.DECISION_TTL_MIN ?? 30));
    const entry = {
      at: now,
      trigger: String(trigger || 'game-confirmed'),
      result: String(result || 'skipped'),
      reason: String(reason || TRANSFER_REASONS.NOT_PLAYING),
      game: game ? String(game) : null,
      fromChannelId: fromChannelId ? String(fromChannelId) : null,
      toChannelId: toChannelId ? String(toChannelId) : null,
      expiresAt: now + ttlMin * 60 * 1000,
    };

    if (userId) {
      this.lastDecisions.set(String(userId), entry);
    }

    return entry;
  }

  /**
   * Kullanıcının son 30 dakikadaki aktarma karar izini döndürür; süresi dolmuşsa silip null döner.
   */
  getLastDecision(userId) {
    if (!userId) return null;
    const uid = String(userId);
    const entry = this.lastDecisions.get(uid);
    if (!entry) return null;
    if (this.now() > entry.expiresAt) {
      this.lastDecisions.delete(uid);
      return null;
    }
    return entry;
  }

  pruneExpiredDecisions() {
    const now = this.now();
    for (const [uid, entry] of this.lastDecisions.entries()) {
      if (now > entry.expiresAt) {
        this.lastDecisions.delete(uid);
      }
    }
  }

  markBotMoveIgnore(userId, targetChannelId = null) {
    if (!userId) return;
    const sec = Math.max(1, Number(this.config.TIMINGS?.BOT_MOVE_IGNORE_SEC ?? 5));
    this.botMoveIgnoreUntil.set(String(userId), {
      until: this.now() + sec * 1000,
      targetChannelId: targetChannelId ? String(targetChannelId) : null,
    });
  }

  /**
   * Açılışta (ready) sunucu için sistemi başlatır:
   * - activity.config.js doğrulaması + izin/hiyerarşi kontrolü
   * - Ay dönümü kontrolü ve tek seferlik ilk duyuru
   * - Önbellekteki presence'lerden başlangıç oturumları:
   *   Üye O AN ses kanalındaysa moveToken = false (sürpriz taşıma yok),
   *   ses dışındaysa moveToken = true (sonradan sese girerse aktarılsın). Açılışta kimse taşınmaz.
   */
  async initForGuild(guild, client = null) {
    this.guild = guild;
    this.client = client || guild?.client || null;
    this.roleQueue.reopen();
    this.moveQueue.reopen();

    if (!this.isPresenceIntentAvailable()) {
      this.logErrorThrottled(
        'presence_intent_disabled',
        '[OYUN ETKİNLİĞİ] Presence Intent kapalı olduğu için oyun etkinliği takibi devre dışı bırakıldı.'
      );
      return { enabled: false };
    }

    // 1. Yapılandırma, rol, kanal ve izin doğrulaması
    const validation = this.config.validateActivityConfigWithGuild(guild, this.config);
    this.disabledGameIds = validation.disabledGameIds;
    this.disabledFamilyIds = validation.disabledFamilyIds;
    this.validChannelIdsByGame = validation.validChannelIdsByGame;

    // 2. Aylık sıfırlama kontrolü (bot ay dönümünde kapalıydıysa açılışta temizler)
    await this.checkMonthlyReset(guild);

    // 3. Sistem ilk kez çalışıyorsa tek seferlik iki dilli duyuru
    await this.checkOneTimeAnnouncement(guild);

    // 4. Önbellekteki mevcut presence'lerden oturumları kur (üyeleri fetch ETME, açılışta taşıma YAPMA)
    let seededCount = 0;
    const now = this.now();
    const presences = guild?.presences?.cache;
    if (presences) {
      for (const [userId, presence] of presences) {
        const uid = String(userId);
        const member = guild.members?.cache?.get?.(uid) || presence?.member || null;
        const user = member?.user || presence?.user || null;
        if (user?.bot) continue;
        if (!this.getPrefs(uid).tracking) continue;
        if (this.sessions.has(uid)) continue;

        const detected = detectGame(presence, this.config, this.disabledGameIds);
        if (!detected) continue;

        const inVoiceAtStartup = Boolean(
          member?.voice?.channelId || guild.voiceStates?.cache?.get?.(uid)?.channelId
        );

        const session = {
          userId: uid,
          confirmed: true,
          gameId: detected.gameId,
          family: detected.family,
          currentlyDetectedGameId: detected.gameId,
          since: now,
          activityStartedAt: detected.startedAt > 0 && detected.startedAt <= now ? detected.startedAt : now,
          lastAccountedAt: now,
          lastSeen: now,
          // Sesteyse hak tüketilmiş sayılır (sürpriz taşıma yok); ses dışındaysa hak VAR (sonradan sese girerse aktarılır)
          moveToken: !inVoiceAtStartup,
          sweepBlockedForMoveFail: false,
          pendingGameId: null,
          pendingFamily: null,
          pendingSince: null,
          pendingActivityStartedAt: null,
          confirmTimer: null,
          stopGraceTimer: null,
          voiceJoinTimer: null,
        };
        this.sessions.set(uid, session);
        this.counters.sessionConfirmed += 1;
        seededCount += 1;

        if (member) {
          this.syncMemberFamilyRoles(member, detected.family);
        }
      }
    }

    this.logger.log(
      `[OYUN ETKİNLİĞİ] Sistem başlatıldı: ${seededCount} aktif oturum önbellekten yüklendi.`
    );
    this.logCounterSummary('açılış durumu');

    // 5. Arka plan zamanlayıcılarını kur
    this.startBackgroundTimers(guild);

    return { enabled: true, seededCount, validation };
  }

  startBackgroundTimers(guild) {
    this._clearBackgroundTimers();

    const checkpointMs = Math.max(1000, Number(this.config.TIMINGS.CHECKPOINT_SEC || 60) * 1000);
    this.checkpointInterval = this._setInterval(() => {
      this.runCheckpoint();
    }, checkpointMs);
    this.checkpointInterval?.unref?.();

    const monthlyMs = Math.max(1000, Number(this.config.TIMINGS.MONTHLY_CHECK_INTERVAL_MS || 600000));
    this.monthlyCheckInterval = this._setInterval(() => {
      this.checkMonthlyReset(guild).catch(() => {});
    }, monthlyMs);
    this.monthlyCheckInterval?.unref?.();

    const sweepSec = Number(this.config.TIMINGS.SWEEP_SEC ?? 30);
    if (sweepSec > 0) {
      this.sweepInterval = this._setInterval(() => {
        this.runSweep(guild).catch(() => {});
      }, Math.max(1000, sweepSec * 1000));
      this.sweepInterval?.unref?.();
    }

    const hourlyMs = Math.max(60000, Number(this.config.TIMINGS.HOURLY_LOG_INTERVAL_MS || 3600000));
    this.hourlyLogInterval = this._setInterval(() => {
      this.logCounterSummary('son 1 saat');
    }, hourlyMs);
    this.hourlyLogInterval?.unref?.();

    const cleanupDelayMs = Math.max(0, Number(this.config.TIMINGS.STARTUP_CLEANUP_DELAY_MS ?? 120000));
    this.startupCleanupTimer = this._setTimeout(() => {
      this.startupCleanupTimer = null;
      this.runStartupRoleCleanup(guild).catch(() => {});
    }, cleanupDelayMs);
    this.startupCleanupTimer?.unref?.();
  }

  _clearBackgroundTimers() {
    if (this.checkpointInterval) {
      this._clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
    if (this.monthlyCheckInterval) {
      this._clearInterval(this.monthlyCheckInterval);
      this.monthlyCheckInterval = null;
    }
    if (this.sweepInterval) {
      this._clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    if (this.hourlyLogInterval) {
      this._clearInterval(this.hourlyLogInterval);
      this.hourlyLogInterval = null;
    }
    if (this.startupCleanupTimer) {
      this._clearTimeout(this.startupCleanupTimer);
      this.startupCleanupTimer = null;
    }
  }

  /**
   * Açılıştan 2 dakika sonra tek seferlik aktiflik rolü temizliği yapar:
   * 4 aktiflik rolünden birine sahip olup o oyunu şu an oynamayan üyelerden rolü kuyrukla alır.
   */
  async runStartupRoleCleanup(guild) {
    if (!guild || !this.isPresenceIntentAvailable()) return { removedCount: 0 };

    let removedCount = 0;
    const promises = [];

    for (const [familyKey, family] of Object.entries(this.config.FAMILIES || {})) {
      if (this.disabledFamilyIds.has(familyKey)) continue;
      const role = guild.roles?.cache?.get?.(family.roleId);
      if (!role) continue;

      const holders = role.members
        ? Array.from(role.members.values())
        : Array.from(guild.members?.cache?.values?.() || []).filter((m) =>
            m.roles?.cache?.has?.(family.roleId)
          );

      for (const member of holders) {
        if (!member || member.user?.bot) continue;
        const userId = String(member.id);
        const trackingOn = this.getPrefs(userId).tracking;
        const session = this.sessions.get(userId);
        const liveDetected = trackingOn
          ? detectGame(member.presence || guild.presences?.cache?.get?.(userId), this.config, this.disabledGameIds)
          : null;

        const activelyPlayingFamily =
          trackingOn &&
          ((session && session.confirmed && session.family === familyKey) ||
            (liveDetected && liveDetected.family === familyKey));

        if (!activelyPlayingFamily) {
          removedCount += 1;
          promises.push(this.enqueueRoleRemove(member, family.roleId, familyKey, 'Açılış aktiflik rolü temizliği'));
        }
      }
    }

    await Promise.all(promises);
    if (removedCount > 0) {
      this.logger.log(
        `[OYUN ETKİNLİĞİ] Açılış rol temizliği tamamlandı: ${removedCount} pasif aktiflik rolü kaldırıldı.`
      );
    }
    return { removedCount };
  }

  // =========================================================================
  // 4. PRESENCE UPDATE & DURUM MAKİNESİ
  // =========================================================================

  handlePresenceUpdate(oldPresence, newPresence) {
    if (!this.isPresenceIntentAvailable()) return;
    if (!newPresence) return;

    this.counters.presenceReceived += 1;

    const user = newPresence.user || newPresence.member?.user || oldPresence?.user;
    const userId = newPresence.userId || user?.id;
    if (!userId || user?.bot) return;

    const uid = String(userId);
    const prefs = this.getPrefs(uid);
    if (!prefs.tracking) return;

    // Hızlı eleme: Playing etkinlikleri birebir aynıysa ağır iş yapma
    if (oldPresence && getPlayingActivitiesSignature(oldPresence) === getPlayingActivitiesSignature(newPresence)) {
      return;
    }

    this.counters.presenceProcessed += 1;

    const classified = classifyPresence(newPresence, this.config, this.disabledGameIds);
    if (classified.hasPlaying) {
      this.counters.presenceWithPlaying += 1;
      if (classified.kind === 'matched') {
        this.counters.matchedGame += 1;
      } else if (classified.kind === 'roblox_unknown') {
        this.counters.generalRoblox += 1;
      } else if (classified.kind === 'unmatched') {
        this.counters.unmatchedActivity += 1;
      } else if (classified.kind === 'ignored') {
        this.counters.ignoredActivity += 1;
      }
    }

    const guild = newPresence.guild || this.guild;
    const member = newPresence.member || guild?.members?.cache?.get?.(uid) || null;

    this.processDetectedGame({
      userId: uid,
      member,
      guild,
      detected: classified.detected,
    });
  }

  /**
   * Tespit edilen oyunu (veya null) kullanıcı durum makinesine uygular.
   */
  processDetectedGame({ userId, member, guild, detected, skipEvaluate = false }) {
    const uid = String(userId);
    const now = this.now();
    let session = this.sessions.get(uid);

    // 1. Hiç oturum yokken
    if (!session) {
      if (!detected) return;

      const activityStart =
        detected.startedAt > 0 && detected.startedAt <= now ? detected.startedAt : now;

      session = {
        userId: uid,
        confirmed: false,
        gameId: null,
        family: null,
        currentlyDetectedGameId: detected.gameId,
        since: null,
        activityStartedAt: null,
        lastAccountedAt: null,
        lastSeen: null,
        moveToken: false,
        sweepBlockedForMoveFail: false,
        pendingGameId: detected.gameId,
        pendingFamily: detected.family,
        pendingSince: now,
        pendingActivityStartedAt: activityStart,
        confirmTimer: null,
        stopGraceTimer: null,
        voiceJoinTimer: null,
      };
      this.sessions.set(uid, session);
      this._scheduleConfirm(session, member, guild);
      return;
    }

    // 2. Henüz onaylanmamış (CONFIRM_SEC bekleyen) oturum
    if (!session.confirmed) {
      if (!detected) {
        this._clearSessionTimers(session);
        this.sessions.delete(uid);
        return;
      }

      session.currentlyDetectedGameId = detected.gameId;
      if (detected.gameId !== session.pendingGameId) {
        this._clearTimer(session, 'confirmTimer');
        session.pendingGameId = detected.gameId;
        session.pendingFamily = detected.family;
        session.pendingSince = now;
        session.pendingActivityStartedAt =
          detected.startedAt > 0 && detected.startedAt <= now ? detected.startedAt : now;
        this._scheduleConfirm(session, member, guild);
      }
      return;
    }

    // 3. Onaylı oturum sürüyor
    // 3a. Aynı oyun hâlâ aktif (veya STOP_GRACE içinde aynı oyun geri döndü)
    if (detected && detected.gameId === session.gameId) {
      // Eğer stopGrace içindeyken geri döndüyse, duraklama aralığını süreye katmamak için lastAccountedAt'i şimdiye çek
      if (session.currentlyDetectedGameId !== session.gameId) {
        session.lastAccountedAt = now;
      }
      session.currentlyDetectedGameId = detected.gameId;
      session.lastSeen = now;
      this._clearTimer(session, 'stopGraceTimer');
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = null;
      session.pendingFamily = null;
      session.pendingSince = null;
      session.pendingActivityStartedAt = null;
      return;
    }

    // 3b. Etkinlik bitti (oyun yok / eşleşmeyen / yoksayılan)
    if (!detected) {
      // İlk kez duruyorsa o ana kadar biriken süreyi HEMEN kaydet (60 sn grace beklerken /aktivitem boş kalmasın!)
      if (session.currentlyDetectedGameId === session.gameId) {
        session.lastSeen = now;
        this._flushSessionElapsed(session, now);
        this.db.flushDirty();
      }
      session.currentlyDetectedGameId = null;

      // Varsa bekleyen başka oyun onayını iptal et
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = null;
      session.pendingFamily = null;
      session.pendingSince = null;
      session.pendingActivityStartedAt = null;

      // Aktif geri sayım varsa GAME_STOPPED olarak iptal edip sil (hak tüketilmez)
      if (this.activeCountdowns.has(uid)) {
        const cd = this.activeCountdowns.get(uid);
        this.cancelActiveCountdown(uid, { consumeToken: false });
        this.recordDecision(uid, {
          trigger: cd.trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.GAME_STOPPED,
          game: cd.displayGameName,
          fromChannelId: cd.fromChannelId,
          toChannelId: cd.targetChannelId,
        });
      }

      if (!session.stopGraceTimer) {
        this._scheduleStopGrace(session, member, guild);
      }
      return;
    }

    // 3c. Farklı bir oyuna geçildi (detected.gameId !== session.gameId)
    if (session.currentlyDetectedGameId === session.gameId) {
      session.lastSeen = now;
      this._flushSessionElapsed(session, now);
      this.db.flushDirty();
    }
    session.currentlyDetectedGameId = detected.gameId;

    // Eski oyun için geri sayım sürüyorsa GAME_CHANGED_DURING_COUNTDOWN olarak iptal edip sil
    if (this.activeCountdowns.has(uid)) {
      const cd = this.activeCountdowns.get(uid);
      this.cancelActiveCountdown(uid, { consumeToken: false });
      this.recordDecision(uid, {
        trigger: cd.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.GAME_CHANGED_DURING_COUNTDOWN,
        game: cd.displayGameName,
        fromChannelId: cd.fromChannelId,
        toChannelId: cd.targetChannelId,
      });
    }

    // Yeni oyun henüz beklemede değilse veya başka bir yeni oyuna değiştiyse CONFIRM_SEC başlat
    if (session.pendingGameId !== detected.gameId) {
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = detected.gameId;
      session.pendingFamily = detected.family;
      session.pendingSince = now;
      session.pendingActivityStartedAt =
        detected.startedAt > 0 && detected.startedAt <= now ? detected.startedAt : now;
      this._scheduleConfirm(session, member, guild, { skipEvaluate });
    }

    // Yeni oyun CONFIRM_SEC'ten önce kapanırsa eski oturumun sonsuza dek asılı kalmaması için stopGrace garanti et
    if (!session.stopGraceTimer) {
      this._scheduleStopGrace(session, member, guild);
    }
  }

  _scheduleConfirm(session, member, guild, { delayOverrideMs = null } = {}) {
    this._clearTimer(session, 'confirmTimer');
    const defaultConfirmMs = Math.max(0, Number(this.config.TIMINGS.CONFIRM_SEC ?? 15) * 1000);
    const confirmMs = delayOverrideMs !== null ? Math.max(0, delayOverrideMs) : defaultConfirmMs;
    const targetGameId = session.pendingGameId;
    const targetFamily = session.pendingFamily;
    const targetSince = session.pendingSince || this.now();
    const targetActivityStart = session.pendingActivityStartedAt || targetSince;

    session.confirmTimer = this._setTimeout(() => {
      session.confirmTimer = null;
      this._onConfirmElapsed(
        session.userId,
        targetGameId,
        targetFamily,
        targetSince,
        targetActivityStart,
        member,
        guild
      );
    }, confirmMs);
    session.confirmTimer?.unref?.();
  }

  _onConfirmElapsed(
    userId,
    newGameId,
    newFamily,
    startedSince,
    activityStartedAt,
    memberHint,
    guildHint,
    { skipEvaluate = false } = {}
  ) {
    const uid = String(userId);
    const session = this.sessions.get(uid);
    if (!session || session.pendingGameId !== newGameId) return;

    if (!this.getPrefs(uid).tracking) {
      this._clearSessionTimers(session);
      this.sessions.delete(uid);
      return;
    }

    const now = this.now();
    const guild = guildHint || this.guild;
    const member = guild?.members?.cache?.get?.(uid) || memberHint || null;

    // Önceki onaylı oturum varsa (oyun değişimi): eski süresini son görülme anına kadar işle
    const prevFamily = session.confirmed ? session.family : null;
    if (session.confirmed && session.gameId) {
      this._flushSessionElapsed(session, session.lastSeen || now);
    }

    // Eski stopGrace / voiceJoin zamanlayıcılarını temizle
    this._clearTimer(session, 'stopGraceTimer');
    this._clearTimer(session, 'voiceJoinTimer');

    // Yeni oturumu onayla ve yeni aktarma hakkı (moveToken = true) ver
    session.confirmed = true;
    session.gameId = newGameId;
    session.family = newFamily;
    session.currentlyDetectedGameId = newGameId;
    session.since = startedSince;
    session.activityStartedAt = activityStartedAt || startedSince;
    session.lastAccountedAt = startedSince;
    session.lastSeen = now;
    session.moveToken = true;
    session.sweepBlockedForMoveFail = false;
    session.pendingGameId = null;
    session.pendingFamily = null;
    session.pendingSince = null;
    session.pendingActivityStartedAt = null;

    this.counters.sessionConfirmed += 1;

    // Rol senkronizasyonu: aynı aile içinde (örn: Roblox -> Roblox) rol DEĞİŞTİRME
    if (member && prevFamily !== newFamily) {
      this.syncMemberFamilyRoles(member, newFamily);
    } else if (member && !prevFamily) {
      this.syncMemberFamilyRoles(member, newFamily);
    } else if (!member && guild?.members?.fetch) {
      // Üye önbellekte yoksa getirip rolünü ve aktarmasını değerlendir
      guild.members
        .fetch(uid)
        .then((fetchedMember) => {
          if (!fetchedMember) return;
          const liveSess = this.sessions.get(uid);
          if (!liveSess || !liveSess.confirmed || liveSess.gameId !== newGameId) return;
          this.syncMemberFamilyRoles(fetchedMember, newFamily);
          if (!skipEvaluate) {
            this.evaluateTransfer(fetchedMember, 'game-confirmed').catch(() => {});
          }
        })
        .catch(() => {});
      return;
    }

    // Tek merkezi aktarma değerlendirme fonksiyonunu çağır
    if (!skipEvaluate && (member || guild)) {
      this.evaluateTransfer(member || uid, 'game-confirmed').catch(() => {});
    }
  }

  _scheduleStopGrace(session, member, guild) {
    this._clearTimer(session, 'stopGraceTimer');
    const graceMs = Math.max(0, Number(this.config.TIMINGS.STOP_GRACE_SEC ?? 60) * 1000);

    session.stopGraceTimer = this._setTimeout(() => {
      session.stopGraceTimer = null;
      this._onStopGraceElapsed(session.userId, member, guild);
    }, graceMs);
    session.stopGraceTimer?.unref?.();
  }

  _onStopGraceElapsed(userId, memberHint, guildHint) {
    const uid = String(userId);
    const session = this.sessions.get(uid);
    if (!session) return;

    // Son görülme anına kadar olan süreyi kaydet (bekleme süresi ASLA eklenmez)
    if (session.confirmed && session.gameId) {
      this._flushSessionElapsed(session, session.lastSeen || this.now());
      this.db.flushDirty();
    }

    const oldFamily = session.family;
    const guild = guildHint || this.guild;
    const member = guild?.members?.cache?.get?.(uid) || memberHint || null;

    this.cancelActiveCountdown(uid, { consumeToken: false });
    this._clearSessionTimers(session);
    this.sessions.delete(uid);

    if (member && oldFamily && !this.disabledFamilyIds.has(oldFamily)) {
      const roleId = this.config.FAMILIES?.[oldFamily]?.roleId;
      if (roleId) {
        this.enqueueRoleRemove(member, roleId, oldFamily, 'Oyun etkinliği sona erdi');
      }
    }
  }

  // =========================================================================
  // 5. AKTİFLİK ROLLERİ YÖNETİMİ (Kuyruklu ve Hata Dayanıklı)
  // =========================================================================

  syncMemberFamilyRoles(member, targetFamily) {
    if (!member || member.user?.bot) return;
    if (!this.getPrefs(member.id).tracking) return;

    for (const [familyKey, family] of Object.entries(this.config.FAMILIES || {})) {
      if (this.disabledFamilyIds.has(familyKey) || !family.roleId) continue;
      if (familyKey === targetFamily) {
        this.enqueueRoleAdd(member, family.roleId, familyKey, 'Oyun etkinliği başladı');
      } else if (member.roles?.cache?.has?.(family.roleId)) {
        this.enqueueRoleRemove(member, family.roleId, familyKey, 'Oyun ailesi değişti');
      }
    }
  }

  removeAllActivityRoles(member, reason = 'Etkinlik takibi kapatıldı') {
    if (!member || member.user?.bot) return Promise.resolve();
    const tasks = [];
    for (const [familyKey, family] of Object.entries(this.config.FAMILIES || {})) {
      if (this.disabledFamilyIds.has(familyKey) || !family.roleId) continue;
      if (member.roles?.cache?.has?.(family.roleId)) {
        tasks.push(this.enqueueRoleRemove(member, family.roleId, familyKey, reason));
      }
    }
    return Promise.all(tasks);
  }

  enqueueRoleAdd(member, roleId, familyKey, reason) {
    if (!member || !roleId || member.user?.bot) return Promise.resolve(false);
    // Zaten varsa gereksiz API çağrısı yapma
    if (member.roles?.cache?.has?.(roleId)) return Promise.resolve(false);

    return this.roleQueue.enqueue(async () => {
      if (member.roles?.cache?.has?.(roleId)) return false;
      try {
        await member.roles.add(roleId, reason);
        this.counters.roleAdded += 1;
        return true;
      } catch (err) {
        this.counters.roleFailed += 1;
        this._handleRoleApiError(err, familyKey, 'eklenemedi');
        return false;
      }
    });
  }

  enqueueRoleRemove(member, roleId, familyKey, reason) {
    if (!member || !roleId || member.user?.bot) return Promise.resolve(false);
    // Zaten yoksa gereksiz API çağrısı yapma
    if (!member.roles?.cache?.has?.(roleId)) return Promise.resolve(false);

    return this.roleQueue.enqueue(async () => {
      if (!member.roles?.cache?.has?.(roleId)) return false;
      try {
        await member.roles.remove(roleId, reason);
        return true;
      } catch (err) {
        this.counters.roleFailed += 1;
        this._handleRoleApiError(err, familyKey, 'kaldırılamadı');
        return false;
      }
    });
  }

  _handleRoleApiError(err, familyKey, actionText) {
    const code = err?.code || err?.status;
    if (code === 429) {
      const retryMs = Number(err?.retryAfter || err?.data?.retry_after * 1000) || 2000;
      this.roleQueue.pauseFor(retryMs);
      this.logErrorThrottled(
        'role:429',
        '[OYUN ETKİNLİĞİ ROL UYARISI] Discord rol hız sınırına (429) takılındı; kuyruk geçici beklemeye alındı.'
      );
      return;
    }
    if (code === 50013) {
      this.logErrorThrottled(
        `role:50013:${familyKey}`,
        `[OYUN ETKİNLİĞİ ROL HATASI] '${familyKey}' aktiflik rolü ${actionText} (50013: yetki veya rol hiyerarşisi yetersiz).`
      );
      return;
    }
    if (code === 10011) {
      this.logErrorThrottled(
        `role:10011:${familyKey}`,
        `[OYUN ETKİNLİĞİ ROL HATASI] '${familyKey}' aktiflik rolü sunucuda bulunamadı (10011).`
      );
      return;
    }
    this.logErrorThrottled(
      `role:other:${familyKey}:${code || 'err'}`,
      `[OYUN ETKİNLİĞİ ROL HATASI] '${familyKey}' rol işlemi başarısız (${code || err?.message || 'bilinmeyen hata'}).`
    );
  }

  // =========================================================================
  // 6. TEK MERKEZİ SES KANALI AKTARIM KARAR FONKSİYONU (evaluateTransfer)
  // =========================================================================

  isChannelBlockedForMove(guild, channel) {
    if (!channel) return true;
    if (guild?.afkChannelId && String(channel.id) === String(guild.afkChannelId)) return true;
    if (channel.type === ChannelType.GuildStageVoice) return true;
    if (Array.isArray(this.config.NO_MOVE_CHANNEL_IDS) && this.config.NO_MOVE_CHANNEL_IDS.includes(String(channel.id))) {
      return true;
    }
    return false;
  }

  getCandidateChannelIds(gameId) {
    if (this.validChannelIdsByGame.has(gameId)) {
      return this.validChannelIdsByGame.get(gameId);
    }
    const cfgGame = this.config.getGameConfigById(gameId, this.config);
    return Array.isArray(cfgGame?.voiceChannelIds) ? cfgGame.voiceChannelIds : [];
  }

  getRawConfiguredChannelIds(gameId) {
    const cfgGame = this.config.getGameConfigById(gameId, this.config);
    return Array.isArray(cfgGame?.voiceChannelIds) ? cfgGame.voiceChannelIds : [];
  }

  /**
   * Geriye dönük uyumluluk sarmalayıcısı (tüm çağrıları evaluateTransfer'a yönlendirir).
   */
  async tryStartVoiceTransfer(guild, member) {
    if (guild && !this.guild) this.guild = guild;
    return this.evaluateTransfer(member, 'game-confirmed');
  }

  /**
   * TEK MERKEZİ AKTARMA KARAR FONKSİYONU.
   * Tüm tetikleyiciler ('game-confirmed' | 'voice-join' | 'voice-switch' | 'sweep') yalnızca bunu çağırır.
   */
  async evaluateTransfer(memberOrId, trigger = 'game-confirmed') {
    const uid =
      typeof memberOrId === 'string'
        ? String(memberOrId)
        : String(memberOrId?.id || memberOrId?.user?.id || '');
    if (!uid) return { started: false, result: 'skipped', reason: TRANSFER_REASONS.NO_PRESENCE_DATA };

    const guild = (typeof memberOrId === 'object' ? memberOrId?.guild : null) || this.guild;
    let member =
      (typeof memberOrId === 'object' && memberOrId?.id ? memberOrId : null) ||
      guild?.members?.cache?.get?.(uid) ||
      null;

    if (!member && typeof guild?.members?.fetch === 'function') {
      member = await guild.members.fetch(uid).catch(() => null);
    }

    if (member?.user?.bot) {
      return { started: false, result: 'skipped', reason: TRANSFER_REASONS.TRACKING_OFF };
    }

    // Kullanıcı başına tek aktif değerlendirme / geri sayım kilidi
    if (this.evaluatingUsers.has(uid) || this.activeCountdowns.has(uid)) {
      return { started: false, result: 'pending', reason: TRANSFER_REASONS.COUNTDOWN_PENDING };
    }

    this.evaluatingUsers.add(uid);
    try {
      // ADIM 1: Kullanıcı tercihleri (getPrefs -> kaydı olmayan üyeye tracking:true, autoMove:true döner)
      const prefs = this.getPrefs(uid);
      if (!prefs.tracking) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.TRACKING_OFF,
        });
      }
      if (!prefs.autoMove) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.AUTOMOVE_OFF,
        });
      }

      // ADIM 2: Üyenin anlık ses kanalı durumu (seste değilse HAK TÜKETİLMEZ)
      const voiceState = member?.voice || guild?.voiceStates?.cache?.get?.(uid) || null;
      const currentChannelId = voiceState?.channelId || null;
      if (!currentChannelId) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NOT_IN_VOICE,
        });
      }

      const currentChannel =
        voiceState?.channel || guild?.channels?.cache?.get?.(currentChannelId) || null;
      if (this.isChannelBlockedForMove(guild, currentChannel)) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.EXCLUDED_CHANNEL,
          fromChannelId: currentChannelId,
        });
      }

      // ADIM 3: Canlı presence oku (yoksa fetch({ withPresences: true }), yoksa tracker oturumu)
      if (!this.isPresenceIntentAvailable()) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NO_PRESENCE_DATA,
          fromChannelId: currentChannelId,
        });
      }

      let livePresence = member?.presence || guild?.presences?.cache?.get?.(uid) || null;
      if (!livePresence && typeof guild?.members?.fetch === 'function') {
        try {
          const fetched = await guild.members.fetch({ user: [uid], withPresences: true });
          const fetchedMember =
            typeof fetched?.get === 'function'
              ? fetched.get(uid)
              : fetched?.id === uid
                ? fetched
                : null;
          if (fetchedMember) {
            member = fetchedMember;
            livePresence = fetchedMember.presence || guild?.presences?.cache?.get?.(uid) || null;
          }
        } catch (fetchErr) {
          // Sürüm veya ortam desteklemiyorsa tracker oturumuna düşer
        }
      }

      let session = this.sessions.get(uid) || null;

      if (!livePresence && !session) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NO_PRESENCE_DATA,
          fromChannelId: currentChannelId,
        });
      }

      // ADIM 4: Canlı presence varsa detectGame ile sınıflandır ve tracker oturumuyla uzlaştır
      const now = this.now();
      const confirmMs = Math.max(0, Number(this.config.TIMINGS.CONFIRM_SEC ?? 15) * 1000);

      if (livePresence) {
        const classified = classifyPresence(livePresence, this.config, this.disabledGameIds);

        if (classified.kind === 'not_playing') {
          if (session) {
            this.processDetectedGame({ userId: uid, member, guild, detected: null, skipEvaluate: true });
          }
          return this.recordDecision(uid, {
            trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.NOT_PLAYING,
            fromChannelId: currentChannelId,
          });
        }

        if (classified.kind === 'ignored') {
          if (session) {
            this.processDetectedGame({ userId: uid, member, guild, detected: null, skipEvaluate: true });
          }
          return this.recordDecision(uid, {
            trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.ACTIVITY_IGNORED,
            game: classified.rawName,
            fromChannelId: currentChannelId,
          });
        }

        if (classified.kind === 'unmatched') {
          if (session) {
            this.processDetectedGame({ userId: uid, member, guild, detected: null, skipEvaluate: true });
          }
          return this.recordDecision(uid, {
            trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.UNMATCHED_ACTIVITY,
            game: classified.rawName,
            fromChannelId: currentChannelId,
          });
        }

        const detected = classified.detected;
        // Tracker oturumu yoksa veya farklı oyundaysa uzlaştır
        const isConfirmedSame =
          session && session.confirmed && session.gameId === detected.gameId && !session.pendingGameId;
        const isPendingSame =
          session && session.pendingGameId === detected.gameId;

        if (!isConfirmedSame && !isPendingSame) {
          this.processDetectedGame({
            userId: uid,
            member,
            guild,
            detected,
            skipEvaluate: true,
          });
          session = this.sessions.get(uid);
        } else if (isConfirmedSame && session.currentlyDetectedGameId !== detected.gameId) {
          this.processDetectedGame({
            userId: uid,
            member,
            guild,
            detected,
            skipEvaluate: true,
          });
          session = this.sessions.get(uid);
        }

        // Eğer oyun henüz onaylanmamışsa (veya yeni oyuna geçiş bekleniyorsa) timestamps.start / pendingSince kontrolü yap
        if (session && (!session.confirmed || session.pendingGameId)) {
          const targetGameId = session.pendingGameId || detected.gameId;
          const trackerStart = session.pendingSince || session.since || now;
          const presenceStart =
            detected.startedAt > 0 && detected.startedAt <= now ? detected.startedAt : trackerStart;
          const earliestStart = Math.min(trackerStart, presenceStart);
          const elapsedMs = Math.max(0, now - earliestStart);

          if (elapsedMs >= confirmMs) {
            // Oyun zaten en az CONFIRM_SEC süredir açık -> hemen onayla!
            this._clearTimer(session, 'confirmTimer');
            this._onConfirmElapsed(
              uid,
              targetGameId,
              session.pendingFamily || detected.family,
              session.pendingSince || now,
              earliestStart,
              member,
              guild,
              { skipEvaluate: true }
            );
            session = this.sessions.get(uid);
          } else {
            // Kalan süre sonunda yeniden değerlendirilecek şekilde confirmTimer kur
            const remainingMs = confirmMs - elapsedMs;
            this._scheduleConfirm(session, member, guild, { delayOverrideMs: remainingMs });
            return this.recordDecision(uid, {
              trigger,
              result: 'pending',
              reason: TRANSFER_REASONS.WAITING_CONFIRM,
              game: this.getGameLabel(targetGameId),
              fromChannelId: currentChannelId,
            });
          }
        }
      } else {
        // Canlı presence alınamadı ama tracker'da oturum var
        if (!session.currentlyDetectedGameId && !session.pendingGameId) {
          return this.recordDecision(uid, {
            trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.NOT_PLAYING,
            fromChannelId: currentChannelId,
          });
        }
        if (!session.confirmed || session.pendingGameId) {
          const targetGameId = session.pendingGameId || session.gameId;
          const earliestStart = Math.min(
            session.pendingSince || now,
            session.pendingActivityStartedAt || now
          );
          const elapsedMs = Math.max(0, now - earliestStart);
          if (elapsedMs < confirmMs) {
            return this.recordDecision(uid, {
              trigger,
              result: 'pending',
              reason: TRANSFER_REASONS.WAITING_CONFIRM,
              game: this.getGameLabel(targetGameId),
              fromChannelId: currentChannelId,
            });
          }
          this._clearTimer(session, 'confirmTimer');
          this._onConfirmElapsed(
            uid,
            targetGameId,
            session.pendingFamily || session.family,
            session.pendingSince || now,
            earliestStart,
            member,
            guild,
            { skipEvaluate: true }
          );
          session = this.sessions.get(uid);
        }
      }

      if (!session || !session.confirmed || !session.gameId) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NOT_PLAYING,
          fromChannelId: currentChannelId,
        });
      }

      const displayGameName = this.getGameLabel(session.gameId);

      // ADIM 6: Aktarma hakkı (moveToken) kontrolü
      if (!session.moveToken) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.TOKEN_SPENT,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      // Yedek taramada (sweep) daha önce MOVE_FAILED yaşandıysa aynı oturumda otomatik yeniden deneme yapma
      if (trigger === 'sweep' && session.sweepBlockedForMoveFail) {
        return { started: false, result: 'skipped', reason: TRANSFER_REASONS.MOVE_FAILED };
      }

      // ADIM 7: Hedef kanal ve izin kontrolleri
      const rawChannelIds = this.getRawConfiguredChannelIds(session.gameId);
      const candidateIds = this.getCandidateChannelIds(session.gameId);
      const checkIds = rawChannelIds.length > 0 ? rawChannelIds : candidateIds;

      // Üye ZATEN hedef kanallardan birindeyse -> ALREADY_IN_TARGET ve hak TÜKETİLİR
      if (checkIds.includes(String(currentChannelId))) {
        session.moveToken = false;
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.ALREADY_IN_TARGET,
          game: displayGameName,
          fromChannelId: currentChannelId,
          toChannelId: currentChannelId,
        });
      }

      if (candidateIds.length === 0) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.TARGET_NOT_FOUND,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      // Botun genel MoveMembers iznini kontrol et
      const botMember = guild?.members?.me || null;
      if (botMember?.permissions?.has && !botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
        this.logErrorThrottled(
          'move:no_permission',
          '[OYUN ETKİNLİĞİ AKTARMA UYARISI] Botun "Üyeleri Taşı" (MoveMembers) izni eksik (NO_MOVE_PERMISSION).'
        );
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NO_MOVE_PERMISSION,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      const selection = selectTargetVoiceChannel({
        guild,
        gameId: session.gameId,
        candidateChannelIds: candidateIds,
        sessionsMap: this.sessions,
        excludeUserId: uid,
      });

      if (selection.notFound) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.TARGET_NOT_FOUND,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      if (selection.noPermission) {
        this.logErrorThrottled(
          'move:no_channel_permission',
          '[OYUN ETKİNLİĞİ AKTARMA UYARISI] Hedef ses kanalında botun Görüntüle/Bağlan izni eksik (NO_MOVE_PERMISSION).'
        );
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.NO_MOVE_PERMISSION,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      if (selection.allFull || !selection.channel) {
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: selection.allFull ? TRANSFER_REASONS.TARGET_FULL : TRANSFER_REASONS.TARGET_NOT_FOUND,
          game: displayGameName,
          fromChannelId: currentChannelId,
        });
      }

      const targetChannel = selection.channel;

      // ADIM 8: Komut kanalı varlığı ve Kanalı Görüntüle + Mesaj Gönder izni kontrolü
      const cmdChannel = guild?.channels?.cache?.get?.(this.config.COMMAND_CHANNEL_ID) || null;
      let cmdChannelSendable = Boolean(cmdChannel && typeof cmdChannel.send === 'function');
      if (cmdChannelSendable && botMember && typeof cmdChannel.permissionsFor === 'function') {
        const cmdPerms = cmdChannel.permissionsFor(botMember);
        if (cmdPerms && typeof cmdPerms.has === 'function') {
          if (
            !cmdPerms.has(PermissionFlagsBits.ViewChannel) ||
            !cmdPerms.has(PermissionFlagsBits.SendMessages)
          ) {
            cmdChannelSendable = false;
          }
        }
      }

      if (!cmdChannelSendable) {
        this.logErrorThrottled(
          'cmd_channel_unavailable',
          `[OYUN ETKİNLİĞİ AKTARMA UYARISI] Komut kanalı (${this.config.COMMAND_CHANNEL_ID}) bulunamadı veya Mesaj Gönder izni eksik (COMMAND_CHANNEL_UNAVAILABLE); aktarma yapılmadı.`
        );
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.COMMAND_CHANNEL_UNAVAILABLE,
          game: displayGameName,
          fromChannelId: currentChannelId,
          toChannelId: targetChannel.id,
        });
      }

      // ADIM 9: 10 sn Geri sayımı başlat (COUNTDOWN_PENDING)
      const countdownSec = Math.max(1, Number(this.config.TIMINGS.COUNTDOWN_SEC ?? 10));
      const targetUnix = Math.floor((this.now() + countdownSec * 1000) / 1000);
      const token = Math.random().toString(36).slice(2, 8);
      const lang = resolveLang(uid);
      const isEn = lang === 'en';
      const localizedGameName = this.getGameLabel(session.gameId, lang);

      const content = isEn
        ? `🎮 <@${uid}> you've switched to **${localizedGameName}**!\n🔊 Moving you to the game's voice channel: <#${targetChannel.id}>\n⏳ Transfer: <t:${targetUnix}:R>\nPress the button below if you don't want this.`
        : `🎮 <@${uid}> **${localizedGameName}** oyununa geçiş sağladınız!\n🔊 Sizi oyunun ses kanalına aktarıyorum: <#${targetChannel.id}>\n⏳ Aktarma: <t:${targetUnix}:R>\nİstemiyorsanız aşağıdaki butona basın.`;

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`act_cancel:${uid}:${token}`)
          .setLabel(isEn ? '❌ Cancel Transfer' : '❌ Aktarmayı İptal Et')
          .setStyle(ButtonStyle.Danger)
      );

      let sentMsg;
      try {
        sentMsg = await cmdChannel.send({
          content,
          components: [cancelRow],
          allowedMentions: { parse: [], users: [uid] },
        });
      } catch (err) {
        this.logErrorThrottled(
          'cmd_channel_send_error',
          `[OYUN ETKİNLİĞİ AKTARMA UYARISI] Komut kanalına geri sayım mesajı gönderilemedi (${err?.code || err?.message} - COMMAND_CHANNEL_UNAVAILABLE); aktarma iptal edildi.`
        );
        return this.recordDecision(uid, {
          trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.COMMAND_CHANNEL_UNAVAILABLE,
          game: displayGameName,
          fromChannelId: currentChannelId,
          toChannelId: targetChannel.id,
        });
      }

      const countdownEntry = {
        userId: uid,
        token,
        trigger,
        gameId: session.gameId,
        fromChannelId: currentChannelId,
        targetChannelId: targetChannel.id,
        displayGameName,
        member,
        message: sentMsg,
        timer: null,
      };

      countdownEntry.timer = this._setTimeout(() => {
        this._executeCountdownCompletion(guild, uid, token).catch(() => {});
      }, countdownSec * 1000);
      countdownEntry.timer?.unref?.();

      this.activeCountdowns.set(uid, countdownEntry);
      const decision = this.recordDecision(uid, {
        trigger,
        result: 'pending',
        reason: TRANSFER_REASONS.COUNTDOWN_PENDING,
        game: displayGameName,
        fromChannelId: currentChannelId,
        toChannelId: targetChannel.id,
      });

      return {
        ...decision,
        started: true,
        token,
        targetChannelId: targetChannel.id,
        message: sentMsg,
      };
    } finally {
      this.evaluatingUsers.delete(uid);
    }
  }

  async _executeCountdownCompletion(guild, userId, token) {
    const uid = String(userId);
    const entry = this.activeCountdowns.get(uid);
    if (!entry || entry.token !== token) return;

    this.activeCountdowns.delete(uid);

    const session = this.sessions.get(uid);
    const member = guild?.members?.cache?.get?.(uid) || entry.member || null;
    const deleteMsg = () => entry.message?.delete?.().catch(() => {});

    const liveChannelId =
      member?.voice?.channelId || guild?.voiceStates?.cache?.get?.(uid)?.channelId || null;

    // 1. Sesten çıktıysa -> LEFT_VOICE_DURING_COUNTDOWN (hak TÜKETİLMEZ!)
    if (!liveChannelId) {
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.LEFT_VOICE_DURING_COUNTDOWN,
        game: entry.displayGameName,
        fromChannelId: entry.fromChannelId,
        toChannelId: entry.targetChannelId,
      });
      return;
    }

    // 2. Oyun bırakıldıysa -> GAME_STOPPED
    if (!session || (!session.currentlyDetectedGameId && !session.pendingGameId)) {
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.GAME_STOPPED,
        game: entry.displayGameName,
        fromChannelId: liveChannelId,
        toChannelId: entry.targetChannelId,
      });
      return;
    }

    // 3. Oyun değiştiyse -> GAME_CHANGED_DURING_COUNTDOWN
    if (!session.confirmed || session.gameId !== entry.gameId || session.currentlyDetectedGameId !== entry.gameId) {
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.GAME_CHANGED_DURING_COUNTDOWN,
        game: entry.displayGameName,
        fromChannelId: liveChannelId,
        toChannelId: entry.targetChannelId,
      });
      return;
    }

    // 4. Takip veya otomatik aktarma kapatıldıysa
    const prefs = this.getPrefs(uid);
    if (!prefs.tracking || !prefs.autoMove) {
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: !prefs.tracking ? TRANSFER_REASONS.TRACKING_OFF : TRANSFER_REASONS.AUTOMOVE_OFF,
        game: entry.displayGameName,
        fromChannelId: liveChannelId,
        toChannelId: entry.targetChannelId,
      });
      return;
    }

    const candidateIds = this.getCandidateChannelIds(session.gameId);
    const rawChannelIds = this.getRawConfiguredChannelIds(session.gameId);
    const checkIds = rawChannelIds.length > 0 ? rawChannelIds : candidateIds;

    // 5. Üye kendisi hedef kanala geçtiyse -> ALREADY_IN_TARGET (hak TÜKETİLİR!)
    if (checkIds.includes(String(liveChannelId))) {
      session.moveToken = false;
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.ALREADY_IN_TARGET,
        game: entry.displayGameName,
        fromChannelId: liveChannelId,
        toChannelId: liveChannelId,
      });
      return;
    }

    // 6. Engelli kanala (AFK/Stage/NO_MOVE) geçtiyse -> EXCLUDED_CHANNEL (hak TÜKETİLMEZ!)
    const currentChannel =
      member?.voice?.channel || guild?.channels?.cache?.get?.(liveChannelId) || null;
    if (this.isChannelBlockedForMove(guild, currentChannel)) {
      await deleteMsg();
      this.recordDecision(uid, {
        trigger: entry.trigger,
        result: 'skipped',
        reason: TRANSFER_REASONS.EXCLUDED_CHANNEL,
        game: entry.displayGameName,
        fromChannelId: liveChannelId,
        toChannelId: entry.targetChannelId,
      });
      return;
    }

    // 7. Hedef kanal hâlâ müsait mi kontrol et (doluysa başka boş kanal seç, hepsi doluysa hakkı tüketme)
    let targetChannelId = entry.targetChannelId;
    const targetChannel = guild?.channels?.cache?.get?.(targetChannelId) || null;
    const targetLimit = Number(targetChannel?.userLimit) || 0;
    const targetFull =
      !targetChannel || (targetLimit > 0 && (targetChannel.members?.size ?? 0) >= targetLimit);

    if (targetFull) {
      const reselected = selectTargetVoiceChannel({
        guild,
        gameId: session.gameId,
        candidateChannelIds: candidateIds,
        sessionsMap: this.sessions,
        excludeUserId: uid,
      });
      if (reselected.allFull || !reselected.channel) {
        await deleteMsg();
        this.recordDecision(uid, {
          trigger: entry.trigger,
          result: 'skipped',
          reason: reselected.allFull ? TRANSFER_REASONS.TARGET_FULL : TRANSFER_REASONS.TARGET_NOT_FOUND,
          game: entry.displayGameName,
          fromChannelId: liveChannelId,
          toChannelId: entry.targetChannelId,
        });
        return;
      }
      targetChannelId = reselected.channel.id;
    }

    // 8. Botun kendi taşımasının voiceStateUpdate'i tekrar tetiklememesi için 5 sn işaret koy
    this.markBotMoveIgnore(uid, targetChannelId);

    await this.moveQueue.enqueue(async () => {
      try {
        await member.voice.setChannel(targetChannelId, `Oyun aktarımı: ${entry.displayGameName}`);
        // Başarılı taşıma -> hak TÜKETİLİR!
        session.moveToken = false;
        this.recordDecision(uid, {
          trigger: entry.trigger,
          result: 'moved',
          reason: TRANSFER_REASONS.MOVED,
          game: entry.displayGameName,
          fromChannelId: liveChannelId,
          toChannelId: targetChannelId,
        });
      } catch (err) {
        this.botMoveIgnoreUntil.delete(uid);
        const code = err?.code || err?.status;
        if (code === 40032) {
          // Üye sesten çıkmış -> hak TÜKETİLMEZ!
          this.recordDecision(uid, {
            trigger: entry.trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.LEFT_VOICE_DURING_COUNTDOWN,
            game: entry.displayGameName,
            fromChannelId: liveChannelId,
            toChannelId: targetChannelId,
          });
        } else if (code === 50013 || code === 50001) {
          // İzin yok -> hak TÜKETİLMEZ!
          this._handleMoveApiError(err);
          this.recordDecision(uid, {
            trigger: entry.trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.NO_MOVE_PERMISSION,
            game: entry.displayGameName,
            fromChannelId: liveChannelId,
            toChannelId: targetChannelId,
          });
        } else {
          // Diğer taşıma hatası -> hak TÜKETİLMEZ, aynı oturumda otomatik yedek tarama denemesi kapatılır
          session.sweepBlockedForMoveFail = true;
          this._handleMoveApiError(err);
          this.recordDecision(uid, {
            trigger: entry.trigger,
            result: 'skipped',
            reason: TRANSFER_REASONS.MOVE_FAILED,
            game: entry.displayGameName,
            fromChannelId: liveChannelId,
            toChannelId: targetChannelId,
          });
        }
      }
    });

    await deleteMsg();
  }

  _handleMoveApiError(err) {
    const code = err?.code || err?.status;
    // 40032: Üye sesten çıkmış -> sessizce yoksay
    if (code === 40032) return;

    if (code === 429) {
      const retryMs = Number(err?.retryAfter || err?.data?.retry_after * 1000) || 2000;
      this.moveQueue.pauseFor(retryMs);
      this.logErrorThrottled(
        'move:429',
        '[OYUN ETKİNLİĞİ AKTARMA UYARISI] Discord ses taşıma hız sınırına (429) takılındı; kuyruk geçici beklemeye alındı.'
      );
      return;
    }

    if (code === 50013 || code === 50001) {
      this.logErrorThrottled(
        `move:${code}`,
        `[OYUN ETKİNLİĞİ AKTARMA HATASI] Ses kanalı taşıma izni yetersiz (${code} - NO_MOVE_PERMISSION: Üyeleri Taşı veya kanal erişimi eksik).`
      );
      return;
    }

    this.logErrorThrottled(
      `move:other:${code || 'err'}`,
      `[OYUN ETKİNLİĞİ AKTARMA HATASI] Ses kanalı taşıma başarısız (${code || err?.message || 'bilinmeyen hata'} - MOVE_FAILED).`
    );
  }

  cancelActiveCountdown(userId, { consumeToken = false } = {}) {
    const uid = String(userId);
    const entry = this.activeCountdowns.get(uid);
    if (!entry) return false;

    if (entry.timer) {
      this._clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.activeCountdowns.delete(uid);

    if (consumeToken) {
      const session = this.sessions.get(uid);
      if (session && session.gameId === entry.gameId) {
        session.moveToken = false;
      }
    }

    entry.message?.delete?.().catch(() => {});
    return true;
  }

  /**
   * "❌ Aktarmayı İptal Et" butonunu işler (customId: act_cancel:<userId>:<token>).
   */
  async handleCancelTransferButton(interaction) {
    const parts = String(interaction.customId || '').split(':');
    const targetUserId = parts[1];
    const token = parts[2];
    const lang = resolveLang(interaction);
    const isEn = lang === 'en';

    if (parts.length !== 3 || !targetUserId || !token) {
      return interaction.reply({
        content: isEn ? '⏱️ This transfer offer has expired.' : '⏱️ Bu aktarma teklifi eskidi.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    const entry = this.activeCountdowns.get(targetUserId);
    if (!entry || entry.token !== token) {
      return interaction.reply({
        content: isEn ? '⏱️ This transfer offer has expired.' : '⏱️ Bu aktarma teklifi eskidi.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    if (String(interaction.user?.id) !== String(targetUserId)) {
      return interaction.reply({
        content: isEn ? '❌ This button is not for you.' : '❌ Bu buton sana ait değil.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    // Sahibi iptal etti: zamanlayıcıyı durdur, hakkı tüket, karar izine yaz, mesajı güncelle ve 5 sn sonra sil
    if (entry.timer) {
      this._clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.activeCountdowns.delete(targetUserId);

    const session = this.sessions.get(targetUserId);
    if (session && session.gameId === entry.gameId) {
      session.moveToken = false;
    }

    this.recordDecision(targetUserId, {
      trigger: entry.trigger,
      result: 'cancelled',
      reason: TRANSFER_REASONS.CANCELLED_BY_USER,
      game: entry.displayGameName,
      fromChannelId: entry.fromChannelId,
      toChannelId: entry.targetChannelId,
    });

    await interaction.update({
      content: isEn ? '❌ Transfer cancelled.' : '❌ Aktarma iptal edildi.',
      components: [],
      allowedMentions: { parse: [] },
    });

    const msgRef = interaction.message || entry.message;
    const delTimer = this._setTimeout(() => {
      this.pendingDeleteTimers.delete(delTimer);
      msgRef?.delete?.().catch(() => {});
    }, 5000);
    delTimer?.unref?.();
    this.pendingDeleteTimers.add(delTimer);
  }

  /**
   * voiceStateUpdate işleyicisi:
   * - Yalnızca kanal değişimlerini işler (sessize alma/yayın/kamera vb. aynı kanal olaylarını yoksayar).
   * - Botun kendi taşımasını (BOT_MOVE_IGNORE_SEC = 5 sn) yoksayar.
   * - Sesten çıkınca bekleyen geri sayımı LEFT_VOICE_DURING_COUNTDOWN ile iptal eder (hakkı tüketmez).
   * - Ses kanalına giriş veya kanal değişiminde VOICE_DEBOUNCE_SEC (3 sn) debounce ile evaluateTransfer çağırır.
   */
  handleVoiceStateUpdate(oldState, newState) {
    if (!this.isPresenceIntentAvailable()) return;
    const member = newState?.member || oldState?.member;
    const userId = newState?.id || oldState?.id || member?.id;
    if (!userId || member?.user?.bot) return;

    const uid = String(userId);
    const guild = newState?.guild || oldState?.guild || member?.guild || this.guild;
    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;

    // Aynı kanaldaki mute/deaf/stream/video değişimlerini YOK SAY
    if (oldChannelId === newChannelId) return;

    this.counters.voiceChangesReceived += 1;

    // Botun KENDİ taşımasıysa (hedef kanala giriş olayı) bu olayı yeniden tetikleme
    const ignoreEntry = this.botMoveIgnoreUntil.get(uid);
    if (ignoreEntry) {
      this.botMoveIgnoreUntil.delete(uid);
      const matchesTarget =
        !ignoreEntry.targetChannelId || String(newChannelId) === String(ignoreEntry.targetChannelId);
      if (this.now() <= ignoreEntry.until && matchesTarget) {
        return;
      }
    }

    // Varsa bekleyen ses debounce zamanlayıcısını sıfırla
    this._clearVoiceDebounce(uid);
    const session = this.sessions.get(uid);
    if (session) {
      this._clearTimer(session, 'voiceJoinTimer');
      session.sweepBlockedForMoveFail = false;
    }

    // 1. Sesten tamamen çıktıysa (newChannelId boş)
    if (!newChannelId) {
      if (this.activeCountdowns.has(uid)) {
        const cd = this.activeCountdowns.get(uid);
        // Sesten çıkınca hak TÜKETİLMEZ!
        this.cancelActiveCountdown(uid, { consumeToken: false });
        this.recordDecision(uid, {
          trigger: cd.trigger,
          result: 'skipped',
          reason: TRANSFER_REASONS.LEFT_VOICE_DURING_COUNTDOWN,
          game: cd.displayGameName,
          fromChannelId: cd.fromChannelId,
          toChannelId: cd.targetChannelId,
        });
      }
      return;
    }

    // 2. Geri sayım sürerken kanal değiştirdiyse
    if (this.activeCountdowns.has(uid)) {
      const cd = this.activeCountdowns.get(uid);
      const rawIds = this.getRawConfiguredChannelIds(cd.gameId);
      const candidateIds = rawIds.length > 0 ? rawIds : this.getCandidateChannelIds(cd.gameId);
      const newChannel = newState?.channel || guild?.channels?.cache?.get?.(newChannelId) || null;

      if (candidateIds.includes(String(newChannelId))) {
        // Kendisi hedef kanala geçti -> ALREADY_IN_TARGET (hak TÜKETİLİR!)
        this.cancelActiveCountdown(uid, { consumeToken: true });
        this.recordDecision(uid, {
          trigger: 'voice-switch',
          result: 'skipped',
          reason: TRANSFER_REASONS.ALREADY_IN_TARGET,
          game: cd.displayGameName,
          fromChannelId: newChannelId,
          toChannelId: newChannelId,
        });
        return;
      }

      if (this.isChannelBlockedForMove(guild, newChannel)) {
        // Engelli kanala (AFK/Stage/NO_MOVE) geçti -> EXCLUDED_CHANNEL (hak TÜKETİLMEZ!)
        this.cancelActiveCountdown(uid, { consumeToken: false });
        this.recordDecision(uid, {
          trigger: 'voice-switch',
          result: 'skipped',
          reason: TRANSFER_REASONS.EXCLUDED_CHANNEL,
          game: cd.displayGameName,
          fromChannelId: newChannelId,
          toChannelId: cd.targetChannelId,
        });
        return;
      }

      // Başka bir normal kanala geçtiyse mevcut geri sayım devam eder (çift geri sayım açılmaz)
      return;
    }

    // 3. VOICE_DEBOUNCE_SEC (3 sn) bekle; bu sürede yeni ses olayı gelirse sayaç sıfırlanır
    const trigger = !oldChannelId ? 'voice-join' : 'voice-switch';
    const debounceSec = Number(this.config.TIMINGS?.VOICE_DEBOUNCE_SEC ?? 3);
    const debounceMs = Math.max(0, debounceSec * 1000);

    const timer = this._setTimeout(() => {
      this.voiceDebounceTimers.delete(uid);
      const liveMember = guild?.members?.cache?.get?.(uid) || member;
      if (!liveMember) return;
      this.evaluateTransfer(liveMember, trigger).catch(() => {});
    }, debounceMs);
    timer?.unref?.();

    this.voiceDebounceTimers.set(uid, timer);
  }

  _clearVoiceDebounce(userId) {
    const uid = String(userId);
    const t = this.voiceDebounceTimers.get(uid);
    if (t) {
      this._clearTimeout(t);
      this.voiceDebounceTimers.delete(uid);
    }
  }

  /**
   * Her SWEEP_SEC (30 sn) yalnızca şu anda bir ses kanalında olan botsuz üyeler için yedek tarama yapar.
   * Tüm sunucu üyelerini dolaşmaz.
   */
  async runSweep(guild = this.guild) {
    if (!guild || !this.isPresenceIntentAvailable()) return { evaluated: 0 };

    const now = this.now();
    const candidates = new Map();

    // 1. Öncelikle guild.voiceStates.cache üzerindeki aktif ses üyelerine bak
    if (guild.voiceStates?.cache && guild.voiceStates.cache.size > 0) {
      for (const [uid, vs] of guild.voiceStates.cache) {
        if (!vs?.channelId) continue;
        const m = vs.member || guild.members?.cache?.get?.(String(uid)) || null;
        if (m && !m.user?.bot) {
          candidates.set(String(uid), m);
        }
      }
    } else {
      // Yedek (test ortamında voiceStates.cache tanımlanmadıysa): yalnızca aktif oturumu olup seste olanlara bak
      for (const [uid] of this.sessions) {
        const m = guild.members?.cache?.get?.(String(uid)) || null;
        if (m && !m.user?.bot && m.voice?.channelId) {
          candidates.set(String(uid), m);
        }
      }
    }

    let evaluated = 0;
    const tasks = [];

    for (const [uid, member] of candidates) {
      const prefs = this.getPrefs(uid);
      if (!prefs.tracking || !prefs.autoMove) continue;

      const session = this.sessions.get(uid);
      if (!session || !session.confirmed || !session.moveToken) continue;
      if (session.currentlyDetectedGameId !== session.gameId) continue;
      if (session.sweepBlockedForMoveFail) continue;
      if (this.activeCountdowns.has(uid) || this.voiceDebounceTimers.has(uid) || this.evaluatingUsers.has(uid)) {
        continue;
      }

      const lastDecision = this.getLastDecision(uid);
      if (lastDecision && now - lastDecision.at < 20000) {
        continue;
      }

      evaluated += 1;
      tasks.push(
        this.moveQueue.enqueue(() => this.evaluateTransfer(member, 'sweep'))
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
    return { evaluated };
  }

  // =========================================================================
  // 7. SÜRE SAYIMI, CHECKPOINT, AYLIK SIFIRLAMA, DUYURU VE TEMİZLİK
  // =========================================================================

  _flushSessionElapsed(session, upToMs) {
    if (!session || !session.confirmed || !session.gameId || !session.lastAccountedAt) return 0;
    const endMs = Math.max(session.lastAccountedAt, upToMs);
    const deltaSec = Math.floor((endMs - session.lastAccountedAt) / 1000);
    if (deltaSec <= 0) return 0;

    if (this.getPrefs(session.userId).tracking) {
      this.db.addActivitySeconds(session.userId, session.gameId, deltaSec, { immediate: false });
      this.counters.checkpointWritten += 1;
    }
    session.lastAccountedAt += deltaSec * 1000;
    return deltaSec;
  }

  /**
   * Her CHECKPOINT_SEC aralığında tüm aktif oturumların geçen saniyelerini toplar,
   * süresi dolan karar izlerini temizler ve veritabanı kirliyse tek seferde atomik olarak diske kaydeder.
   */
  runCheckpoint() {
    const now = this.now();
    this.pruneExpiredDecisions();

    for (const session of this.sessions.values()) {
      if (!session.confirmed || !session.gameId) continue;
      // Sadece şu an gerçekten o oyunu oynayanları (stopGrace'te olmayanları) ilerlet
      if (session.currentlyDetectedGameId === session.gameId) {
        this._flushSessionElapsed(session, now);
        session.lastSeen = now;
      }
    }
    return this.db.flushDirty();
  }

  /**
   * Kullanıcının şu an aktif (onaylı) oyun bilgisini ve kaydedilmemiş canlı saniye farkını döndürür.
   */
  getLivePlayingInfo(userId) {
    const uid = String(userId || '');
    const session = this.sessions.get(uid);
    if (!session || !session.confirmed || !session.gameId) return null;
    if (session.currentlyDetectedGameId !== session.gameId) return null;
    if (!this.getPrefs(uid).tracking) return null;

    const now = this.now();
    const sessionElapsedSec = session.since ? Math.max(0, Math.floor((now - session.since) / 1000)) : 0;
    const unsavedSec = session.lastAccountedAt
      ? Math.max(0, Math.floor((now - session.lastAccountedAt) / 1000))
      : 0;

    return {
      gameId: session.gameId,
      family: session.family,
      sessionElapsedSec,
      unsavedSec,
    };
  }

  /**
   * Europe/Istanbul saatine göre ay değiştiyse tüm aylık süreleri sıfırlar ve duyuru gönderir.
   */
  async checkMonthlyReset(guild = this.guild, nowDate = new Date(this.now())) {
    const currentMonth = this.db.getCurrentIstanbulMonth(nowDate);
    const storedMonth = this.db.data.activityStats?.month;

    if (storedMonth === currentMonth) {
      return { reset: false, month: currentMonth };
    }

    // Aktif oturumların son hesaplanma zamanını yeni ay başına çek (eski ayın süresini yeni aya taşıma)
    const resetMs = this.now();
    for (const session of this.sessions.values()) {
      if (session.confirmed) {
        session.lastAccountedAt = resetMs;
      }
    }

    this.db.resetActivityStatsForMonth(currentMonth);

    const cmdChannel = guild?.channels?.cache?.get?.(this.config.COMMAND_CHANNEL_ID) || null;
    if (cmdChannel && typeof cmdChannel.send === 'function') {
      await cmdChannel
        .send({
          content:
            '🗓️ Yeni ay, yeni rekorlar! Aylık oyun aktivite süreleri sıfırlandı. `/aktivitem` ile bu ayki sürene bakabilirsin 🎮\n' +
            'A new month begins! Monthly game activity times have been reset. Check yours with `/activity` 🎮',
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    }

    return { reset: true, month: currentMonth };
  }

  /**
   * Sistem ilk kez çalıştırıldığında (activityMeta.announcedAt boşsa) tek seferlik iki dilli duyuru gönderir.
   */
  async checkOneTimeAnnouncement(guild = this.guild) {
    const meta = this.db.getActivityMeta();
    if (meta.announcedAt) return { announced: false };

    const cmdChannel = guild?.channels?.cache?.get?.(this.config.COMMAND_CHANNEL_ID) || null;
    if (!cmdChannel || typeof cmdChannel.send !== 'function') {
      return { announced: false, reason: 'no_channel' };
    }

    const message =
      '🎮 **Yeni Özellik: Oyun Etkinliği Sistemi Aktif!**\n' +
      'Bot, Discord\'daki oyun etkinliğini okuyarak oynadığın oyuna göre **Oyun Aktiflik** rolü verir, sesteysen oyunun ses kanalına iptal edilebilir geri sayımla aktarır ve bu ayki oynama sürelerini sayar *(süreler her ay sıfırlanır)*.\n' +
      '⚙️ İstediğin zaman `/aktivitem` > **⚙️ Ayarlarım** düğmesinden kapatabilirsin. *Not: Discord Etkinlik Gizliliği kapalıysa bot oyununu göremez.*\n\n' +
      '🎮 **New Feature: Game Activity System is Live!**\n' +
      'The bot reads your Discord game activity to assign **Game Activity** roles, transfer you to the game\'s voice channel with a cancellable countdown if you\'re in voice, and count your monthly playtime *(resets every month)*.\n' +
      '⚙️ You can turn this off anytime via `/activity` > **⚙️ My Settings**. *Note: If Discord Activity Privacy is off, the bot cannot see your game.*';

    try {
      await cmdChannel.send({
        content: message,
        allowedMentions: { parse: [] },
      });
      this.db.setActivityAnnounced(this.now());
      return { announced: true };
    } catch (err) {
      return { announced: false, reason: 'send_failed' };
    }
  }

  /**
   * Kullanıcı takibi kapattığında: tüm zamanlayıcıları/geri sayımları iptal et,
   * karar izini sil, 4 aktiflik rolünü hemen al, bu ayki süreleri sil ve bellekten temizle.
   */
  async disableTrackingForUser(userId, member = null) {
    const uid = String(userId);
    this._clearVoiceDebounce(uid);
    this.cancelActiveCountdown(uid, { consumeToken: true });
    this.lastDecisions.delete(uid);
    this.botMoveIgnoreUntil.delete(uid);

    const session = this.sessions.get(uid);
    if (session) {
      this._clearSessionTimers(session);
      this.sessions.delete(uid);
    }

    this.db.clearUserActivityStats(uid, { immediate: true });

    const targetMember = member || this.guild?.members?.cache?.get?.(uid) || null;
    if (targetMember) {
      await this.removeAllActivityRoles(targetMember, 'Kullanıcı etkinlik takibini kapattı');
    }
  }

  /**
   * Kullanıcı takibi yeniden açtığında, o an zaten oyun oynuyorsa algılamayı başlatır.
   */
  enableTrackingForUser(userId, member = null) {
    if (!this.isPresenceIntentAvailable()) return;
    const uid = String(userId);
    const guild = member?.guild || this.guild;
    const liveMember = member || guild?.members?.cache?.get?.(uid) || null;
    const presence = liveMember?.presence || guild?.presences?.cache?.get?.(uid) || null;
    if (!presence) return;

    const detected = detectGame(presence, this.config, this.disabledGameIds);
    if (detected) {
      this.processDetectedGame({ userId: uid, member: liveMember, guild, detected });
    }
  }

  /**
   * Üye sunucudan ayrıldığında (guildMemberRemove): zamanlayıcıları, geri sayımı,
   * karar izini, bellek durumunu ve veritabanındaki tüm etkinlik verilerini siler.
   */
  handleMemberRemove(member) {
    const userId = member?.id || member?.user?.id;
    if (!userId) return;
    const uid = String(userId);

    this._clearVoiceDebounce(uid);
    this.cancelActiveCountdown(uid, { consumeToken: true });
    this.lastDecisions.delete(uid);
    this.botMoveIgnoreUntil.delete(uid);

    const session = this.sessions.get(uid);
    if (session) {
      this._clearSessionTimers(session);
      this.sessions.delete(uid);
    }

    this.db.removeUserActivityData(uid);
  }

  /**
   * Bot kapanırken (SIGTERM / SIGINT) çağrılır:
   * bekleyen geri sayım mesajlarını silmeye çalışır, aktif süreleri son kez kaydeder,
   * karar izlerini ve tüm zamanlayıcıları temizler.
   */
  async shutdown() {
    this._clearBackgroundTimers();

    for (const timer of this.voiceDebounceTimers.values()) {
      this._clearTimeout(timer);
    }
    this.voiceDebounceTimers.clear();
    this.botMoveIgnoreUntil.clear();
    this.lastDecisions.clear();
    this.evaluatingUsers.clear();

    if (this._unsubscribeDbSave) {
      this._unsubscribeDbSave();
      this._unsubscribeDbSave = null;
    }

    // Aktif oturumların son sürelerini işle ve zamanlayıcıları kapat
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.confirmed && session.gameId) {
        const endAt = session.currentlyDetectedGameId === session.gameId ? now : session.lastSeen || now;
        this._flushSessionElapsed(session, endAt);
      }
      this._clearSessionTimers(session);
    }
    this.sessions.clear();

    // Bekleyen geri sayım mesajlarını silmeye çalış
    const deletePromises = [];
    for (const entry of this.activeCountdowns.values()) {
      if (entry.timer) {
        this._clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (entry.message && typeof entry.message.delete === 'function') {
        deletePromises.push(entry.message.delete().catch(() => {}));
      }
    }
    this.activeCountdowns.clear();

    for (const t of this.pendingDeleteTimers) {
      this._clearTimeout(t);
    }
    this.pendingDeleteTimers.clear();

    this.roleQueue.clear();
    this.moveQueue.clear();

    // Son kirli verileri atomik olarak diske yaz
    this.db.flushDirty();

    if (deletePromises.length > 0) {
      await Promise.race([
        Promise.allSettled(deletePromises),
        new Promise((resolve) => {
          const t = this._setTimeout(resolve, 2500);
          t?.unref?.();
        }),
      ]);
    }
  }

  _clearTimer(session, key) {
    if (session && session[key]) {
      this._clearTimeout(session[key]);
      session[key] = null;
    }
  }

  _clearSessionTimers(session) {
    this._clearTimer(session, 'confirmTimer');
    this._clearTimer(session, 'stopGraceTimer');
    this._clearTimer(session, 'voiceJoinTimer');
  }
}

const defaultTracker = new ActivityTracker();

defaultTracker.ActivityTracker = ActivityTracker;
defaultTracker.RateLimitedQueue = RateLimitedQueue;
defaultTracker.TRANSFER_REASONS = TRANSFER_REASONS;
defaultTracker.createEmptyCounters = createEmptyCounters;
defaultTracker.normalizeActivityText = normalizeActivityText;
defaultTracker.extractActivityFields = extractActivityFields;
defaultTracker.isIgnoredActivity = isIgnoredActivity;
defaultTracker.isGeneralRobloxActivityName = isGeneralRobloxActivityName;
defaultTracker.matchSingleActivity = matchSingleActivity;
defaultTracker.detectGame = detectGame;
defaultTracker.classifyPresence = classifyPresence;
defaultTracker.getPlayingActivitiesSignature = getPlayingActivitiesSignature;
defaultTracker.diagnosePresence = diagnosePresence;
defaultTracker.selectTargetVoiceChannel = selectTargetVoiceChannel;

module.exports = defaultTracker;
