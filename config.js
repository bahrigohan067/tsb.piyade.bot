require('dotenv').config();

module.exports = {
  // Marka Adı (Piyade Topluluğu)
  BRAND_NAME: (process.env.BRAND_NAME || 'Piyade').trim(),

  // Bot Tokeni (Tırnak işaretleri ve boşluklar otomatik temizlenir)
  TOKEN: (process.env.TSB_TOKEN || process.env.DISCORD_TOKEN || '').trim().replace(/^['"]+|['"]+$/g, ''),

  // Sunucu (Guild) ID
  GUILD_ID: (process.env.GUILD_ID || '1559313292651008040').trim().replace(/^['"]+|['"]+$/g, ''),

  // REST API Port ve Gizli Anahtar (Authorization: Bearer <API_SECRET>)
  PORT: process.env.PORT || 3000,
  API_SECRET: (process.env.API_SECRET || '').trim().replace(/^['"]+|['"]+$/g, ''),

  // Web Sitesi Geri Bildirim Kanalı ID'si
  FEEDBACK_CHANNEL_ID: (process.env.FEEDBACK_CHANNEL_ID || '1570061735665078392').trim().replace(/^['"]+|['"]+$/g, ''),

  // Kanal ID'leri
  CHANNELS: {
    // Kayıt Paneli ve Başvuruların Yapıldığı Kanal
    REGISTER: '1559605626198302741',
    // Yetkililerin Başvuruları Onaylayıp/Reddettiği Kanal
    STAFF_APPROVAL: '1559621928187199488',
    // İsim Rengi Seçim Paneli Kanalı
    COLOR_PANEL: '1559605214690934854',
    // Küfür / Uygunsuz İçerik Log Kanalı
    PROFANITY_LOG: '1563911595590156361',
    // Uyarı Verme Paneli Kanalı
    WARNING_PANEL: '1563923294602666125',
    // Uyarıların Düşeceği Bildirim / Log Kanalı
    WARNING_LOG: '1563923439121604720',
    // Web Paneli Denetim Loglarının Gönderileceği Kanal
    WEB_AUDIT_LOG: (process.env.WEB_AUDIT_LOG_CHANNEL_ID || '1570045724580913152').trim(),
    // Web Sitesi Geri Bildirim (Feedback Pill) Kanalı
    FEEDBACK_CHANNEL: (process.env.FEEDBACK_CHANNEL_ID || '1570061735665078392').trim(),
    // Sadece Medya Paylaşım Kanalı
    MEDIA: '1559316020227739806',
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

    // Hesabı Onaylı Rolü (APPROVED_ROLES içinde ilk rol)
    VERIFIED: '1559604645821812896',

    // Cinsiyet Rolleri
    MALE: '1559637360558350356',     // Erkek rolü
    FEMALE: '1559637300042797096',   // Kız rolü

    // Kayıt Yetkili Rolü
    STAFF: '1559625308737507358',

    // Kapışma Talep Yetkilisi Rolü (Arşiv)
    VS_STAFF: '1559892661547307038',

    // Developer Rolü
    DEVELOPER: '1561777507223601353',

    // Yönetmenlik / Üst Yetkili Rolü
    TRYOUT_STAFF: '1559614111128490044',

    // Mesaj Denetimcisi Rolü (Küfür log kanalında etiketlenir)
    MESSAGE_MODERATOR: '1563914587273953363',

    // Askıda (1 Haftalık Karantina / Jail) Rolü
    SUSPENDED: '1563922256525000895',

    // Uyarı Sistemi Yetkilileri (Butonları ve /uyari-iptal komutunu kullanabilenler)
    WARNING_AUTHORITIES: [
      '1561777507223601353', // Developer
      '1559614111128490044', // Yönetmenlik
    ],

    // 4. Yetkili Uyarısında veya Y1 İhlalinde Alınacak Yetkili Rolleri
    STAFF_ROLES_TO_STRIP: [
      '1559625308737507358', // Kayıt Yetkilisi
      '1559892661547307038', // Kapışma Talep Yetkilisi
      '1563914587273953363', // Mesaj Denetimcisi
      '1559614111128490044', // Yönetmenlik / Üst Yetkili
    ],

    // Medya Kanalı Denetiminden Muaf Yönetim Rolleri (Kurucu / Üst Yönetim)
    MEDIA_EXEMPT: [
      '1559614111128490044', // Yönetmenlik
      '1561777507223601353', // Kurucu / Developer
    ],

    // Kanal Kilitleme (!lock / !unlock) Komutunu Kullanabilen ve Kilitli Kanalda Yazabilen Roller
    LOCK_AUTHORITIES: [
      '1559614111128490044', // Yönetmenlik
      '1561777507223601353', // Developer
      '1559604770396967022', // Üst Yetkili
    ],
  },

  // Renk Kodları (Discord Embed renkleri)
  COLORS: {
    PRIMARY: 0x0099FF,       // Canlı Mavi
    BLUE: 0x0099FF,          // Mavi
    PENDING: 0x0099FF,       // İnceleme / Başvuru Kartı (Mavi)
    SUCCESS: 0x2ECC71,       // Yeşil / Onaylandı
    DANGER: 0xE74C3C,        // Kırmızı / Reddedildi
    GOLD_ORANGE: 0xFF8C00,   // Sarı ve Turuncu Karışımı
    NAVY: 0x0A2540,          // Lacivert
    WARNING_ORANGE: 0xFF7A00, // Turuncu (Kullanıcı Uyarı DM'i & Sözlü Uyarı için)
    DARK_RED: 0x8B0000,      // Koyu Kırmızı (Yetkili Uyarıları için)
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
    RANK_10_PINK: '<:729153pinkten:1567525744102350898>',
    RANK_11: '<:150932pinkeleven:1567525792001560716>',
    RANK_12: '<:825209pinktwelve:1567525821554626630>',
    RANK_13: '<:903474numberthirteen:1567525857944150137>',
    RANK_14: '<:676773pinkfourteen:1567525896020299797>',
    RANK_15: '<:887312pinkfifteen:1567525938370052106>',
    RANK_16: '<:985910pinksixteen:1567525983345705092>',
    RANK_17: '<:521106pinkseventeen:1567526024101765313>',
    GOLEM: '<a:778420loopingirongolem:1559910628141957171>',
    MODERATOR: '<:240274moderator:1559920704009408622>',
    MODERATOR_ALT: '<:240274moderator:1542555878266376352>',
    ADMIN_BADGE: '<:822329admin:1563223450057838662>',
    TROPHY: '<a:94814firstplacetrophy:1559907969041436732>',
    WINNER_ADMIN: '<:613354roleadminpink:1559915566029078670>',
    COFFIN: '<:758573neoncoffin:1559915506650062948>',
    SKULL: '<:567685skull:1559915534617809017>',
  },

  // İsim Rengi Rolleri (1559605214690934854 Kanalı İçin)
  COLOR_ROLES: [
    { id: '1559899395233808444', label: 'Siyah',   emoji: '🖤', style: 'Secondary' },
    { id: '1559926857472675910', label: 'Kırmızı', emoji: '❤️', style: 'Danger' },
    { id: '1559927000183873597', label: 'Sarı',    emoji: '💛', style: 'Secondary' },
    { id: '1559926616535339010', label: 'Mavi',    emoji: '💙', style: 'Primary' },
    { id: '1559926912338362379', label: 'Yeşil',   emoji: '💚', style: 'Success' },
    { id: '1559926687645311017', label: 'Pembe',   emoji: '🩷', style: 'Primary' },
  ],

  /**
   * Üyenin sunucuda kayıtlı bir üye olup olmadığını doğrular.
   * @param {import('discord.js').GuildMember} member
   * @returns {boolean}
   */
  isRegisteredMember(member) {
    if (!member || !member.roles?.cache) return false;
    const roles = module.exports.ROLES || {};
    return Boolean(roles.REGISTERED_CHECK && member.roles.cache.has(roles.REGISTERED_CHECK));
  },
};
