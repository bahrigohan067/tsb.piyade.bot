require('dotenv').config();

module.exports = {
  // Bot Tokeni (Tırnak işaretleri ve boşluklar otomatik temizlenir)
  TOKEN: (process.env.TSB_TOKEN || process.env.DISCORD_TOKEN || '').trim().replace(/^['"]+|['"]+$/g, ''),

  // Sunucu (Guild) ID
  GUILD_ID: (process.env.GUILD_ID || '1559313292651008040').trim().replace(/^['"]+|['"]+$/g, ''),

  // Kanal ID'leri
  CHANNELS: {
    // Kayıt Paneli ve Başvuruların Yapıldığı Kanal
    REGISTER: '1559605626198302741',
    // Yetkililerin Başvuruları Onaylayıp/Reddettiği Kanal
    STAFF_APPROVAL: '1559621928187199488',
  },

  // Rol ID'leri
  ROLES: {
    // Sunucuya yeni gelen üyelere verilecek "Kayıtsız" rolü
    UNREGISTERED: '1559604540997636147',

    // Zaten kayıtlı olup olmadığını kontrol etmek için kullanılan rol
    REGISTERED_CHECK: '1559604702143062016',

    // Başvuru onaylandığında kullanıcıya verilecek genel roller
    APPROVED_ROLES: [
      '1559604645821812896',
      '1559604702143062016',
    ],

    // Cinsiyet Rolleri
    MALE: '1559637360558350356',     // Erkek rolü
    FEMALE: '1559637300042797096',   // Kız rolü

    // Başvuruları incelemeye ve butonları kullanmaya yetkili rol
    STAFF: '1559625308737507358',
  },

  // Renk Kodları (Discord Embed renkleri)
  COLORS: {
    PRIMARY: 0x0099FF,   // Canlı Mavi
    BLUE: 0x0099FF,      // Mavi
    PENDING: 0x0099FF,   // İnceleme / Başvuru Kartı (Mavi)
    SUCCESS: 0x2ECC71,   // Yeşil / Onaylandı
    DANGER: 0xE74C3C,    // Kırmızı / Reddedildi
  },
};
