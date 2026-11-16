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

  // Rol ID'leri (Sunucuda Bulunan 38 Rolün Tamamı)
  ROLES: {
    // -------------------------------------------------------------
    // 1. Üst Yönetim ve Yetkili Rolleri
    // -------------------------------------------------------------
    COMMUNITY_OFFICIAL: '1570767625188016259', // #1  | Community Official
    DEVELOPER: '1561777507223601353',          // #2  💻| DEVELOPER
    FOUNDER: '1559567065130737664',            // #3  FOUNDER (Sunucu Kurucusu)
    CODER: '1570454776888430593',              // #4  </> (Geliştirici / Kod Rolü)
    DEV_ALT: '1570454776888430593',
    STAFF_GENERAL: '1568543109720317992',      // #5  🛡️| Yetkili
    YETKILI: '1568543109720317992',
    MESSAGE_MODERATOR: '1563914587273953363',  // #16 💭| Mesaj Denetimcisi
    STAFF: '1559625308737507358',              // #17 | Başvuru Yetkilisi (Kayıt Yetkilisi)
    APPLICATION_STAFF: '1559625308737507358',

    // Arşiv Yetkili Rolleri (Geriye Uyumluluk İçin)
    TRYOUT_STAFF: '1559614111128490044',       // Yönetmenlik / Üst Yetkili
    VS_STAFF: '1559892661547307038',           // Kapışma Talep Yetkilisi

    // -------------------------------------------------------------
    // 2. Bot ve Entegrasyon Rolleri
    // -------------------------------------------------------------
    SERVER_BOTS: '1559926335995117590',        // #6  ®️| Sunucu Botları
    BOT_MUSIC: '1559572934983688272',          // #7  Piyade RP | Music Bot (Bot Entegrasyonu)
    BOT_MAIN: '1559602223183433842',           // #8  PİYADE TEAM | TSB BOT (Bot Entegrasyonu)
    BOT_TSB: '1559602223183433842',
    SERVER_BOOSTER: '1571813234644619284',      // #22 Server Booster (Sunucu Takviyecisi)
    BOOSTER: '1571813234644619284',
    BOT_QUARK_LOGGER: '1566236438574665858',   // #36 Quark Logger (Bot Entegrasyonu)
    BOT_DISBOARD: '1569339982932475936',       // #38 DISBOARD.org (Bot Entegrasyonu)

    // -------------------------------------------------------------
    // 3. Özel Üye ve Topluluk Rolleri
    // -------------------------------------------------------------
    VIP: '1568995152561971312',                 // #9  👑 | VİP
    CENGAVER: '1559604702143062016',           // #20 ♾️| Cengaver (Kayıtlı Üye Kontrol Rolü)
    REGISTERED_CHECK: '1559604702143062016',
    WEEKLY_ACTIVE: '1570138106923974867',      // #24 | Haftanın En Çok Atifi
    MOST_ACTIVE_OF_WEEK: '1570138106923974867',
    MUSIC_PERMISSION: '1559575677584539769',   // #25 | Müzik Açma İzni
    MUSIC_PERM: '1559575677584539769',

    // -------------------------------------------------------------
    // 4. İsim Rengi Rolleri
    // -------------------------------------------------------------
    COLOR_BLACK: '1559899395233808444',        // #10 Siyah
    COLOR_BLUE: '1559926616535339010',         // #11 Mavi
    COLOR_PINK: '1559926687645311017',         // #12 Pembe
    COLOR_RED: '1559926857472675910',          // #13 Kırmızı
    COLOR_GREEN: '1559926912338362379',        // #14 Yeşil
    COLOR_YELLOW: '1559927000183873597',       // #15 Sarı

    // -------------------------------------------------------------
    // 5. Kayıt ve Temel Üye Rolleri
    // -------------------------------------------------------------
    FEMALE: '1559637300042797096',             // #18 | Kız (Cinsiyet Rolü)
    MALE: '1559637360558350356',               // #19 | Erkek (Cinsiyet Rolü)
    VERIFIED: '1559604645821812896',           // #21 | Hesabı Onaylı
    UNREGISTERED: '1559604540997636147',       // #23 | Kayıtsız (Yeni Gelen Üye)

    // Başvuru onaylandığında kullanıcıya verilecek genel roller
    APPROVED_ROLES: [
      '1559604645821812896', // | Hesabı Onaylı
      '1559604702143062016', // ♾️| Cengaver
    ],

    // Diğer klan rolü (Geriye dönük test uyumluluğu için)
    OTHER_CLAN: '1570460155437518960',

    // -------------------------------------------------------------
    // 6. Dil Rolleri
    // -------------------------------------------------------------
    ENGLISH: '1567541917028458557',            // #37 🇬🇧 English

    // -------------------------------------------------------------
    // 7. Ceza ve Uyarı Sistemi Rolleri
    // -------------------------------------------------------------
    SUSPENDED: '1563922256525000895',          // #26 | Askıda (1 Haftalık Karantina/Jail)

    // Katılımcı Uyarı Rolleri (1 - 5 Puan)
    WARN_1: '1563926964144832623',             // #27 Uyarı 1
    WARN_2: '1563926965059326147',             // #28 Uyarı 2
    WARN_3: '1563926966434930850',             // #29 Uyarı 3
    WARN_4: '1563926967428972704',             // #30 Uyarı 4
    WARN_5: '1563926968561565726',             // #31 Uyarı 5
    UYARI_1: '1563926964144832623',
    UYARI_2: '1563926965059326147',
    UYARI_3: '1563926966434930850',
    UYARI_4: '1563926967428972704',
    UYARI_5: '1563926968561565726',

    // Yetkili Uyarı Rolleri (1 - 3)
    STAFF_WARN_1: '1563926970037837975',       // #32 Yetkili Uyarı 1
    STAFF_WARN_2: '1563926971409367402',       // #33 Yetkili Uyarı 2
    STAFF_WARN_3: '1563926972223066188',       // #34 Yetkili Uyarı 3
    YETKILI_UYARI_1: '1563926970037837975',
    YETKILI_UYARI_2: '1563926971409367402',
    YETKILI_UYARI_3: '1563926972223066188',

    // Kalıcı Ceza Rolü
    BANNED: '1563926973707853884',             // #35 Yasaklı
    YASAKLI: '1563926973707853884',

    // Uyarı Rolleri Dizi Listesi (Toplu işlemler ve temizlikler için)
    WARNINGS: [
      '1563926964144832623', // Uyarı 1
      '1563926965059326147', // Uyarı 2
      '1563926966434930850', // Uyarı 3
      '1563926967428972704', // Uyarı 4
      '1563926968561565726', // Uyarı 5
    ],

    STAFF_WARNINGS: [
      '1563926970037837975', // Yetkili Uyarı 1
      '1563926971409367402', // Yetkili Uyarı 2
      '1563926972223066188', // Yetkili Uyarı 3
    ],

    // warningManager otomatik kontrol haritası
    WARNING_ROLES_MAP: {
      uyari1: '1563926964144832623',
      uyari2: '1563926965059326147',
      uyari3: '1563926966434930850',
      uyari4: '1563926967428972704',
      uyari5: '1563926968561565726',
      yetkiliUyari1: '1563926970037837975',
      yetkiliUyari2: '1563926971409367402',
      yetkiliUyari3: '1563926972223066188',
      yasakli: '1563926973707853884',
    },

    // -------------------------------------------------------------
    // 8. Yetki ve Muafiyet Listeleri
    // -------------------------------------------------------------
    // Uyarı Sistemi Yetkilileri (Butonları ve /uyari-iptal komutunu kullanabilenler)
    WARNING_AUTHORITIES: [
      '1561777507223601353', // 💻| DEVELOPER
      '1559567065130737664', // FOUNDER
      '1570767625188016259', // | Community Official
      '1559614111128490044', // Yönetmenlik (Arşiv)
    ],

    // 4. Yetkili Uyarısında veya Y1 İhlalinde Alınacak Yetkili Rolleri
    STAFF_ROLES_TO_STRIP: [
      '1568543109720317992', // 🛡️| Yetkili
      '1559625308737507358', // | Başvuru Yetkilisi
      '1563914587273953363', // 💭| Mesaj Denetimcisi
      '1559892661547307038', // Kapışma Talep Yetkilisi (Arşiv)
      '1559614111128490044', // Yönetmenlik / Üst Yetkili (Arşiv)
    ],

    // Medya Kanalı Denetiminden Muaf Yönetim Rolleri (Kurucu / Üst Yönetim)
    MEDIA_EXEMPT: [
      '1561777507223601353', // 💻| DEVELOPER
      '1559567065130737664', // FOUNDER
      '1570767625188016259', // | Community Official
      '1559614111128490044', // Yönetmenlik (Arşiv)
    ],

    // Kanal Kilitleme (!lock / !unlock) Komutunu Kullanabilen ve Kilitli Kanalda Yazabilen Roller
    LOCK_AUTHORITIES: [
      '1561777507223601353', // 💻| DEVELOPER
      '1559567065130737664', // FOUNDER
      '1570767625188016259', // | Community Official
      '1568543109720317992', // 🛡️| Yetkili
      '1559614111128490044', // Yönetmenlik (Arşiv)
      '1559604770396967022', // Üst Yetkili (Arşiv)
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

  // Sunucudaki Tüm Rollerin Hiyerarşik Sıralı Kataloğu (/rols komutu çıktısı)
  SERVER_ROLES: [
    { rank: 1,  id: '1570767625188016259', name: '| Community Official', key: 'COMMUNITY_OFFICIAL' },
    { rank: 2,  id: '1561777507223601353', name: '💻| DEVELOPER', key: 'DEVELOPER' },
    { rank: 3,  id: '1559567065130737664', name: 'FOUNDER', key: 'FOUNDER' },
    { rank: 4,  id: '1570454776888430593', name: '</>', key: 'CODER' },
    { rank: 5,  id: '1568543109720317992', name: '🛡️| Yetkili', key: 'STAFF_GENERAL' },
    { rank: 6,  id: '1559926335995117590', name: '®️| Sunucu Botları', key: 'SERVER_BOTS' },
    { rank: 7,  id: '1559572934983688272', name: 'Piyade RP | Music Bot', key: 'BOT_MUSIC', managed: true },
    { rank: 8,  id: '1559602223183433842', name: 'PİYADE TEAM | TSB BOT', key: 'BOT_TSB', managed: true },
    { rank: 9,  id: '1568995152561971312', name: '👑 | VİP', key: 'VIP' },
    { rank: 10, id: '1559899395233808444', name: 'Siyah', key: 'COLOR_BLACK' },
    { rank: 11, id: '1559926616535339010', name: 'Mavi', key: 'COLOR_BLUE' },
    { rank: 12, id: '1559926687645311017', name: 'Pembe', key: 'COLOR_PINK' },
    { rank: 13, id: '1559926857472675910', name: 'Kırmızı', key: 'COLOR_RED' },
    { rank: 14, id: '1559926912338362379', name: 'Yeşil', key: 'COLOR_GREEN' },
    { rank: 15, id: '1559927000183873597', name: 'Sarı', key: 'COLOR_YELLOW' },
    { rank: 16, id: '1563914587273953363', name: '💭| Mesaj Denetimcisi', key: 'MESSAGE_MODERATOR' },
    { rank: 17, id: '1559625308737507358', name: '| Başvuru Yetkilisi', key: 'STAFF' },
    { rank: 18, id: '1559637300042797096', name: '| Kız', key: 'FEMALE' },
    { rank: 19, id: '1559637360558350356', name: '| Erkek', key: 'MALE' },
    { rank: 20, id: '1559604702143062016', name: '♾️| Cengaver', key: 'CENGAVER' },
    { rank: 21, id: '1559604645821812896', name: '| Hesabı Onaylı', key: 'VERIFIED' },
    { rank: 22, id: '1571813234644619284', name: 'Server Booster', key: 'SERVER_BOOSTER', managed: true },
    { rank: 23, id: '1559604540997636147', name: '| Kayıtsız', key: 'UNREGISTERED' },
    { rank: 24, id: '1570138106923974867', name: '| Haftanın En Çok Atifi', key: 'WEEKLY_ACTIVE' },
    { rank: 25, id: '1559575677584539769', name: '| Müzik Açma İzni', key: 'MUSIC_PERMISSION' },
    { rank: 26, id: '1563922256525000895', name: '| Askıda', key: 'SUSPENDED' },
    { rank: 27, id: '1563926964144832623', name: 'Uyarı 1', key: 'WARN_1' },
    { rank: 28, id: '1563926965059326147', name: 'Uyarı 2', key: 'WARN_2' },
    { rank: 29, id: '1563926966434930850', name: 'Uyarı 3', key: 'WARN_3' },
    { rank: 30, id: '1563926967428972704', name: 'Uyarı 4', key: 'WARN_4' },
    { rank: 31, id: '1563926968561565726', name: 'Uyarı 5', key: 'WARN_5' },
    { rank: 32, id: '1563926970037837975', name: 'Yetkili Uyarı 1', key: 'STAFF_WARN_1' },
    { rank: 33, id: '1563926971409367402', name: 'Yetkili Uyarı 2', key: 'STAFF_WARN_2' },
    { rank: 34, id: '1563926972223066188', name: 'Yetkili Uyarı 3', key: 'STAFF_WARN_3' },
    { rank: 35, id: '1563926973707853884', name: 'Yasaklı', key: 'BANNED' },
    { rank: 36, id: '1566236438574665858', name: 'Quark Logger', key: 'BOT_QUARK_LOGGER', managed: true },
    { rank: 37, id: '1567541917028458557', name: '🇬🇧 English', key: 'ENGLISH' },
    { rank: 38, id: '1569339982932475936', name: 'DISBOARD.org', key: 'BOT_DISBOARD', managed: true },
  ],

  /**
   * Rol ID'sine göre katalogdaki rol bilgisini döner.
   * @param {string} roleId
   */
  getRoleById(roleId) {
    if (!roleId) return null;
    return (module.exports.SERVER_ROLES || []).find((r) => r.id === String(roleId)) || null;
  },

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
