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
      vsStats: {},          // { [userId]: { kills: number, wins: number, losses: number, lastUpdated: number } }
      activeVs: {},         // { [channelId]: { channelId, challengerId, opponentId, createdAt, warned5Hours: boolean } }
      top10MessageId: null, // Top 10 paneli mesaj ID'si
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
}

module.exports = new DatabaseManager();
