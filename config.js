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
    // VS Talep Paneli Kanalı
    VS_PANEL: '1559317566617554975',
    // VS Sonuç Duyuru Kanalı
    VS_RESULT: '1559317757294546975',
    // Top 10 Sıralama Kanalı
    TOP10: '1559318329775104020',
    // Acil Takviye / Yardım Paneli Kanalı
    HELP_PANEL: '1559323174594945104',
    // Yardım Çağrılarının Düşeceği Bildirim Kanalı
    HELP_ALERT: '1559928245598560336',
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

    // Kayıt Yetkili Rolü
    STAFF: '1559625308737507358',

    // Kapışma Talep Yetkilisi Rolü
    VS_STAFF: '1559892661547307038',

    // Developer Rolü
    DEVELOPER: '1561777507223601353',
  },

  // Renk Kodları (Discord Embed renkleri)
  COLORS: {
    PRIMARY: 0x0099FF,       // Canlı Mavi
    BLUE: 0x0099FF,          // Mavi
    PENDING: 0x0099FF,       // İnceleme / Başvuru Kartı (Mavi)
    SUCCESS: 0x2ECC71,       // Yeşil / Onaylandı
    DANGER: 0xE74C3C,        // Kırmızı / Reddedildi
    GOLD_ORANGE: 0xFF8C00,   // Sarı ve Turuncu Karışımı (Top 10 için)
  },

  // Özel Discord Emojileri
  EMOJIS: {
    KING: '<a:30489king:1559908124545253496>',
    MEDAL_1: '<a:76245medalla:1559907872358277202>',
    MEDAL_2: '<a:720660medalbronze:1559907899541557268>',
    MEDAL_3: '<a:78330medalsilver:1559907937709719602>',
    PURPLE_LINE: '<a:382752purplelines:1559914040896004146>',
    RANK_4: '<:3471904pink:1559914400209567814>',
    RANK_5: '<:1584355pink:1559914462058651678>',
    RANK_6: '<:3176656pink:1559914490961600573>',
    RANK_7: '<:6833737pink:1559914518992126013>',
    RANK_8: '<:463688pink:1559914548042145912>',
    RANK_9: '<:7340409pink:1559914574449213460>',
    RANK_10: '<a:304874clinic1010:1559914623220588584>',
    GOLEM: '<a:778420loopingirongolem:1559910628141957171>',
    MODERATOR: '<:240274moderator:1559920704009408622>',
    TROPHY: '<a:94814firstplacetrophy:1559907969041436732>',
    WINNER_ADMIN: '<:613354roleadminpink:1559915566029078670>',
    COFFIN: '<:758573neoncoffin:1559915506650062948>',
    SKULL: '<:567685skull:1559915534617809017>',
  },
};
