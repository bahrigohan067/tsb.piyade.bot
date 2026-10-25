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
    // Tryout / Seviye Değerlendirme Paneli Kanalı
    TRYOUT_PANEL: '1562459282040029225',
    // Tryout Sıralama Tablosu Kanalı
    TRYOUT_LEADERBOARD: '1563212550332612700',
    // Tryout Anket Sonuçlarının Paylaşıldığı Kanal
    TRYOUT_RESULT: '1563218527584788560',
    // Seviye Atlama / Değişim Log Kanalı
    TRYOUT_LOG: '1562031846295076874',
    // İsim Rengi Seçim Paneli Kanalı
    COLOR_PANEL: '1559605214690934854',
    // Küfür / Uygunsuz İçerik Log Kanalı
    PROFANITY_LOG: '1563911595590156361',
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

    // Tryout / Seviye Değerlendirme Yetkilisi Rolü
    TRYOUT_STAFF: '1559614111128490044',
  },

  // Özel Kullanıcı ID'leri
  USERS: {
    TRYOUT_HEADER_USER: '1225903173961777152',
  },

  // Renk Kodları (Discord Embed renkleri)
  COLORS: {
    PRIMARY: 0x0099FF,       // Canlı Mavi
    BLUE: 0x0099FF,          // Mavi
    PENDING: 0x0099FF,       // İnceleme / Başvuru Kartı (Mavi)
    SUCCESS: 0x2ECC71,       // Yeşil / Onaylandı
    DANGER: 0xE74C3C,        // Kırmızı / Reddedildi
    GOLD_ORANGE: 0xFF8C00,   // Sarı ve Turuncu Karışımı (Top 10 için)
    NAVY: 0x0A2540,          // Lacivert (Tryout Değerlendirme Kartı için)
    WARNING_ORANGE: 0xFF7A00, // Turuncu (Kullanıcı Uyarı DM'i için)
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

  // Aşamalı Seviye Rolleri (1 = En Düşük Seviye, 37 = En Üst Seviye)
  LEVEL_ROLES: [
    { level: 1,  order: 22, id: '1563092531867164742', name: 'Low weak 4',    canonical: 'low weak 4',    aliases: ['low weak 4', 'lw4', 'low 4 weak'] },
    { level: 2,  order: 23, id: '1563092582802657310', name: 'Low stable 4',  canonical: 'low stable 4',  aliases: ['low stable 4', 'ls4', 'low 4 stable'] },
    { level: 3,  order: 24, id: '1563092648989040751', name: 'Low strong 4',  canonical: 'low strong 4',  aliases: ['low strong 4', 'lstr4', 'low 4 strong'] },
    { level: 4,  order: 25, id: '1563092700805341214', name: 'Low weak 3',    canonical: 'low weak 3',    aliases: ['low weak 3', 'lw3', 'low 3 weak'] },
    { level: 5,  order: 26, id: '1563092750545723464', name: 'Low stable 3',  canonical: 'low stable 3',  aliases: ['low stable 3', 'ls3', 'low 3 stable'] },
    { level: 6,  order: 27, id: '1563092801774821439', name: 'Low strong 3',  canonical: 'low strong 3',  aliases: ['low strong 3', 'lstr3', 'low 3 strong'] },
    { level: 7,  order: 28, id: '1563092867692367892', name: 'Low weak 2',    canonical: 'low weak 2',    aliases: ['low weak 2', 'lw2', 'low 2 weak'] },
    { level: 8,  order: 29, id: '1563092925317906513', name: 'Low stable 2',  canonical: 'low stable 2',  aliases: ['low stable 2', 'ls2', 'low 2 stable'] },
    { level: 9,  order: 30, id: '1563092976937476116', name: 'Low strong 2',  canonical: 'low strong 2',  aliases: ['low strong 2', 'lstr2', 'low 2 strong'] },
    { level: 10, order: 31, id: '1563093055807037511', name: 'Low weak 2',    canonical: 'low weak 1',    aliases: ['low weak 1', 'lw1', 'low 1 weak', 'low weak 2 #31'] },
    { level: 11, order: 32, id: '1563093176112381953', name: 'Low stable 2',  canonical: 'low stable 1',  aliases: ['low stable 1', 'ls1', 'low 1 stable', 'low stable 2 #32'] },
    { level: 12, order: 33, id: '1563093229597888572', name: 'Low strong 1',  canonical: 'low strong 1',  aliases: ['low strong 1', 'lstr1', 'low 1 strong'] },
    { level: 13, order: 34, id: '1563093414109511730', name: 'Mid weak 4',    canonical: 'mid weak 4',    aliases: ['mid weak 4', 'mw4', 'mid 4 weak'] },
    { level: 14, order: 35, id: '1563093461425717318', name: 'Mid stable 4',  canonical: 'mid stable 4',  aliases: ['mid stable 4', 'ms4', 'mid 4 stable'] },
    { level: 15, order: 36, id: '1563093530308649034', name: 'Mid strong 4',  canonical: 'mid strong 4',  aliases: ['mid strong 4', 'mstr4', 'mid 4 strong'] },
    { level: 16, order: 37, id: '1563093644108497006', name: 'Mid weak 3',    canonical: 'mid weak 3',    aliases: ['mid weak 3', 'mw3', 'mid 3 weak'] },
    { level: 17, order: 38, id: '1563093697376161853', name: 'Mid stable 3',  canonical: 'mid stable 3',  aliases: ['mid stable 3', 'ms3', 'mid 3 stable'] },
    { level: 18, order: 39, id: '1563093808512630795', name: 'Mid strong 3',  canonical: 'mid strong 3',  aliases: ['mid strong 3', 'mstr3', 'mid 3 strong'] },
    { level: 19, order: 40, id: '1563093864577765416', name: 'Mid weak 2',    canonical: 'mid weak 2',    aliases: ['mid weak 2', 'mw2', 'mid 2 weak'] },
    { level: 20, order: 41, id: '1563093942894071808', name: 'Mid stable 2',  canonical: 'mid stable 2',  aliases: ['mid stable 2', 'ms2', 'mid 2 stable'] },
    { level: 21, order: 42, id: '1563094015228772425', name: 'Mid strong 2',  canonical: 'mid strong 2',  aliases: ['mid strong 2', 'mstr2', 'mid 2 strong'] },
    { level: 22, order: 43, id: '1563094189787447296', name: 'Mid weak 1',    canonical: 'mid weak 1',    aliases: ['mid weak 1', 'mw1', 'mid 1 weak'] },
    { level: 23, order: 44, id: '1563094244313268285', name: 'Mid stable 1',  canonical: 'mid stable 1',  aliases: ['mid stable 1', 'ms1', 'mid 1 stable'] },
    { level: 24, order: 45, id: '1563094327092056104', name: 'Mid strong 1',  canonical: 'mid strong 1',  aliases: ['mid strong 1', 'mstr1', 'mid 1 strong'] },
    { level: 25, order: 46, id: '1563188918529036338', name: 'Hihg weak 4',   canonical: 'high weak 4',   aliases: ['high weak 4', 'hihg weak 4', 'hw4', 'high 4 weak'] },
    { level: 26, order: 47, id: '1563194977406943232', name: 'Hihg stable 4', canonical: 'high stable 4', aliases: ['high stable 4', 'hihg stable 4', 'hs4', 'high 4 stable'] },
    { level: 27, order: 48, id: '1563195185486102608', name: 'High strong 4', canonical: 'high strong 4', aliases: ['high strong 4', 'hihg strong 4', 'hstr4', 'high 4 strong'] },
    { level: 28, order: 49, id: '1563200337891041280', name: 'Hihg weak 3',   canonical: 'high weak 3',   aliases: ['high weak 3', 'hihg weak 3', 'hw3', 'high 3 weak'] },
    { level: 29, order: 50, id: '1563195219564961803', name: 'Hihg stable 3', canonical: 'high stable 3', aliases: ['high stable 3', 'hihg stable 3', 'hs3', 'high 3 stable'] },
    { level: 30, order: 51, id: '1563195203735785602', name: 'High strong 3', canonical: 'high strong 3', aliases: ['high strong 3', 'hihg strong 3', 'hstr3', 'high 3 strong'] },
    { level: 31, order: 52, id: '1563200825806037032', name: 'Hihg weak 2',   canonical: 'high weak 2',   aliases: ['high weak 2', 'hihg weak 2', 'hw2', 'high 2 weak'] },
    { level: 32, order: 53, id: '1563200691348963338', name: 'Hihg stable 2', canonical: 'high stable 2', aliases: ['high stable 2', 'hihg stable 2', 'hs2', 'high 2 stable'] },
    { level: 33, order: 54, id: '1563200633790795878', name: 'High strong 2', canonical: 'high strong 2', aliases: ['high strong 2', 'hihg strong 2', 'hstr2', 'high 2 strong'] },
    { level: 34, order: 55, id: '1563202108780707951', name: 'Hihg weak 1',   canonical: 'high weak 1',   aliases: ['high weak 1', 'hihg weak 1', 'hw1', 'high 1 weak'] },
    { level: 35, order: 56, id: '1563202135603154964', name: 'Hihg stable 1', canonical: 'high stable 1', aliases: ['high stable 1', 'hihg stable 1', 'hs1', 'high 1 stable'] },
    { level: 36, order: 57, id: '1563202153445720074', name: 'High strong 1', canonical: 'high strong 1', aliases: ['high strong 1', 'hihg strong 1', 'hstr1', 'high 1 strong'] },
    { level: 37, order: 58, id: '1563188620809080843', name: 'Hihg Strong 0', canonical: 'high strong 0', aliases: ['high strong 0', 'hihg strong 0', 'hstr0', 'high 0', 'strong 0'] },
  ],
};
