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
      vsStats: {},                    // { [userId]: { kills: number, wins: number, losses: number, lastUpdated: number } }
      activeVs: {},                   // { [channelId]: { channelId, challengerId, opponentId, createdAt, warned5Hours: boolean } }
      top10MessageId: null,           // Top 10 paneli mesaj ID'si
      helpPanelMessageId: null,       // Acil yardım paneli mesaj ID'si
      tryoutStats: {},                // { [userId]: { userId, roleId, level, formCount, lastUpdated } }
      tryoutForms: {},                // { [formCode]: { formCode, userId, staffId, previousRoleId, previousLevel, newRoleId, newLevel, description, improvements, resultMessageId, resultChannelId, createdAt, cancelled } }
      tryoutLeaderboardMessageId: null, // Tryout sıralama tablosu mesaj ID'si
      profanityStats: {},             // { [userId]: { userId, count, lastAt } }
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
          vsStats: parsed.vsStats || {},
          activeVs: parsed.activeVs || {},
          top10MessageId: parsed.top10MessageId || null,
          helpPanelMessageId: parsed.helpPanelMessageId || null,
          tryoutStats: parsed.tryoutStats || {},
          tryoutForms: parsed.tryoutForms || {},
          tryoutLeaderboardMessageId: parsed.tryoutLeaderboardMessageId || null,
          profanityStats: parsed.profanityStats || {},
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

  getAllRegistrations() {
    return this.data.registrations;
  }

  // ==========================================
  // VS (KAPIŞMA) & TOP 10 SİSTEMİ BÖLÜMÜ
  // ==========================================

  // Kullanıcının VS istatistiklerini getirir
  getVsStats(userId) {
    const defaultStats = { kills: 0, wins: 0, losses: 0 };
    if (!userId) return defaultStats;
    return this.data.vsStats[String(userId)] || defaultStats;
  }

  // Kazanan kişiye kill ve win ekler
  addVsWin(userId) {
    const id = String(userId);
    if (!this.data.vsStats[id]) {
      this.data.vsStats[id] = { kills: 0, wins: 0, losses: 0, lastUpdated: Date.now() };
    }
    this.data.vsStats[id].kills += 1;
    this.data.vsStats[id].wins += 1;
    this.data.vsStats[id].lastUpdated = Date.now();
    this.save();
    return this.data.vsStats[id];
  }

  // Kaybeden kişiye loss ekler
  addVsLoss(userId) {
    const id = String(userId);
    if (!this.data.vsStats[id]) {
      this.data.vsStats[id] = { kills: 0, wins: 0, losses: 0, lastUpdated: Date.now() };
    }
    this.data.vsStats[id].losses += 1;
    this.data.vsStats[id].lastUpdated = Date.now();
    this.save();
    return this.data.vsStats[id];
  }

  // Top 10 listesi getir (En çok kill alan en üstte, 0 kill olanlar dahil edilmez)
  getTop10() {
    const entries = Object.entries(this.data.vsStats)
      .map(([userId, stats]) => ({
        userId,
        kills: stats.kills || 0,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        lastUpdated: stats.lastUpdated || 0,
      }))
      .filter((entry) => entry.kills > 0); // 0 kill olanlar sıralamada yer almaz

    // Kill sayısına göre çoktan aza sırala
    entries.sort((a, b) => {
      if (b.kills !== a.kills) {
        return b.kills - a.kills;
      }
      return b.wins - a.wins;
    });

    return entries.slice(0, 10);
  }

  // Aktif VS Talebi Yönetimi
  setActiveVs(channelId, data) {
    this.data.activeVs[String(channelId)] = {
      ...data,
      channelId: String(channelId),
      createdAt: data.createdAt || Date.now(),
      warned5Hours: data.warned5Hours || false,
    };
    this.save();
  }

  getActiveVsByChannel(channelId) {
    if (!channelId) return null;
    return this.data.activeVs[String(channelId)] || null;
  }

  getActiveVsByUser(userId) {
    if (!userId) return null;
    const uid = String(userId);
    return Object.values(this.data.activeVs).find(
      (vs) => String(vs.challengerId) === uid || String(vs.opponentId) === uid
    ) || null;
  }

  removeActiveVs(channelId) {
    if (this.data.activeVs[String(channelId)]) {
      delete this.data.activeVs[String(channelId)];
      this.save();
    }
  }

  getAllActiveVs() {
    return Object.values(this.data.activeVs);
  }

  // Top 10 mesaj ID'si
  getTop10MessageId() {
    return this.data.top10MessageId || null;
  }

  setTop10MessageId(msgId) {
    this.data.top10MessageId = msgId;
    this.save();
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
}

module.exports = new DatabaseManager();
