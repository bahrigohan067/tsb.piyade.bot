const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');

class DatabaseManager {
  constructor() {
    this.data = {
      registrations: [],
      activeApplications: {},
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
        this.data = JSON.parse(fileContent);
        if (!this.data.registrations) this.data.registrations = [];
        if (!this.data.activeApplications) this.data.activeApplications = {};
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
    // Varsa eskisini güncelle veya yenisini ekle
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

  // Aktif başvuru kontrolleri
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
}

module.exports = new DatabaseManager();
