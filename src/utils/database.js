const fs = require('fs');
const path = require('path');

// Railway Kalıcı Disk (Volume) veya Yerel data klasörü desteği
const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '..', '..', 'data'));
const DB_PATH = path.join(DATA_DIR, 'database.json');

class DatabaseManager {
  constructor() {
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
      languagePrefs: {},              // { [userId]: 'tr' | 'en' }
      englishRoleId: null,            // Otomatik veya tanımlı 🇬🇧 English rolü ID'si
      lockedChannels: {},             // { [channelId]: { channelId, lockedBy, lockedAt, overwrites: [...] } }
      feedback: [],                   // [{ id, userId, usernameSnapshot, message, page, lang, createdAt, status, channelId, messageId }]
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
        this.data = {
          registrations: parsed.registrations || [],
          activeApplications: parsed.activeApplications || {},
          rejectedApplications: parsed.rejectedApplications || {},
          helpPanelMessageId: parsed.helpPanelMessageId || null,
          tryoutStats: parsed.tryoutStats || {},
          tryoutForms: parsed.tryoutForms || {},
          tryoutLeaderboardMessageId: parsed.tryoutLeaderboardMessageId || null,
          profanityStats: parsed.profanityStats || {},
          warningRoles: parsed.warningRoles || {},
          warningStats: parsed.warningStats || {},
          warnings: parsed.warnings || {},
          languagePrefs: parsed.languagePrefs || {},
          englishRoleId: parsed.englishRoleId || null,
          lockedChannels: parsed.lockedChannels || {},
          feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[DATABASE] Veritabanı başlatılırken hata oluştu:', err);
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DATABASE] Veritabanı kaydedilirken hata oluştu:', err);
    }
  }

  // ==========================================
  // KAYIT SİSTEMİ BÖLÜMÜ
  // ==========================================

  // Multi-Hesap Kontrolü: Bu Roblox ID'si başka bir Discord kullanıcısına kayıtlı mı?
  getRegistrationByRobloxId(robloxId) {
    if (!robloxId) return null;
    return this.data.registrations.find(
      (reg) => String(reg.robloxId) === String(robloxId)
    );
  }

  // Discord ID ile kayıt sorgulama
  getRegistrationByDiscordId(discordId) {
    if (!discordId) return null;
    return this.data.registrations.find(
      (reg) => String(reg.discordId) === String(discordId)
    );
  }

  // Yeni başarılı kaydı ekleme
  addRegistration(record) {
    const index = this.data.registrations.findIndex(
      (r) => String(r.discordId) === String(record.discordId)
    );

    if (index !== -1) {
      this.data.registrations[index] = {
        ...this.data.registrations[index],
        ...record,
        updatedAt: Date.now(),
      };
    } else {
      this.data.registrations.push({
        ...record,
        registeredAt: Date.now(),
      });
    }

    this.save();
  }

  // Aktif kayıt başvuru kontrolleri
  getActiveApplication(discordId) {
    if (!discordId) return null;
    return this.data.activeApplications[String(discordId)] || null;
  }

  setActiveApplication(discordId, appData) {
    this.data.activeApplications[String(discordId)] = {
      ...appData,
      createdAt: Date.now(),
    };
    this.save();
  }

  removeActiveApplication(discordId) {
    if (this.data.activeApplications[String(discordId)]) {
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
    return this.data.registrations;
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

  getUserLang(userId) {
    if (!userId) return null;
    return (this.data.languagePrefs && this.data.languagePrefs[String(userId)]) || null;
  }

  setUserLang(userId, lang) {
    if (!userId) return null;
    if (!this.data.languagePrefs) this.data.languagePrefs = {};
    const clean = lang === 'en' ? 'en' : 'tr';
    this.data.languagePrefs[String(userId)] = clean;
    this.save();
    return clean;
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
}

module.exports = new DatabaseManager();
