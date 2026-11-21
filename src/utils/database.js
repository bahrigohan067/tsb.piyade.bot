const fs = require('fs');
const path = require('path');

// Railway Kalıcı Disk (Volume) veya Yerel data klasörü desteği
const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '..', '..', 'data'));
const DB_PATH = path.join(DATA_DIR, 'database.json');

/**
 * Europe/Istanbul saat dilimine göre geçerli yılı ve ayı 'YYYY-MM' biçiminde döndürür.
 */
function getCurrentIstanbulMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value || String(d.getUTCFullYear());
  const month = parts.find((p) => p.type === 'month')?.value || String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

class DatabaseManager {
  constructor() {
    const initialMonth = getCurrentIstanbulMonth();
    this._dirty = false;
    this.data = {
      registrations: [],
      activeApplications: {},
      rejectedApplications: {},
      helpPanelMessageId: null,       // Acil yardım paneli mesaj ID'si
      tryoutStats: {},                // { [userId]: { userId, roleId, level, formCount, lastUpdated } }
      tryoutForms: {},                // { [formCode]: { formCode, userId, staffId, previousRoleId, previousLevel, newRoleId, newLevel, description, improvements, resultMessageId, resultChannelId, createdAt, cancelled } }
      tryoutLeaderboardMessageId: null, // Tryout sıralama tablosu mesaj ID'si
      profanityStats: {},             // { [userId]: { userId, count, lastAt } }
      warningRoles: {},               // Otomatik oluşturulan Uyarı / Yetkili Uyarı rol ID'leri
      warningStats: {},               // { [userId]: { userId, points, tier, staffWarnings, totalWarnings, lastWarnedAt, suspendedUntil } }
      warnings: {},                   // { [warnId]: { id, type, userId, staffId, ruleCode, reason, ... } }
      languagePrefs: {},              // { [userId]: { lang: 'tr'|'en', source: 'manual'|'legacy', updatedAt } }
      localeHints: {},                // { [userId]: 'tr' | 'en' } (Discord istemci dilinden türetilen son ipucu)
      englishRoleId: null,            // Otomatik veya tanımlı 🇬🇧 English rolü ID'si
      lockedChannels: {},             // { [channelId]: { channelId, lockedBy, lockedAt, overwrites: [...] } }
      feedback: [],                   // [{ id, userId, usernameSnapshot, message, page, lang, createdAt, status, channelId, messageId }]
      clanRoles: [],                  // [{ id, roleId, name, normalized, compact, aliases: [], source: 'bot'|'adopted'|'manual', createdBy, createdAt }]
      knownClans: [],                 // [{ id, name, normalized, compact, type: 'ally'|'enemy', createdBy, createdAt, updatedAt }]
      clanPanelMessageId: null,       // Dost/Düşman klan paneli mesaj ID'si
      clanPanelChannelId: null,       // Dost/Düşman klan paneli kanal ID'si
      activityPrefs: {},              // { [userId]: { tracking: boolean, autoMove: boolean } } (yalnızca varsayılandan farklı olanlar)
      activityStats: {                // Yalnızca bu ayın oyun başına toplam saniyesi (geçmiş/zaman çizelgesi YOK)
        month: initialMonth,
        users: {},
      },
      activityMeta: {                 // İlk duyuru ve son sıfırlanan ay bilgisi
        announcedAt: null,
        lastResetMonth: initialMonth,
      },
    };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_PATH)) {
        const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(fileContent);

        // Eski klan ve tryout verileri için ilk seferlik legacy yedekleme
        const legacyKeys = [
          'tryoutStats',
          'tryoutForms',
          'tryoutLeaderboardMessageId',
          'helpPanelMessageId',
          'clanRoles',
          'knownClans',
          'clanPanelMessageId',
          'clanPanelChannelId',
        ];
        const hasLegacyData = legacyKeys.some((k) => {
          const val = parsed[k];
          if (!val) return false;
          if (Array.isArray(val)) return val.length > 0;
          if (typeof val === 'object') return Object.keys(val).length > 0;
          return true;
        });

        if (hasLegacyData) {
          try {
            const files = fs.readdirSync(DATA_DIR);
            const hasLegacyBackup = files.some((f) => f.startsWith('database.legacy-') && f.endsWith('.json'));
            if (!hasLegacyBackup) {
              const nowStr = new Date().toISOString().replace(/[:.]/g, '-');
              const legacyPath = path.join(DATA_DIR, `database.legacy-${nowStr}.json`);
              fs.copyFileSync(DB_PATH, legacyPath);
              console.log(`[DATABASE] Eski klan/tryout verilerinin ilk seferlik yedeği alındı: ${legacyPath}`);
            }
          } catch (legacyErr) {
            console.warn('[DATABASE] Legacy yedeği oluşturulurken hata:', legacyErr.message);
          }
        }

        // Eski dil verilerini (languagePrefs ve varsa userLang) veri kaybı olmadan normalize ederek yükle
        const mergedRawLangs = {
          ...(parsed.userLang && typeof parsed.userLang === 'object' ? parsed.userLang : {}),
          ...(parsed.languagePrefs && typeof parsed.languagePrefs === 'object' ? parsed.languagePrefs : {}),
        };
        const normalizedLanguagePrefs = {};
        for (const [uid, rawVal] of Object.entries(mergedRawLangs)) {
          const norm = this.normalizeUserLangEntry(rawVal);
          if (norm) normalizedLanguagePrefs[String(uid)] = norm;
        }

        const normalizedLocaleHints = {};
        if (parsed.localeHints && typeof parsed.localeHints === 'object') {
          for (const [uid, hint] of Object.entries(parsed.localeHints)) {
            if (hint === 'tr' || hint === 'en') {
              normalizedLocaleHints[String(uid)] = hint;
            }
          }
        }

        // Oyun etkinliği tercihlerini normalize et (yalnızca varsayılandan farklı olanlar saklanır)
        const normalizedActivityPrefs = {};
        if (parsed.activityPrefs && typeof parsed.activityPrefs === 'object') {
          for (const [uid, pref] of Object.entries(parsed.activityPrefs)) {
            if (!pref || typeof pref !== 'object') continue;
            const tracking = pref.tracking !== false;
            const autoMove = pref.autoMove !== false;
            if (!tracking || !autoMove) {
              normalizedActivityPrefs[String(uid)] = { tracking, autoMove };
            }
          }
        }

        // Oyun etkinliği aylık toplam saniye istatistiklerini yükle (geçmiş/oturum kaydı olmadan)
        const fallbackMonth = getCurrentIstanbulMonth();
        const rawStats =
          parsed.activityStats && typeof parsed.activityStats === 'object'
            ? parsed.activityStats
            : {};
        const statsMonth =
          typeof rawStats.month === 'string' && /^\d{4}-\d{2}$/.test(rawStats.month)
            ? rawStats.month
            : fallbackMonth;
        const normalizedActivityUsers = {};
        if (rawStats.users && typeof rawStats.users === 'object') {
          for (const [uid, userObj] of Object.entries(rawStats.users)) {
            if (!userObj || typeof userObj !== 'object' || !userObj.games || typeof userObj.games !== 'object') {
              continue;
            }
            const cleanGames = {};
            for (const [gid, rawSec] of Object.entries(userObj.games)) {
              const sec = Math.floor(Number(rawSec));
              if (gid && Number.isFinite(sec) && sec > 0) {
                cleanGames[String(gid)] = sec;
              }
            }
            if (Object.keys(cleanGames).length > 0) {
              normalizedActivityUsers[String(uid)] = { games: cleanGames };
            }
          }
        }

        const rawMeta =
          parsed.activityMeta && typeof parsed.activityMeta === 'object'
            ? parsed.activityMeta
            : {};
        const normalizedActivityMeta = {
          announcedAt:
            typeof rawMeta.announcedAt === 'number' && Number.isFinite(rawMeta.announcedAt)
              ? rawMeta.announcedAt
              : null,
          lastResetMonth:
            typeof rawMeta.lastResetMonth === 'string' && /^\d{4}-\d{2}$/.test(rawMeta.lastResetMonth)
              ? rawMeta.lastResetMonth
              : statsMonth,
        };

        // Yalnızca bilinen temel veri yapılarını koruyarak yükle (registrations/activeApplications içindeki tüm yeni alanlar dahil)
        this.data = {
          ...parsed,
          registrations: Array.isArray(parsed.registrations) ? parsed.registrations : [],
          activeApplications:
            parsed.activeApplications && typeof parsed.activeApplications === 'object'
              ? parsed.activeApplications
              : {},
          rejectedApplications:
            parsed.rejectedApplications && typeof parsed.rejectedApplications === 'object'
              ? parsed.rejectedApplications
              : {},
          profanityStats: parsed.profanityStats || {},
          warningRoles: parsed.warningRoles || {},
          warningStats: parsed.warningStats || {},
          warnings: parsed.warnings || {},
          languagePrefs: normalizedLanguagePrefs,
          localeHints: normalizedLocaleHints,
          englishRoleId: parsed.englishRoleId || null,
          lockedChannels: parsed.lockedChannels || {},
          feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
          activityPrefs: normalizedActivityPrefs,
          activityStats: {
            month: statsMonth,
            users: normalizedActivityUsers,
          },
          activityMeta: normalizedActivityMeta,
        };
        if ('userLang' in this.data) {
          delete this.data.userLang;
        }
        this._dirty = false;
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[DATABASE] Veritabanı başlatılırken hata oluştu:', err);
      try {
        if (fs.existsSync(DB_PATH)) {
          const backupPath = path.join(DATA_DIR, `database.corrupted.${Date.now()}.json`);
          fs.copyFileSync(DB_PATH, backupPath);
          console.warn(`[DATABASE] Bozuk veritabanı yedeği alındı: ${backupPath}`);
        }
      } catch (backupErr) {
        console.error('[DATABASE] Bozuk dosya yedeği alınamadı:', backupErr);
      }
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpPath = `${DB_PATH}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, DB_PATH);
      this._dirty = false;
    } catch (err) {
      console.error('[DATABASE] Veritabanı kaydedilirken hata oluştu:', err);
    }
  }

  /**
   * Veriyi kirli olarak işaretler; toplu kayıt (checkpoint) sırasında diske yazılır.
   */
  markDirty() {
    this._dirty = true;
  }

  isDirty() {
    return Boolean(this._dirty);
  }

  /**
   * Kirli veri varsa tek seferde atomik olarak diske kaydeder.
   */
  flushDirty() {
    if (!this._dirty) return false;
    this.save();
    return true;
  }

  getCurrentIstanbulMonth(date = new Date()) {
    return getCurrentIstanbulMonth(date);
  }

  // ==========================================
  // KAYIT SİSTEMİ BÖLÜMÜ
  // ==========================================

  /**
   * Okuma sırasında eski kayıtları (games alanı yok, robloxUsername var)
   * bellekte çoklu oyun formatına dönüştürür (dosyayı yeniden yazmaz).
   */
  normalizeGamesForRead(record) {
    if (!record || typeof record !== 'object') return [];

    if (Array.isArray(record.games)) {
      return record.games
        .filter((g) => g && g.id && g.username)
        .map((g) => {
          const id = String(g.id).trim().toLowerCase();
          const username = String(g.username);
          const robloxId = g.robloxId ? String(g.robloxId) : null;
          const profileUrl =
            g.robloxProfileUrl ||
            (id === 'roblox' && robloxId ? `https://www.roblox.com/users/${robloxId}/profile` : null);
          return {
            id,
            username,
            verified: id === 'roblox' ? g.verified !== false : Boolean(g.verified),
            ...(robloxId ? { robloxId } : {}),
            ...(profileUrl ? { robloxProfileUrl: profileUrl } : {}),
          };
        });
    }

    // Geriye dönük uyumluluk: Eski kayıtta games yoksa robloxUsername üzerinden üret
    if (record.robloxUsername) {
      const rId = record.robloxId ? String(record.robloxId) : null;
      return [
        {
          id: 'roblox',
          username: String(record.robloxUsername),
          verified: Boolean(rId),
          ...(rId
            ? {
                robloxId: rId,
                robloxProfileUrl: `https://www.roblox.com/users/${rId}/profile`,
              }
            : {}),
        },
      ];
    }

    return [];
  }

  /**
   * Kayıt nesnesini okuma için normalize eder (displayName + games dahil), ham veriyi bozmaz.
   */
  normalizeRegistrationForRead(raw) {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    const displayName = raw.displayName || raw.realName || null;
    return {
      ...raw,
      displayName,
      realName: raw.realName || displayName,
      games: this.normalizeGamesForRead(raw),
    };
  }

  // Multi-Hesap Kontrolü: Bu Roblox ID'si başka bir Discord kullanıcısına kayıtlı mı?
  getRegistrationByRobloxId(robloxId) {
    if (!robloxId) return null;
    const targetId = String(robloxId);
    const found = (this.data.registrations || []).find((reg) => {
      if (reg.robloxId && String(reg.robloxId) === targetId) return true;
      if (Array.isArray(reg.games)) {
        return reg.games.some((g) => g && g.id === 'roblox' && g.robloxId && String(g.robloxId) === targetId);
      }
      return false;
    });
    return this.normalizeRegistrationForRead(found);
  }

  // Discord ID ile kayıt sorgulama
  getRegistrationByDiscordId(discordId) {
    if (!discordId) return null;
    const found = (this.data.registrations || []).find(
      (reg) => String(reg.discordId) === String(discordId)
    );
    return this.normalizeRegistrationForRead(found);
  }

  /**
   * Belirli bir oyuna kayıtlı tüm üyeleri döndürür (opsiyonel olarak bir Discord ID hariç tutulur).
   */
  findRegistrationsByGame(gameId, { excludeDiscordId = null } = {}) {
    const cleanGame = String(gameId || '').trim().toLowerCase();
    if (!cleanGame) return [];
    const exId = excludeDiscordId ? String(excludeDiscordId) : null;

    return (this.data.registrations || [])
      .map((r) => this.normalizeRegistrationForRead(r))
      .filter((reg) => {
        if (!reg) return false;
        if (exId && String(reg.discordId) === exId) return false;
        return reg.games.some((g) => g.id === cleanGame);
      });
  }

  /**
   * Belirli bir oyunda aynı kullanıcı adına sahip başka kayıtları arar (büyük/küçük harf duyarsız).
   */
  findRegistrationsByGameUsername(gameId, username, { excludeDiscordId = null } = {}) {
    const cleanGame = String(gameId || '').trim().toLowerCase();
    const targetName = String(username || '').trim().toLowerCase();
    if (!cleanGame || !targetName) return [];
    const exId = excludeDiscordId ? String(excludeDiscordId) : null;

    return (this.data.registrations || [])
      .map((r) => this.normalizeRegistrationForRead(r))
      .filter((reg) => {
        if (!reg) return false;
        if (exId && String(reg.discordId) === exId) return false;
        return reg.games.some(
          (g) => g.id === cleanGame && String(g.username || '').trim().toLowerCase() === targetName
        );
      });
  }

  // Yeni başarılı kaydı ekleme
  addRegistration(record) {
    const displayName = record.displayName || record.realName || null;
    const realName = record.realName || displayName;

    let gamesToStore;
    if (Array.isArray(record.games)) {
      gamesToStore = record.games
        .filter((g) => g && g.id && g.username)
        .map((g) => {
          const id = String(g.id).trim().toLowerCase();
          const rId = g.robloxId ? String(g.robloxId) : (id === 'roblox' && record.robloxId ? String(record.robloxId) : null);
          const profileUrl =
            g.robloxProfileUrl ||
            (id === 'roblox' && rId ? `https://www.roblox.com/users/${rId}/profile` : null);
          return {
            id,
            username: String(g.username),
            verified: id === 'roblox' ? g.verified !== false : Boolean(g.verified),
            ...(rId ? { robloxId: rId } : {}),
            ...(profileUrl ? { robloxProfileUrl: profileUrl } : {}),
          };
        });
    } else if (record.robloxUsername) {
      const rId = record.robloxId ? String(record.robloxId) : null;
      gamesToStore = [
        {
          id: 'roblox',
          username: String(record.robloxUsername),
          verified: Boolean(rId),
          ...(rId ? { robloxId: rId, robloxProfileUrl: `https://www.roblox.com/users/${rId}/profile` } : {}),
        },
      ];
    } else {
      gamesToStore = [];
    }

    const robloxEntry = gamesToStore.find((g) => g.id === 'roblox');
    const robloxId = robloxEntry?.robloxId || record.robloxId || null;
    const robloxUsername = robloxEntry?.username || record.robloxUsername || null;

    const cleanRecord = {
      ...record,
      displayName,
      realName,
      gender: record.gender || null,
      lang: record.lang === 'en' ? 'en' : 'tr',
      games: gamesToStore,
      robloxId,
      robloxUsername,
      approvedAt: record.approvedAt || Date.now(),
      approvedBy: record.approvedBy || null,
    };

    if (!Array.isArray(this.data.registrations)) {
      this.data.registrations = [];
    }

    const index = this.data.registrations.findIndex(
      (r) => String(r.discordId) === String(cleanRecord.discordId)
    );

    if (index !== -1) {
      this.data.registrations[index] = {
        ...this.data.registrations[index],
        ...cleanRecord,
        updatedAt: Date.now(),
      };
    } else {
      this.data.registrations.push({
        ...cleanRecord,
        registeredAt: record.registeredAt || Date.now(),
      });
    }

    this.save();
  }

  // Kayıt silme / sıfırlama (Roblox hesabı, tüm oyun bilgileri ve kayıt geçmişini bellekten kaldırır)
  removeRegistration(discordId) {
    if (!discordId) return { success: false, removedRecord: null };
    const strId = String(discordId);
    const existingIndex = (this.data.registrations || []).findIndex(
      (r) => String(r.discordId) === strId
    );

    let removedRecord = null;
    if (existingIndex !== -1) {
      removedRecord = this.normalizeRegistrationForRead({ ...this.data.registrations[existingIndex] });
      this.data.registrations.splice(existingIndex, 1);
    }

    if (this.data.activeApplications && this.data.activeApplications[strId]) {
      delete this.data.activeApplications[strId];
    }

    if (this.data.rejectedApplications && this.data.rejectedApplications[strId]) {
      delete this.data.rejectedApplications[strId];
    }

    this.save();
    return { success: Boolean(removedRecord), removedRecord };
  }

  // Aktif kayıt başvuru kontrolleri
  getActiveApplication(discordId) {
    if (!discordId) return null;
    const app = this.data.activeApplications?.[String(discordId)];
    if (!app) return null;
    const displayName = app.displayName || app.realName || null;
    return {
      ...app,
      displayName,
      realName: app.realName || displayName,
      games: this.normalizeGamesForRead(app),
    };
  }

  setActiveApplication(discordId, appData) {
    if (!this.data.activeApplications) this.data.activeApplications = {};
    const existing = this.data.activeApplications[String(discordId)] || {};
    const displayName = appData.displayName || appData.realName || existing.displayName || existing.realName || null;
    this.data.activeApplications[String(discordId)] = {
      ...existing,
      ...appData,
      displayName,
      realName: appData.realName || displayName,
      games: Array.isArray(appData.games) ? appData.games : (existing.games || []),
      lang: appData.lang || existing.lang || 'tr',
      createdAt: existing.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.save();
  }

  removeActiveApplication(discordId) {
    if (this.data.activeApplications && this.data.activeApplications[String(discordId)]) {
      delete this.data.activeApplications[String(discordId)];
      this.save();
    }
  }

  getRejectedApplication(discordId) {
    if (!discordId) return null;
    return (this.data.rejectedApplications && this.data.rejectedApplications[String(discordId)]) || null;
  }

  setRejectedApplication(discordId, data) {
    if (!this.data.rejectedApplications) this.data.rejectedApplications = {};
    this.data.rejectedApplications[String(discordId)] = {
      ...data,
      rejectedAt: Date.now(),
    };
    this.save();
  }

  clearRejectedApplication(discordId) {
    if (this.data.rejectedApplications && this.data.rejectedApplications[String(discordId)]) {
      delete this.data.rejectedApplications[String(discordId)];
      this.save();
    }
  }

  getAllRegistrations() {
    return (this.data.registrations || []).map((r) => this.normalizeRegistrationForRead(r));
  }

  /**
   * /veri-sifirla öncesi veritabanının yedeğini alır. En son 5 yedeği saklar.
   */
  backupDatabaseForReset() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const nowStr = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `database.backup-reset-${nowStr}.json`;
      const backupPath = path.join(DATA_DIR, backupFileName);

      fs.copyFileSync(DB_PATH, backupPath);

      // En fazla 5 adet backup-reset dosyasını sakla, eskileri temizle
      const files = fs.readdirSync(DATA_DIR)
        .filter((f) => f.startsWith('database.backup-reset-') && f.endsWith('.json'))
        .map((f) => ({
          name: f,
          path: path.join(DATA_DIR, f),
          time: fs.statSync(path.join(DATA_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 5) {
        for (let i = 5; i < files.length; i++) {
          try {
            fs.unlinkSync(files[i].path);
          } catch (e) {}
        }
      }

      return { success: true, fileName: backupFileName, path: backupPath };
    } catch (err) {
      console.error('[DATABASE] Reset yedeği alınamadı:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * /veri-sifirla için önizleme sayılarını hesaplar
   */
  getResetPreviewCounts() {
    const warningStats = this.data.warningStats || {};
    const warnings = this.data.warnings || {};
    const registrations = this.data.registrations || [];
    const activeApplications = this.data.activeApplications || {};

    const warnedUsersCount = Object.keys(warningStats).length;
    const totalWarningsCount = Object.keys(warnings).length;
    const activeTimeoutCount = Object.values(warningStats).filter(
      (s) => s.suspendedUntil && s.suspendedUntil > Date.now()
    ).length;

    return {
      warnedUsersCount,
      totalWarningsCount,
      activeTimeoutCount,
      registrationsCount: registrations.length,
      activeApplicationsCount: Object.keys(activeApplications).length,
    };
  }

  /**
   * Kullanıcı bazlı tüm uyarı verilerini sıfırlar (yapılandırma rolleri korunur)
   */
  resetWarningData() {
    this.data.warningStats = {};
    this.data.warnings = {};
    this.data.profanityStats = {};
    this.save();
    return true;
  }

  /**
   * Tüm kayıt ve başvuru verilerini sıfırlar
   */
  resetRegistrationData() {
    this.data.registrations = [];
    this.data.activeApplications = {};
    this.data.rejectedApplications = {};
    this.save();
    return true;
  }

  // Acil Yardım Paneli mesaj ID'si
  getHelpPanelMessageId() {
    return this.data.helpPanelMessageId || null;
  }

  setHelpPanelMessageId(msgId) {
    this.data.helpPanelMessageId = msgId;
    this.save();
  }

  // ==========================================
  // TRYOUT / SEVİYE DEĞERLENDİRME SİSTEMİ BÖLÜMÜ
  // ==========================================

  /**
   * Benzersiz bir Form Kodu üretir (Örn: TRY-4821)
   */
  generateFormCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      let randomPart = '';
      for (let i = 0; i < 5; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      code = `TRY-${randomPart}`;
    } while (this.data.tryoutForms && this.data.tryoutForms[code]);
    return code;
  }

  /**
   * Kullanıcının mevcut Tryout istatistiklerini getirir
   */
  getTryoutStats(userId) {
    if (!userId) return null;
    return this.data.tryoutStats[String(userId)] || null;
  }

  /**
   * Yeni bir Tryout değerlendirme formunu kaydeder ve kullanıcının istatistiklerini günceller
   */
  addTryoutEvaluation(formRecord) {
    const uid = String(formRecord.userId);
    const currentStats = this.data.tryoutStats[uid] || {
      userId: uid,
      roleId: null,
      level: 0,
      formCount: 0,
      lastUpdated: 0,
    };

    const newFormCount = (currentStats.formCount || 0) + 1;

    this.data.tryoutStats[uid] = {
      userId: uid,
      roleId: formRecord.newRoleId,
      level: formRecord.newLevel,
      formCount: newFormCount,
      lastUpdated: Date.now(),
    };

    const code = String(formRecord.formCode).toUpperCase();
    this.data.tryoutForms[code] = {
      ...formRecord,
      formCode: code,
      formNumberForUser: newFormCount,
      createdAt: formRecord.createdAt || Date.now(),
      cancelled: false,
    };

    this.save();
    return {
      stats: this.data.tryoutStats[uid],
      form: this.data.tryoutForms[code],
    };
  }

  /**
   * Form koduna göre değerlendirme kaydını getirir
   */
  getTryoutForm(rawCode) {
    if (!rawCode) return null;
    let clean = String(rawCode).trim().toUpperCase();
    if (this.data.tryoutForms[clean]) {
      return this.data.tryoutForms[clean];
    }
    if (!clean.startsWith('TRY-')) {
      const withPrefix = `TRY-${clean}`;
      if (this.data.tryoutForms[withPrefix]) {
        return this.data.tryoutForms[withPrefix];
      }
    }
    return null;
  }

  /**
   * Formu iptal eder ve kullanıcının veritabanındaki seviye/form sayısını önceki haline döndürür
   */
  cancelTryoutForm(formCode, cancelledByUserId) {
    const form = this.getTryoutForm(formCode);
    if (!form || form.cancelled) return null;

    form.cancelled = true;
    form.cancelledBy = String(cancelledByUserId);
    form.cancelledAt = Date.now();

    const uid = String(form.userId);
    const currentStats = this.data.tryoutStats[uid];

    if (currentStats) {
      const updatedCount = Math.max(0, (currentStats.formCount || 1) - 1);

      if (form.previousRoleId && form.previousLevel > 0) {
        this.data.tryoutStats[uid] = {
          ...currentStats,
          roleId: form.previousRoleId,
          level: form.previousLevel,
          formCount: updatedCount,
          lastUpdated: Date.now(),
        };
      } else if (updatedCount === 0) {
        delete this.data.tryoutStats[uid];
      } else {
        // Kullanıcının daha eski aktif bir formu varsa onu bul
        const activeUserForms = Object.values(this.data.tryoutForms)
          .filter((f) => String(f.userId) === uid && !f.cancelled)
          .sort((a, b) => b.createdAt - a.createdAt);

        if (activeUserForms.length > 0) {
          const latest = activeUserForms[0];
          this.data.tryoutStats[uid] = {
            ...currentStats,
            roleId: latest.newRoleId,
            level: latest.newLevel,
            formCount: updatedCount,
            lastUpdated: Date.now(),
          };
        } else {
          delete this.data.tryoutStats[uid];
        }
      }
    }

    this.save();
    return form;
  }

  /**
   * Tryout Sıralama Tablosu için tüm değerlendirilmiş üyeleri seviyeye göre (büyükten küçüğe) sıralar
   */
  getTryoutLeaderboard() {
    const entries = Object.values(this.data.tryoutStats || {})
      .filter((entry) => entry && entry.roleId && entry.level > 0 && entry.formCount > 0);

    entries.sort((a, b) => {
      if (b.level !== a.level) {
        return b.level - a.level; // Yüksek seviye üstte
      }
      if (b.formCount !== a.formCount) {
        return b.formCount - a.formCount; // Aynı seviyede form sayısı fazla olan üstte
      }
      return (a.lastUpdated || 0) - (b.lastUpdated || 0);
    });

    return entries;
  }

  getTryoutLeaderboardMessageId() {
    return this.data.tryoutLeaderboardMessageId || null;
  }

  setTryoutLeaderboardMessageId(msgId) {
    this.data.tryoutLeaderboardMessageId = msgId;
    this.save();
  }

  // ==========================================
  // KÜFÜR / UYGUNSUZ İÇERİK İHLAL KAYITLARI
  // ==========================================

  /**
   * Kullanıcının ihlal sayacını 1 artırır ve toplam ihlal sayısını döndürür
   */
  addProfanityViolation(userId) {
    const id = String(userId);
    const current = this.data.profanityStats[id] || { userId: id, count: 0, lastAt: 0 };
    current.count += 1;
    current.lastAt = Date.now();
    this.data.profanityStats[id] = current;
    this.save();
    return current.count;
  }

  getProfanityCount(userId) {
    const entry = this.data.profanityStats[String(userId)];
    return entry ? entry.count : 0;
  }

  // ==========================================
  // UYARI SİSTEMİ BÖLÜMÜ
  // ==========================================

  getWarningRoles() {
    return this.data.warningRoles || {};
  }

  setWarningRoles(rolesMap) {
    this.data.warningRoles = {
      ...(this.data.warningRoles || {}),
      ...rolesMap,
    };
    this.save();
    return this.data.warningRoles;
  }

  /**
   * 4 Haneli Benzersiz Uyarı ID'si Üretir (Örn: A8F2)
   */
  generateWarningId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    do {
      id = '';
      for (let i = 0; i < 4; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.data.warnings && this.data.warnings[id]);
    return id;
  }

  getUserWarningStats(userId) {
    const uid = String(userId);
    if (!this.data.warningStats[uid]) {
      return {
        userId: uid,
        points: 0,
        tier: 0,
        staffWarnings: 0,
        totalWarnings: 0,
        lastWarnedAt: 0,
        suspendedUntil: null,
      };
    }
    return this.data.warningStats[uid];
  }

  setUserWarningStats(userId, stats) {
    const uid = String(userId);
    this.data.warningStats[uid] = {
      ...this.getUserWarningStats(uid),
      ...stats,
      userId: uid,
    };
    this.save();
    return this.data.warningStats[uid];
  }

  getAllWarningStats() {
    return Object.values(this.data.warningStats || {});
  }

  saveWarningRecord(record) {
    const id = String(record.id).toUpperCase().replace(/^#/, '');
    this.data.warnings[id] = {
      ...record,
      id,
      createdAt: record.createdAt || Date.now(),
      cancelled: false,
    };
    this.save();
    return this.data.warnings[id];
  }

  getWarningRecord(rawId) {
    if (!rawId) return null;
    const clean = String(rawId).trim().toUpperCase().replace(/^#/, '');
    return this.data.warnings[clean] || null;
  }

  updateWarningRecord(rawId, patch) {
    const record = this.getWarningRecord(rawId);
    if (!record) return null;
    Object.assign(record, patch);
    this.save();
    return record;
  }

  // ==========================================
  // DİL TERCİHİ (TR / EN) BÖLÜMÜ
  // ==========================================

  /**
   * Eski string ('tr'|'en') veya yeni nesne yapısındaki dil kaydını okunur forma normalize eder.
   */
  normalizeUserLangEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const clean = raw.trim().toLowerCase();
      if (clean !== 'tr' && clean !== 'en') return null;
      return {
        lang: clean,
        source: 'legacy',
        updatedAt: null,
      };
    }
    if (typeof raw === 'object') {
      const clean = raw.lang === 'en' ? 'en' : raw.lang === 'tr' ? 'tr' : null;
      if (!clean) return null;
      return {
        lang: clean,
        source: raw.source === 'manual' ? 'manual' : 'legacy',
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
      };
    }
    return null;
  }

  /**
   * Kullanıcının detaylı dil tercihi nesnesini ({ lang, source, updatedAt }) döndürür.
   */
  getUserLangInfo(userId) {
    if (!userId || !this.data.languagePrefs) return null;
    return this.normalizeUserLangEntry(this.data.languagePrefs[String(userId)]);
  }

  /**
   * Geriye dönük imza: kullanıcının kayıtlı dil kodunu ('tr'|'en'|null) döndürür.
   */
  getUserLang(userId) {
    const info = this.getUserLangInfo(userId);
    return info ? info.lang : null;
  }

  /**
   * Kullanıcının dil tercihini kaynağını ('manual' | 'legacy') belirterek kaydeder.
   */
  setUserLang(userId, lang, source = 'manual') {
    if (!userId) return null;
    if (!this.data.languagePrefs) this.data.languagePrefs = {};
    const cleanLang = lang === 'en' ? 'en' : 'tr';
    const cleanSource = source === 'legacy' ? 'legacy' : 'manual';
    this.data.languagePrefs[String(userId)] = {
      lang: cleanLang,
      source: cleanSource,
      updatedAt: Date.now(),
    };
    this.save();
    return cleanLang;
  }

  /**
   * Kullanıcının kayıtlı dil tercihini tamamen temizler (otomatik / sıfırlama için).
   */
  clearUserLang(userId) {
    if (!userId || !this.data.languagePrefs) return false;
    const uid = String(userId);
    if (Object.prototype.hasOwnProperty.call(this.data.languagePrefs, uid)) {
      delete this.data.languagePrefs[uid];
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Kullanıcının Discord istemci dilinden türetilen son dil ipucunu döndürür.
   */
  getLocaleHint(userId) {
    if (!userId || !this.data.localeHints) return null;
    const val = this.data.localeHints[String(userId)];
    return val === 'tr' || val === 'en' ? val : null;
  }

  /**
   * Discord istemci dilinden türetilen ipucunu yalnızca değer değiştiyse diske yazar.
   */
  setLocaleHint(userId, lang) {
    if (!userId) return false;
    if (!this.data.localeHints) this.data.localeHints = {};
    const uid = String(userId);
    const cleanLang = lang === 'en' ? 'en' : 'tr';
    if (this.data.localeHints[uid] === cleanLang) {
      return false;
    }
    this.data.localeHints[uid] = cleanLang;
    this.save();
    return true;
  }

  /**
   * Veritabanındaki eski (source === 'legacy') dil kaydı sayısını döndürür.
   */
  getLegacyLangCount() {
    if (!this.data.languagePrefs) return 0;
    let count = 0;
    for (const rawVal of Object.values(this.data.languagePrefs)) {
      const info = this.normalizeUserLangEntry(rawVal);
      if (info && info.source === 'legacy') count++;
    }
    return count;
  }

  getEnglishRoleId() {
    return this.data.englishRoleId || null;
  }

  setEnglishRoleId(roleId) {
    this.data.englishRoleId = roleId;
    this.save();
    return roleId;
  }

  // ==========================================
  // KANAL KİLİTLEME (!lock / !unlock) BÖLÜMÜ
  // ==========================================

  getLockedChannel(channelId) {
    if (!channelId) return null;
    return (this.data.lockedChannels && this.data.lockedChannels[String(channelId)]) || null;
  }

  setLockedChannel(channelId, data) {
    if (!channelId) return null;
    if (!this.data.lockedChannels) this.data.lockedChannels = {};
    this.data.lockedChannels[String(channelId)] = {
      ...data,
      channelId: String(channelId),
      lockedAt: data.lockedAt || Date.now(),
    };
    this.save();
    return this.data.lockedChannels[String(channelId)];
  }

  removeLockedChannel(channelId) {
    if (!channelId || !this.data.lockedChannels) return;
    if (this.data.lockedChannels[String(channelId)]) {
      delete this.data.lockedChannels[String(channelId)];
      this.save();
    }
  }

  // ==========================================
  // GERİ BİLDİRİM (FEEDBACK) BÖLÜMÜ
  // ==========================================

  /**
   * 6 karakterli benzersiz harf-rakam geri bildirim ID'si üretir
   */
  generateFeedbackId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    if (!Array.isArray(this.data.feedback)) {
      this.data.feedback = [];
    }
    const existingIds = new Set(this.data.feedback.map((item) => item.id));
    let id = '';
    do {
      id = '';
      for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (existingIds.has(id));
    return id;
  }

  getFeedbackList() {
    return Array.isArray(this.data.feedback) ? this.data.feedback : [];
  }

  addFeedback(record) {
    if (!Array.isArray(this.data.feedback)) {
      this.data.feedback = [];
    }

    const entry = {
      id: record.id || this.generateFeedbackId(),
      userId: String(record.userId),
      usernameSnapshot: String(record.usernameSnapshot || ''),
      message: String(record.message),
      page: String(record.page || '/'),
      lang: record.lang === 'en' ? 'en' : 'tr',
      createdAt: record.createdAt || Date.now(),
      status: record.status || 'new',
      channelId: record.channelId || null,
      messageId: record.messageId || null,
    };

    this.data.feedback.push(entry);

    // En fazla 2000 kayıt sakla, en eskileri sil
    if (this.data.feedback.length > 2000) {
      this.data.feedback = this.data.feedback.slice(this.data.feedback.length - 2000);
    }

    this.save();
    return entry;
  }

  updateFeedback(id, patch) {
    if (!Array.isArray(this.data.feedback)) return null;
    const entry = this.data.feedback.find((item) => item.id === id);
    if (!entry) return null;
    Object.assign(entry, patch);
    this.save();
    return entry;
  }

  // ==========================================
  // KLAN SİSTEMİ BÖLÜMÜ (CLAN ROLES & KNOWN CLANS)
  // ==========================================

  getClanRoles() {
    return Array.isArray(this.data.clanRoles) ? this.data.clanRoles : [];
  }

  getClanRoleByRoleId(roleId) {
    if (!roleId) return null;
    return this.getClanRoles().find((cr) => String(cr.roleId) === String(roleId)) || null;
  }

  addClanRole(roleData) {
    if (!Array.isArray(this.data.clanRoles)) this.data.clanRoles = [];
    const roleId = String(roleData.roleId);
    const existingIndex = this.data.clanRoles.findIndex((cr) => String(cr.roleId) === roleId);

    const entry = {
      id: roleData.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      roleId,
      name: String(roleData.name || ''),
      normalized: String(roleData.normalized || ''),
      compact: String(roleData.compact || ''),
      aliases: Array.isArray(roleData.aliases) ? [...new Set(roleData.aliases.map(String).filter(Boolean))] : [],
      source: roleData.source || 'bot', // 'bot' | 'adopted' | 'manual'
      createdBy: roleData.createdBy ? String(roleData.createdBy) : null,
      createdAt: roleData.createdAt || Date.now(),
    };

    if (existingIndex !== -1) {
      this.data.clanRoles[existingIndex] = {
        ...this.data.clanRoles[existingIndex],
        ...entry,
        aliases: [
          ...new Set([
            ...(this.data.clanRoles[existingIndex].aliases || []),
            ...entry.aliases,
          ]),
        ],
      };
    } else {
      this.data.clanRoles.push(entry);
    }

    this.save();
    return entry;
  }

  updateClanRole(roleId, patch) {
    const list = this.getClanRoles();
    const entry = list.find((cr) => String(cr.roleId) === String(roleId));
    if (!entry) return null;
    Object.assign(entry, patch);
    this.save();
    return entry;
  }

  removeClanRoleByRoleId(roleId) {
    if (!roleId || !Array.isArray(this.data.clanRoles)) return false;
    const initialLen = this.data.clanRoles.length;
    this.data.clanRoles = this.data.clanRoles.filter((cr) => String(cr.roleId) !== String(roleId));
    if (this.data.clanRoles.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  addClanAlias(roleId, alias) {
    if (!roleId || !alias) return false;
    const entry = this.getClanRoleByRoleId(roleId);
    if (!entry) return false;
    if (!Array.isArray(entry.aliases)) entry.aliases = [];
    const cleanAlias = String(alias).trim();
    if (cleanAlias && !entry.aliases.includes(cleanAlias)) {
      entry.aliases.push(cleanAlias);
      this.save();
      return true;
    }
    return false;
  }

  getKnownClans() {
    return Array.isArray(this.data.knownClans) ? this.data.knownClans : [];
  }

  findKnownClanById(id) {
    if (!id) return null;
    return this.getKnownClans().find((kc) => String(kc.id) === String(id)) || null;
  }

  addKnownClan(clanData) {
    if (!Array.isArray(this.data.knownClans)) this.data.knownClans = [];
    const entry = {
      id: clanData.id || `kc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: String(clanData.name || '').trim(),
      normalized: String(clanData.normalized || ''),
      compact: String(clanData.compact || ''),
      type: clanData.type === 'enemy' ? 'enemy' : 'ally',
      createdBy: clanData.createdBy ? String(clanData.createdBy) : null,
      createdAt: clanData.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.data.knownClans.push(entry);
    this.save();
    return entry;
  }

  updateKnownClan(id, patch) {
    const list = this.getKnownClans();
    const entry = list.find((kc) => String(kc.id) === String(id));
    if (!entry) return null;
    Object.assign(entry, patch, { updatedAt: Date.now() });
    this.save();
    return entry;
  }

  removeKnownClan(id) {
    if (!id || !Array.isArray(this.data.knownClans)) return false;
    const initialLen = this.data.knownClans.length;
    this.data.knownClans = this.data.knownClans.filter((kc) => String(kc.id) !== String(id));
    if (this.data.knownClans.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  setClanPanelMessage(channelId, messageId) {
    this.data.clanPanelChannelId = channelId ? String(channelId) : null;
    this.data.clanPanelMessageId = messageId ? String(messageId) : null;
    this.save();
  }

  getClanPanelMessage() {
    return {
      channelId: this.data.clanPanelChannelId || null,
      messageId: this.data.clanPanelMessageId || null,
    };
  }

  // ==========================================
  // OYUN ETKİNLİĞİ VE AYLIK SÜRE BÖLÜMÜ
  // (Yalnızca aylık toplam saniye + kullanıcı tercihleri; geçmiş/zaman çizelgesi tutulmaz)
  // ==========================================

  getActivityPrefs(userId) {
    if (!userId) return { tracking: true, autoMove: true };
    const stored = this.data.activityPrefs?.[String(userId)];
    if (!stored || typeof stored !== 'object') {
      return { tracking: true, autoMove: true };
    }
    return {
      tracking: stored.tracking !== false,
      autoMove: stored.autoMove !== false,
    };
  }

  isActivityTrackingEnabled(userId) {
    return this.getActivityPrefs(userId).tracking;
  }

  isActivityAutoMoveEnabled(userId) {
    const prefs = this.getActivityPrefs(userId);
    return prefs.tracking && prefs.autoMove;
  }

  /**
   * Kullanıcı etkinlik tercihlerini günceller.
   * Varsayılan duruma (tracking:true, autoMove:true) dönen kayıtlar yer tutmaması için silinir.
   */
  setActivityPrefs(userId, patch = {}) {
    if (!userId) return { tracking: true, autoMove: true };
    if (!this.data.activityPrefs || typeof this.data.activityPrefs !== 'object') {
      this.data.activityPrefs = {};
    }
    const uid = String(userId);
    const current = this.getActivityPrefs(uid);
    const next = {
      tracking: patch.tracking !== undefined ? Boolean(patch.tracking) : current.tracking,
      autoMove: patch.autoMove !== undefined ? Boolean(patch.autoMove) : current.autoMove,
    };

    if (next.tracking && next.autoMove) {
      if (Object.prototype.hasOwnProperty.call(this.data.activityPrefs, uid)) {
        delete this.data.activityPrefs[uid];
        this.save();
      }
    } else {
      this.data.activityPrefs[uid] = next;
      this.save();
    }
    return next;
  }

  /**
   * Kullanıcının bu ayki ilgili oyun süresine saniye ekler.
   * Varsayılan olarak kirli işaretler (checkpoint ile toplu yazılır); immediate:true ile hemen kaydeder.
   */
  addActivitySeconds(userId, gameId, seconds, { immediate = false } = {}) {
    if (!userId || !gameId) return 0;
    const sec = Math.floor(Number(seconds));
    if (!Number.isFinite(sec) || sec <= 0) return 0;

    if (!this.data.activityStats || typeof this.data.activityStats !== 'object') {
      this.data.activityStats = { month: getCurrentIstanbulMonth(), users: {} };
    }
    if (!this.data.activityStats.users || typeof this.data.activityStats.users !== 'object') {
      this.data.activityStats.users = {};
    }

    const uid = String(userId);
    const gid = String(gameId);
    if (!this.data.activityStats.users[uid]) {
      this.data.activityStats.users[uid] = { games: {} };
    }
    if (!this.data.activityStats.users[uid].games) {
      this.data.activityStats.users[uid].games = {};
    }

    const prev = Number(this.data.activityStats.users[uid].games[gid]) || 0;
    const nextTotal = prev + sec;
    this.data.activityStats.users[uid].games[gid] = nextTotal;

    if (immediate) {
      this.save();
    } else {
      this.markDirty();
    }
    return nextTotal;
  }

  getUserActivityStats(userId) {
    const month = this.data.activityStats?.month || getCurrentIstanbulMonth();
    if (!userId) return { month, games: {} };
    const rawGames = this.data.activityStats?.users?.[String(userId)]?.games;
    const games = {};
    if (rawGames && typeof rawGames === 'object') {
      for (const [gid, sec] of Object.entries(rawGames)) {
        const cleanSec = Math.floor(Number(sec));
        if (Number.isFinite(cleanSec) && cleanSec > 0) {
          games[gid] = cleanSec;
        }
      }
    }
    return { month, games };
  }

  clearUserActivityStats(userId, { immediate = true } = {}) {
    if (!userId || !this.data.activityStats?.users) return false;
    const uid = String(userId);
    if (!Object.prototype.hasOwnProperty.call(this.data.activityStats.users, uid)) {
      return false;
    }
    delete this.data.activityStats.users[uid];
    if (immediate) {
      this.save();
    } else {
      this.markDirty();
    }
    return true;
  }

  /**
   * Sunucudan ayrılan üyenin hem aylık sürelerini hem de etkinlik tercihlerini siler.
   */
  removeUserActivityData(userId) {
    if (!userId) return false;
    const uid = String(userId);
    let changed = false;

    if (this.data.activityStats?.users && Object.prototype.hasOwnProperty.call(this.data.activityStats.users, uid)) {
      delete this.data.activityStats.users[uid];
      changed = true;
    }
    if (this.data.activityPrefs && Object.prototype.hasOwnProperty.call(this.data.activityPrefs, uid)) {
      delete this.data.activityPrefs[uid];
      changed = true;
    }
    if (changed) {
      this.save();
    }
    return changed;
  }

  /**
   * Aylık sıfırlama: önceki aya ait HİÇBİR kullanıcı süresi tutulmaz, tümü temizlenir.
   */
  resetActivityStatsForMonth(newMonth) {
    const targetMonth =
      typeof newMonth === 'string' && /^\d{4}-\d{2}$/.test(newMonth)
        ? newMonth
        : getCurrentIstanbulMonth();

    this.data.activityStats = {
      month: targetMonth,
      users: {},
    };
    if (!this.data.activityMeta || typeof this.data.activityMeta !== 'object') {
      this.data.activityMeta = { announcedAt: null, lastResetMonth: targetMonth };
    } else {
      this.data.activityMeta.lastResetMonth = targetMonth;
    }
    this.save();
    return targetMonth;
  }

  getActivityMeta() {
    const meta = this.data.activityMeta && typeof this.data.activityMeta === 'object'
      ? this.data.activityMeta
      : {};
    return {
      announcedAt: typeof meta.announcedAt === 'number' ? meta.announcedAt : null,
      lastResetMonth: meta.lastResetMonth || this.data.activityStats?.month || getCurrentIstanbulMonth(),
    };
  }

  setActivityAnnounced(timestamp = Date.now()) {
    if (!this.data.activityMeta || typeof this.data.activityMeta !== 'object') {
      this.data.activityMeta = {
        announcedAt: timestamp,
        lastResetMonth: this.data.activityStats?.month || getCurrentIstanbulMonth(),
      };
    } else {
      this.data.activityMeta.announcedAt = timestamp;
    }
    this.save();
  }
}

module.exports = new DatabaseManager();
