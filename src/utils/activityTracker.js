/**
 * Oyun Etkinliği Algılama, Durum Makinesi, Aktiflik Rolleri,
 * Otomatik Ses Aktarımı ve Aylık Süre Takibi Yöneticisi.
 *
 * Kesin kurallar:
 * - Yalnızca Discord presence/activity verisi kullanılır (Roblox API/çerez YOK).
 * - Hiçbir oyun geçmişi veya zaman çizelgesi saklanmaz; kalıcı olarak yalnızca
 *   aylık toplam saniye (activityStats) ve kullanıcı tercihleri (activityPrefs) tutulur.
 * - Konsola kullanıcıya özel oyun bilgisi yazılmaz (en fazla genel sayaçlar ve saatlik hata özetleri).
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
  const list = Array.isArray(cfg.IGNORED_ACTIVITIES) ? cfg.IGNORED_ACTIVITIES : [];
  return list.some((entry) => normalizeActivityText(entry) === normName);
}

/**
 * Tek bir Discord etkinliğini activity.config.js kurallarına göre değerlendirir.
 */
function matchSingleActivity(activity, cfg = activityConfig, disabledGameIds = new Set()) {
  if (!activity || activity.type !== ActivityType.Playing) {
    return { status: 'non_playing', game: null };
  }

  if (isIgnoredActivity(activity, cfg)) {
    return { status: 'ignored', game: null };
  }

  const fields = extractActivityFields(activity);
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
      };
    }
  }

  // 2. Hiçbiri eşleşmediyse ve etkinlik adı tam olarak 'roblox' ise ROBLOX_UNKNOWN
  if (
    fields.normalized.name === 'roblox' &&
    cfg.ROBLOX_UNKNOWN &&
    !disabledGameIds.has('roblox_unknown')
  ) {
    return {
      status: 'roblox_unknown',
      game: cfg.ROBLOX_UNKNOWN,
      priority: 1,
      startedAt,
    };
  }

  return { status: 'unmatched', game: null };
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
    return { channel: null, allFull: false };
  }

  const botMember = guild.members?.me || null;
  const existingVoiceChannels = [];

  for (const chId of candidateChannelIds) {
    const ch = guild.channels?.cache?.get?.(chId) || null;
    if (!ch || !activityConfig.isRegularVoiceChannel(ch)) continue;

    if (botMember && typeof ch.permissionsFor === 'function') {
      const perms = ch.permissionsFor(botMember);
      if (perms && typeof perms.has === 'function') {
        if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
          continue;
        }
      }
    }
    existingVoiceChannels.push(ch);
  }

  if (existingVoiceChannels.length === 0) {
    return { channel: null, allFull: false };
  }

  const openChannels = existingVoiceChannels.filter((ch) => {
    const limit = Number(ch.userLimit) || 0;
    const count = ch.members?.size ?? 0;
    return limit === 0 || count < limit;
  });

  if (openChannels.length === 0) {
    return { channel: null, allFull: true };
  }

  if (openChannels.length === 1) {
    return { channel: openChannels[0], allFull: false };
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
    return { channel: withSameGame[0].ch, allFull: false };
  }

  // 2. Yoksa dolu olmayan ve en çok üyesi olan kanal
  const withMembers = scored.filter((item) => item.totalMembers > 0);
  if (withMembers.length > 0) {
    withMembers.sort((a, b) => b.totalMembers - a.totalMembers || a.idx - b.idx);
    return { channel: withMembers[0].ch, allFull: false };
  }

  // 3. Yoksa listedeki ilk kanal
  return { channel: openChannels[0], allFull: false };
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

    // Üye başına en fazla 1 aktif geri sayım: Map<userId, { token, gameId, targetChannelId, message, timer }>
    this.activeCountdowns = new Map();

    // İptal sonrası 5 sn silme zamanlayıcıları (kapanışta temizlenir)
    this.pendingDeleteTimers = new Set();

    // Aynı hata sebebini saatte en fazla 1 kez konsola yazmak için harita
    this.errorLogTimestamps = new Map();

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

  setPresenceEnabled(enabled) {
    this.presenceEnabled = Boolean(enabled);
  }

  isPresenceIntentAvailable() {
    return this.presenceEnabled;
  }

  /**
   * Açılışta (ready) sunucu için sistemi başlatır:
   * - activity.config.js doğrulaması + izin/hiyerarşi kontrolü
   * - Ay dönümü kontrolü ve tek seferlik ilk duyuru
   * - Önbellekteki presence'lerden (fetch etmeden) başlangıç oturumları (moveToken = false)
   * - 2 dk sonra tek seferlik aktiflik rolü temizliği, 60 sn checkpoint ve 10 dk aylık kontrol
   */
  async initForGuild(guild, client = null) {
    this.guild = guild;
    this.client = client || guild?.client || null;
    this.roleQueue.reopen();
    this.moveQueue.reopen();

    if (!this.presenceEnabled) {
      this.logger.warn(
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

    // 4. Önbellekteki mevcut presence'lerden oturumları kur (üyeleri fetch ETME, moveToken = false!)
    let seededCount = 0;
    const now = this.now();
    const presences = guild?.presences?.cache;
    if (presences) {
      for (const [userId, presence] of presences) {
        const member = guild.members?.cache?.get?.(userId) || presence?.member || null;
        const user = member?.user || presence?.user || null;
        if (user?.bot) continue;
        if (!this.db.isActivityTrackingEnabled(userId)) continue;
        if (this.sessions.has(String(userId))) continue;

        const detected = detectGame(presence, this.config, this.disabledGameIds);
        if (!detected) continue;

        const session = {
          userId: String(userId),
          confirmed: true,
          gameId: detected.gameId,
          family: detected.family,
          currentlyDetectedGameId: detected.gameId,
          since: now,
          lastAccountedAt: now,
          lastSeen: now,
          moveToken: false, // Bot yeniden başladığı için sürpriz taşıma YAPILMAZ
          pendingGameId: null,
          pendingFamily: null,
          pendingSince: null,
          confirmTimer: null,
          stopGraceTimer: null,
          voiceJoinTimer: null,
        };
        this.sessions.set(String(userId), session);
        seededCount += 1;

        if (member) {
          this.syncMemberFamilyRoles(member, detected.family);
        }
      }
    }

    this.logger.log(
      `[OYUN ETKİNLİĞİ] Sistem başlatıldı: ${seededCount} aktif oturum önbellekten yüklendi.`
    );

    // 5. Arka plan zamanlayıcılarını kur
    this.startBackgroundTimers(guild);

    return { enabled: true, seededCount, validation };
  }

  startBackgroundTimers(guild) {
    if (this.checkpointInterval) {
      this._clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
    if (this.monthlyCheckInterval) {
      this._clearInterval(this.monthlyCheckInterval);
      this.monthlyCheckInterval = null;
    }
    if (this.startupCleanupTimer) {
      this._clearTimeout(this.startupCleanupTimer);
      this.startupCleanupTimer = null;
    }

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

    const cleanupDelayMs = Math.max(0, Number(this.config.TIMINGS.STARTUP_CLEANUP_DELAY_MS ?? 120000));
    this.startupCleanupTimer = this._setTimeout(() => {
      this.startupCleanupTimer = null;
      this.runStartupRoleCleanup(guild).catch(() => {});
    }, cleanupDelayMs);
    this.startupCleanupTimer?.unref?.();
  }

  /**
   * Açılıştan 2 dakika sonra tek seferlik aktiflik rolü temizliği yapar:
   * 4 aktiflik rolünden birine sahip olup o oyunu şu an oynamayan üyelerden rolü kuyrukla alır.
   */
  async runStartupRoleCleanup(guild) {
    if (!guild || !this.presenceEnabled) return { removedCount: 0 };

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
        const trackingOn = this.db.isActivityTrackingEnabled(userId);
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
    if (!this.presenceEnabled) return;
    if (!newPresence) return;

    const user = newPresence.user || newPresence.member?.user || oldPresence?.user;
    const userId = newPresence.userId || user?.id;
    if (!userId || user?.bot) return;

    const uid = String(userId);
    if (!this.db.isActivityTrackingEnabled(uid)) return;

    // Hızlı eleme: Playing etkinlikleri birebir aynıysa ağır iş yapma
    if (oldPresence && getPlayingActivitiesSignature(oldPresence) === getPlayingActivitiesSignature(newPresence)) {
      return;
    }

    const guild = newPresence.guild || this.guild;
    const member = newPresence.member || guild?.members?.cache?.get?.(uid) || null;
    const detected = detectGame(newPresence, this.config, this.disabledGameIds);

    this.processDetectedGame({ userId: uid, member, guild, detected });
  }

  /**
   * Tespit edilen oyunu (veya null) kullanıcı durum makinesine uygular.
   */
  processDetectedGame({ userId, member, guild, detected }) {
    const uid = String(userId);
    const now = this.now();
    let session = this.sessions.get(uid);

    // 1. Hiç oturum yokken
    if (!session) {
      if (!detected) return;

      session = {
        userId: uid,
        confirmed: false,
        gameId: null,
        family: null,
        currentlyDetectedGameId: detected.gameId,
        since: null,
        lastAccountedAt: null,
        lastSeen: null,
        moveToken: false,
        pendingGameId: detected.gameId,
        pendingFamily: detected.family,
        pendingSince: now,
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
        this._scheduleConfirm(session, member, guild);
      }
      return;
    }

    // 3. Onaylı oturum sürüyor
    // 3a. Aynı oyun hâlâ aktif (veya STOP_GRACE içinde aynı oyun geri döndü)
    if (detected && detected.gameId === session.gameId) {
      session.currentlyDetectedGameId = detected.gameId;
      session.lastSeen = now;
      this._clearTimer(session, 'stopGraceTimer');
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = null;
      session.pendingFamily = null;
      session.pendingSince = null;
      return;
    }

    // 3b. Etkinlik bitti (oyun yok)
    if (!detected) {
      // İlk kez duruyorsa son görülme zamanını dondur (bekleme süresi sayılmaz)
      if (session.currentlyDetectedGameId === session.gameId) {
        session.lastSeen = now;
      }
      session.currentlyDetectedGameId = null;

      // Varsa bekleyen başka oyun onayını iptal et
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = null;
      session.pendingFamily = null;
      session.pendingSince = null;

      // Aktif geri sayım varsa iptal edip sil
      this.cancelActiveCountdown(uid, { consumeToken: true });

      if (!session.stopGraceTimer) {
        this._scheduleStopGrace(session, member, guild);
      }
      return;
    }

    // 3c. Farklı bir oyuna geçildi (detected.gameId !== session.gameId)
    if (session.currentlyDetectedGameId === session.gameId) {
      session.lastSeen = now;
    }
    session.currentlyDetectedGameId = detected.gameId;

    // Eski oyun için geri sayım sürüyorsa iptal edip sil
    this.cancelActiveCountdown(uid, { consumeToken: false });

    // Yeni oyun henüz beklemede değilse veya başka bir yeni oyuna değiştiyse CONFIRM_SEC başlat
    if (session.pendingGameId !== detected.gameId) {
      this._clearTimer(session, 'confirmTimer');
      session.pendingGameId = detected.gameId;
      session.pendingFamily = detected.family;
      session.pendingSince = now;
      this._scheduleConfirm(session, member, guild);
    }

    // Yeni oyun CONFIRM_SEC'ten önce kapanırsa eski oturumun sonsuza dek asılı kalmaması için stopGrace garanti et
    if (!session.stopGraceTimer) {
      this._scheduleStopGrace(session, member, guild);
    }
  }

  _scheduleConfirm(session, member, guild) {
    this._clearTimer(session, 'confirmTimer');
    const confirmMs = Math.max(0, Number(this.config.TIMINGS.CONFIRM_SEC ?? 15) * 1000);
    const targetGameId = session.pendingGameId;
    const targetFamily = session.pendingFamily;
    const targetSince = session.pendingSince || this.now();

    session.confirmTimer = this._setTimeout(() => {
      session.confirmTimer = null;
      this._onConfirmElapsed(session.userId, targetGameId, targetFamily, targetSince, member, guild);
    }, confirmMs);
    session.confirmTimer?.unref?.();
  }

  _onConfirmElapsed(userId, newGameId, newFamily, startedSince, memberHint, guildHint) {
    const uid = String(userId);
    const session = this.sessions.get(uid);
    if (!session || session.pendingGameId !== newGameId) return;

    if (!this.db.isActivityTrackingEnabled(uid)) {
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
    session.lastAccountedAt = startedSince;
    session.lastSeen = now;
    session.moveToken = true;
    session.pendingGameId = null;
    session.pendingFamily = null;
    session.pendingSince = null;

    // Rol senkronizasyonu: aynı aile içinde (örn: Roblox -> Roblox) rol DEĞİŞTİRME
    if (member && prevFamily !== newFamily) {
      this.syncMemberFamilyRoles(member, newFamily);
    } else if (member && !prevFamily) {
      this.syncMemberFamilyRoles(member, newFamily);
    }

    // Ses kanalı aktarımını değerlendir
    if (member && guild) {
      this.tryStartVoiceTransfer(guild, member, session).catch(() => {});
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
    }

    const oldFamily = session.family;
    const guild = guildHint || this.guild;
    const member = guild?.members?.cache?.get?.(uid) || memberHint || null;

    this.cancelActiveCountdown(uid, { consumeToken: true });
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
    if (!this.db.isActivityTrackingEnabled(member.id)) return;

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
        return true;
      } catch (err) {
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
  // 6. OTOMATİK SES KANALI AKTARIMI (Geri Sayım + İptal Butonu + Kuyruk)
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

  async tryStartVoiceTransfer(guild, member, session) {
    if (!guild || !member || !session || member.user?.bot) return { started: false, reason: 'invalid' };
    if (!session.confirmed || !session.moveToken) return { started: false, reason: 'no_token' };

    const uid = String(member.id);
    if (!this.db.isActivityAutoMoveEnabled(uid)) return { started: false, reason: 'disabled' };

    const currentChannelId = member.voice?.channelId || null;
    if (!currentChannelId) {
      // Üye seste değil: hak KORUNUR (sonradan sese girince 5 sn sonra başlatılır)
      return { started: false, reason: 'not_in_voice' };
    }

    const currentChannel =
      member.voice?.channel || guild.channels?.cache?.get?.(currentChannelId) || null;
    if (this.isChannelBlockedForMove(guild, currentChannel)) {
      return { started: false, reason: 'blocked_channel' };
    }

    const candidateIds = this.getCandidateChannelIds(session.gameId);
    if (candidateIds.length === 0) return { started: false, reason: 'no_target' };

    // Üye zaten hedef kanallardan birindeyse hiçbir şey yapma ve hakkı tüket
    if (candidateIds.includes(String(currentChannelId))) {
      session.moveToken = false;
      return { started: false, reason: 'already_in_target' };
    }

    const selection = selectTargetVoiceChannel({
      guild,
      gameId: session.gameId,
      candidateChannelIds: candidateIds,
      sessionsMap: this.sessions,
      excludeUserId: uid,
    });

    if (selection.allFull) {
      // Tüm hedef kanallar doluysa aktarma ve hakkı TÜKETME
      return { started: false, reason: 'all_full' };
    }
    if (!selection.channel) {
      return { started: false, reason: 'no_valid_channel' };
    }

    const targetChannel = selection.channel;
    const cmdChannel = guild.channels?.cache?.get?.(this.config.COMMAND_CHANNEL_ID) || null;
    if (!cmdChannel || typeof cmdChannel.send !== 'function') {
      // Komut kanalı yoksa kullanıcıya iptal şansı verilemediği için aktarma YAPMA
      this.logErrorThrottled(
        'cmd_channel_missing',
        `[OYUN ETKİNLİĞİ AKTARMA UYARISI] Komut kanalı (${this.config.COMMAND_CHANNEL_ID}) bulunamadığından ses aktarımı yapılmadı.`
      );
      return { started: false, reason: 'no_command_channel' };
    }

    // Üye başına tek aktif geri sayım: eskisi varsa iptal et ve sil
    if (this.activeCountdowns.has(uid)) {
      this.cancelActiveCountdown(uid, { consumeToken: false });
    }

    const countdownSec = Math.max(1, Number(this.config.TIMINGS.COUNTDOWN_SEC ?? 10));
    const targetUnix = Math.floor((this.now() + countdownSec * 1000) / 1000);
    const token = Math.random().toString(36).slice(2, 8);
    const lang = resolveLang(uid);
    const isEn = lang === 'en';
    const gameInfo = this.config.getGameDisplayInfo(session.gameId, lang, this.config);
    const displayGameName = gameInfo.shortName || gameInfo.name;

    const content = isEn
      ? `🎮 <@${uid}> you've switched to **${displayGameName}**!\n🔊 Moving you to the game's voice channel: <#${targetChannel.id}>\n⏳ Transfer: <t:${targetUnix}:R>\nPress the button below if you don't want this.`
      : `🎮 <@${uid}> **${displayGameName}** oyununa geçiş sağladınız!\n🔊 Sizi oyunun ses kanalına aktarıyorum: <#${targetChannel.id}>\n⏳ Aktarma: <t:${targetUnix}:R>\nİstemiyorsanız aşağıdaki butona basın.`;

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
        `[OYUN ETKİNLİĞİ AKTARMA UYARISI] Komut kanalına geri sayım mesajı gönderilemedi (${err?.code || err?.message}); aktarma iptal edildi.`
      );
      return { started: false, reason: 'send_failed' };
    }

    const countdownEntry = {
      userId: uid,
      token,
      gameId: session.gameId,
      targetChannelId: targetChannel.id,
      displayGameName,
      message: sentMsg,
      timer: null,
    };

    countdownEntry.timer = this._setTimeout(() => {
      this._executeCountdownCompletion(guild, uid, token).catch(() => {});
    }, countdownSec * 1000);
    countdownEntry.timer?.unref?.();

    this.activeCountdowns.set(uid, countdownEntry);
    return { started: true, token, targetChannelId: targetChannel.id, message: sentMsg };
  }

  async _executeCountdownCompletion(guild, userId, token) {
    const uid = String(userId);
    const entry = this.activeCountdowns.get(uid);
    if (!entry || entry.token !== token) return;

    this.activeCountdowns.delete(uid);

    const session = this.sessions.get(uid);
    const member = guild?.members?.cache?.get?.(uid) || null;
    const deleteMsg = () => entry.message?.delete?.().catch(() => {});

    // Oturum bitti veya başka oyuna geçtiyse
    if (!session || !session.confirmed || session.gameId !== entry.gameId) {
      await deleteMsg();
      return;
    }

    // Oyun bırakıldıysa / takip veya aktarma kapandıysa / sesten çıktıysa
    const currentChannelId = member?.voice?.channelId || null;
    const currentChannel =
      member?.voice?.channel || (currentChannelId ? guild?.channels?.cache?.get?.(currentChannelId) : null);

    const candidateIds = this.getCandidateChannelIds(session.gameId);

    if (
      session.currentlyDetectedGameId !== entry.gameId ||
      !this.db.isActivityAutoMoveEnabled(uid) ||
      !member ||
      !currentChannelId ||
      this.isChannelBlockedForMove(guild, currentChannel) ||
      candidateIds.includes(String(currentChannelId))
    ) {
      session.moveToken = false;
      await deleteMsg();
      return;
    }

    // Hedef kanal hâlâ müsait mi kontrol et (doluysa başka boş kanal seç, hepsi doluysa hakkı tüketme)
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
        return;
      }
      targetChannelId = reselected.channel.id;
    }

    // Hakkı tüket ve taşıma kuyruğuna ekle
    session.moveToken = false;
    await this.moveQueue.enqueue(async () => {
      try {
        await member.voice.setChannel(targetChannelId, `Oyun aktarımı: ${entry.displayGameName}`);
      } catch (err) {
        this._handleMoveApiError(err);
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
        `[OYUN ETKİNLİĞİ AKTARMA HATASI] Ses kanalı taşıma izni yetersiz (${code}: Üyeleri Taşı veya kanal erişimi eksik).`
      );
      return;
    }

    this.logErrorThrottled(
      `move:other:${code || 'err'}`,
      `[OYUN ETKİNLİĞİ AKTARMA HATASI] Ses kanalı taşıma başarısız (${code || err?.message || 'bilinmeyen hata'}).`
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

    // Sahibi iptal etti: zamanlayıcıyı durdur, hakkı tüket, mesajı güncelle ve 5 sn sonra sil
    if (entry.timer) {
      this._clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.activeCountdowns.delete(targetUserId);

    const session = this.sessions.get(targetUserId);
    if (session && session.gameId === entry.gameId) {
      session.moveToken = false;
    }

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
   * - Oyun ses dışındayken başladıysa, üye sonradan ses kanalına girince 5 sn sonra aktarma başlatır.
   * - Geri sayım sürerken sesten çıkarsa veya hedef kanala geçerse geri sayımı iptal edip siler.
   */
  handleVoiceStateUpdate(oldState, newState) {
    if (!this.presenceEnabled) return;
    const member = newState?.member || oldState?.member;
    const userId = newState?.id || oldState?.id || member?.id;
    if (!userId || member?.user?.bot) return;

    const uid = String(userId);
    const session = this.sessions.get(uid);
    if (!session || !session.confirmed) return;

    const guild = newState?.guild || oldState?.guild || this.guild;
    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;

    if (oldChannelId === newChannelId) return;

    // 1. Sesten çıktıysa
    if (!newChannelId) {
      this._clearTimer(session, 'voiceJoinTimer');
      if (this.activeCountdowns.has(uid)) {
        this.cancelActiveCountdown(uid, { consumeToken: true });
      }
      return;
    }

    // 2. Geri sayım sürerken kendisi hedef kanala veya engelli kanala geçtiyse
    const newChannel = newState?.channel || guild?.channels?.cache?.get?.(newChannelId) || null;
    const candidateIds = this.getCandidateChannelIds(session.gameId);

    if (this.activeCountdowns.has(uid)) {
      if (candidateIds.includes(String(newChannelId)) || this.isChannelBlockedForMove(guild, newChannel)) {
        this.cancelActiveCountdown(uid, { consumeToken: true });
      }
      return;
    }

    // 3. Üye zaten hedef kanala kendisi girdiyse hakkı tüket
    if (candidateIds.includes(String(newChannelId))) {
      this._clearTimer(session, 'voiceJoinTimer');
      session.moveToken = false;
      return;
    }

    // 4. Engelli kanala (AFK/Stage/NO_MOVE) girdiyse beklemeyi iptal et
    if (this.isChannelBlockedForMove(guild, newChannel)) {
      this._clearTimer(session, 'voiceJoinTimer');
      return;
    }

    // 5. Ses dışından veya engelli kanaldan geçerli bir ses kanalına girdiyse ve hakkı duruyorsa 5 sn sonra başlat
    const oldChannel = oldState?.channel || (oldChannelId ? guild?.channels?.cache?.get?.(oldChannelId) : null);
    const cameFromNonEligible = !oldChannelId || this.isChannelBlockedForMove(guild, oldChannel);

    if (cameFromNonEligible && session.moveToken && this.db.isActivityAutoMoveEnabled(uid)) {
      this._clearTimer(session, 'voiceJoinTimer');
      const delayMs = Math.max(0, Number(this.config.TIMINGS.VOICE_JOIN_DELAY_MS ?? 5000));
      session.voiceJoinTimer = this._setTimeout(() => {
        session.voiceJoinTimer = null;
        const liveSession = this.sessions.get(uid);
        const liveMember = guild?.members?.cache?.get?.(uid) || member;
        if (!liveSession || !liveSession.confirmed || !liveSession.moveToken) return;
        if (liveSession.currentlyDetectedGameId !== liveSession.gameId) return;
        if (!liveMember?.voice?.channelId) return;
        this.tryStartVoiceTransfer(guild, liveMember, liveSession).catch(() => {});
      }, delayMs);
      session.voiceJoinTimer?.unref?.();
    }
  }

  // =========================================================================
  // 7. SÜRE SAYIMI, CHECKPOINT, AYLIK SIFIRLAMA, DUYURU VE TEMİZLİK
  // =========================================================================

  _flushSessionElapsed(session, upToMs) {
    if (!session || !session.confirmed || !session.gameId || !session.lastAccountedAt) return 0;
    const endMs = Math.max(session.lastAccountedAt, upToMs);
    const deltaSec = Math.floor((endMs - session.lastAccountedAt) / 1000);
    if (deltaSec <= 0) return 0;

    if (this.db.isActivityTrackingEnabled(session.userId)) {
      this.db.addActivitySeconds(session.userId, session.gameId, deltaSec, { immediate: false });
    }
    session.lastAccountedAt += deltaSec * 1000;
    return deltaSec;
  }

  /**
   * Her CHECKPOINT_SEC aralığında tüm aktif oturumların geçen saniyelerini toplar
   * ve veritabanı kirliyse tek seferde atomik olarak diske kaydeder.
   */
  runCheckpoint() {
    const now = this.now();
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
    if (!this.db.isActivityTrackingEnabled(uid)) return null;

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
   * 4 aktiflik rolünü hemen al, bu ayki süreleri sil ve bellekten temizle.
   */
  async disableTrackingForUser(userId, member = null) {
    const uid = String(userId);
    this.cancelActiveCountdown(uid, { consumeToken: true });

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
    if (!this.presenceEnabled) return;
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
   * bellek durumunu ve veritabanındaki tüm etkinlik verilerini siler.
   */
  handleMemberRemove(member) {
    const userId = member?.id || member?.user?.id;
    if (!userId) return;
    const uid = String(userId);

    this.cancelActiveCountdown(uid, { consumeToken: true });

    const session = this.sessions.get(uid);
    if (session) {
      this._clearSessionTimers(session);
      this.sessions.delete(uid);
    }

    this.db.removeUserActivityData(uid);
  }

  /**
   * Bot kapanırken (SIGTERM / SIGINT) çağrılır:
   * bekleyen geri sayım mesajlarını silmeye çalışır, aktif süreleri son kez kaydeder ve tüm zamanlayıcıları temizler.
   */
  async shutdown() {
    if (this.checkpointInterval) {
      this._clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
    if (this.monthlyCheckInterval) {
      this._clearInterval(this.monthlyCheckInterval);
      this.monthlyCheckInterval = null;
    }
    if (this.startupCleanupTimer) {
      this._clearTimeout(this.startupCleanupTimer);
      this.startupCleanupTimer = null;
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
defaultTracker.normalizeActivityText = normalizeActivityText;
defaultTracker.extractActivityFields = extractActivityFields;
defaultTracker.isIgnoredActivity = isIgnoredActivity;
defaultTracker.matchSingleActivity = matchSingleActivity;
defaultTracker.detectGame = detectGame;
defaultTracker.getPlayingActivitiesSignature = getPlayingActivitiesSignature;
defaultTracker.diagnosePresence = diagnosePresence;
defaultTracker.selectTargetVoiceChannel = selectTargetVoiceChannel;

module.exports = defaultTracker;
