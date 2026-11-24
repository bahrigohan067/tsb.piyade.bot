/**
 * Piyade Topluluk Botu - Oyun Etkinliği Yapılandırması (activity.config.js)
 *
 * Yeni oyun eklemek = GAMES listesine bir kayıt eklemek.
 * Not: Bu dosya kayıt sisteminin kullandığı games.config.js dosyasından AYRIDIR.
 * Tüm Discord etkinlik eşleşmeleri, oyun aktiflik rol ID'leri ve hedef ses kanalları buradan yönetilir.
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

// =========================================================================
// 1. GENEL AYARLAR VE ZAMANLAYICILAR
// =========================================================================

// Bot komut kanalı: ses aktarımı geri sayım mesajları, aylık sıfırlama ve ilk duyuru buraya gider
const COMMAND_CHANNEL_ID = '1559316204030533722';

// Oyun bitince üyenin geri aktarılacağı bekleme/sohbet ses kanalı ("Salon 1")
const RETURN_CHANNEL_ID = '1559927197056241816';

// Salon 1'e dönüş yalnızca yönetilen oyun ses kanallarından (GAMES + OTHER GAMES) yapılsın
const RETURN_ONLY_FROM_GAME_CHANNELS = true;

// Oyun bitince Salon 1'e otomatik dönüş özelliği genel açma/kapama anahtarı
const RETURN_ENABLED = true;

// true iken otomatik Oyun Aktiflik Rolü yalnızca üye bir ses kanalındayken verilir.
// false yapılırsa eski davranış (rol oyun onaylanınca, sesten bağımsız) aynen çalışır.
const ROLE_REQUIRES_VOICE = true;

// true yapılırsa üye ses kanalından tamamen çıkınca otomatik (manuel /oyun olmayan) aktiflik rolü de alınır.
// Varsayılan false: rol yalnızca oyun bitince alınır (mevcut davranış).
const ROLE_REMOVE_ON_VOICE_LEAVE = false;

// Üye oyun ses kanalına aktarıldıktan sonra sesten tamamen düşerse (bağlantı kopması vb.) ve oyun sürüyorsa
// tekrar bir ses kanalına girdiğinde yeniden geri sayım başlatıp oyunun kanalına aktarır.
const REARM_AFTER_DISCONNECT = true;

// Aynı oyun oturumunda en çok kaç kez sesten düşme sonrası yeniden aktarma hakkı verilebilir
const REARM_MAX_PER_SESSION = 3;

// Aynı üye için iki yeniden aktarma geri sayımı arasında en az kaç saniye geçmelidir (spam koruması)
const REARM_MIN_GAP_SEC = 30;

// Aylık sıfırlama ve tarih hesaplamalarında kullanılan saat dilimi
const TIMEZONE = 'Europe/Istanbul';

// Mobil /oyun manuel aktiflik rolleri için takvim günü ve gece 00:00 temizliği saat dilimi (Intl.DateTimeFormat ile çözülür)
const MANUAL_TIMEZONE = 'Europe/Istanbul';

// True yapılırsa gece 00:00'da 4 aktiflik rolünün role.members önbelleğindeki canlı oturumu olmayan herkesin rolü de alınır (varsayılan KAPALI)
const MANUAL_CLEAR_ALL_ACTIVITY_ROLES = false;

// =========================================================================
// 1b. İSTATİSTİK, AKTİF SAYIM, SÜRE GÜVENCESİ VE ROBLOX GRUPLAMA AYARLARI
// =========================================================================

// "Bu ay aktif oyuncu" (activeThisMonth) sayımına girmek için bir üyenin
// bu ay kaydetmiş olması gereken en az oynama süresi (dakika). Varsayılan: 1 dk.
const MIN_ACTIVE_MINUTES = 1;

// Aktif oyuncu ve şu an oyunda tanımlarının merkezi referans metinleri (TR/EN)
const ACTIVE_METRIC_DEFINITIONS = Object.freeze({
  activeThisMonth: {
    tr: 'Kayıtlı, sunucuda hâlâ bulunan, bot olmayan, takibi açık ve bu ay en az MIN_ACTIVE_MINUTES dakika süresi olan benzersiz üye sayısı.',
    en: 'Unique registered, non-bot members currently in the server with tracking enabled and at least MIN_ACTIVE_MINUTES recorded this month.',
  },
  playingNow: {
    tr: 'Kayıtlı, takibi açık ve canlı Discord presence verisiyle doğrulanan onaylı (CONFIRM_SEC geçmiş) oyun oturumu olan benzersiz üye sayısı.',
    en: 'Unique registered members with tracking enabled who have a confirmed (CONFIRM_SEC elapsed) live game session reconciled with live Discord presence.',
  },
});

// Önbellekte olmayan üyelerin sunucuda hâlâ bulunup bulunmadığını sayım sırasında doğrularken
// tek sayım turunda yapılabilecek en fazla guild.members.fetch çağrısı (Discord hız sınırı koruması).
const SAYIM_MEMBER_LOOKUP_CAP = 25;

// Üyelik doğrulama sonuçlarının bellek önbellek süresi (1 saat)
const SAYIM_MEMBER_CACHE_TTL_MS = 60 * 60 * 1000;

// Aynı üye için sayım amaçlı guild.members.fetch çağrıları arası en az bekleme süresi (10 dakika)
const SAYIM_MEMBER_USER_COOLDOWN_MS = 10 * 60 * 1000;

// İstatistik uç noktalarının bellek önbellek süresi (60 saniye)
const STATS_CACHE_TTL_MS = 60 * 1000;

// true yapılırsa site oyun sıralamasında ve /aktivitem çıktısında Roblox (ve çok oyunlu aile)
// satırının altında küçük kırılım ("içinde: Oyun adı süre, ...", en çok 5 oyun + "+N diğer") gösterilir.
// Varsayılan KAPALI (false): tasarım sade kalır.
const SHOW_FAMILY_BREAKDOWN = false;

// Varsayılan KAPALI (false): Mevcut veritabanı kayıtlarına ASLA dokunulmaz.
// Yalnızca açık geliştirici onayıyla true yapılırsa açılışta tek seferlik olarak,
// bu ayın toplam süresi ayın başından beri geçen gerçek süreyi aşan üyelerin toplamı
// geçen ay süresine kırpılır ve konsola yalnızca kimliksiz toplam yazılır.
const REPAIR_OVERSIZED_TOTALS_ON_START = false;

// Süre, gecikme ve kuyruk sabitleri
const TIMINGS = {
  CONFIRM_SEC: 15,                 // Etkinlik bu kadar kesintisiz sürmeden oyun oturumu onaylanmaz
  STOP_GRACE_SEC: 5,               // Etkinlik kesilince bu süre dolmadan oyun bırakıldı sayılmaz (Yanlış alarm olursa 10-15'e çıkarılabilir)
  COUNTDOWN_SEC: 10,               // Ses kanalına aktarmadan önce iptal edilebilir geri sayım süresi
  CHECKPOINT_SEC: 60,              // Süre biriktirme ve toplu veritabanı kayıt aralığı (saniye)
  MAX_DELTA_SEC: 120,              // Boşluk sınırı (CHECKPOINT_SEC x 2): tek checkpoint adımında eklenecek en fazla süre (saniye)
  PROFILE_COOLDOWN_SEC: 30,        // /aktivitem komutu kullanıcı başına bekleme süresi (saniye)
  MANUAL_BUTTON_COOLDOWN_SEC: 2,   // /oyun komutu butonlarında kullanıcı+aile başına bekleme süresi (saniye)
  MANUAL_MIDNIGHT_SAFETY_CHECK_MS: 60000, // Gece 00:00 temizliği için 60 saniyelik güvenlik ağı kontrol aralığı (ms)
  MANUAL_CLEANUP_MAX_RETRIES: 10,  // Gece temizliğinde geçici rol alma hatası için en fazla yeniden deneme sayısı
  ROLE_QUEUE_GAP_MS: 500,          // Rol ekleme/çıkarma kuyruğu işlem aralığı (ms)
  MOVE_QUEUE_GAP_MS: 1000,         // Ses taşıma kuyruğu işlem aralığı (ms)
  VOICE_DEBOUNCE_SEC: 3,           // Ses kanalı değişiminde aktarma değerlendirmesi öncesi bekleme (saniye)
  VOICE_JOIN_DELAY_MS: 3000,       // Geriye dönük uyumluluk için VOICE_DEBOUNCE_SEC (ms) karşılığı
  SWEEP_SEC: 30,                   // Sesteki üyeler ve onaylı oturumlar için yedek tarama aralığı (saniye)
  ROLE_CLEANUP_INTERVAL_MS: 300000, // 5 dakikada bir, sadece 4 aktiflik rolünün sahiplerinde pasif rol temizliği (ms)
  DECISION_TTL_MIN: 30,            // Bellekteki son aktarma/dönüş karar izinin saklanma süresi (dakika)
  BOT_MOVE_IGNORE_SEC: 5,          // Botun kendi taşımasının voiceStateUpdate'i tekrar tetiklememesi için süre (saniye)
  MEMBER_FETCH_COOLDOWN_SEC: 30,   // Aynı üye için guild.members.fetch çağrıları arası en az bekleme süresi (saniye)
  MEMBER_FETCH_STORM_WINDOW_MS: 60000, // Fırtına koruması pencere süresi (1 dakika)
  MEMBER_FETCH_STORM_MAX: 20,      // Fırtına durumunda 1 dakikada yapılabilecek en fazla üye fetch çağrısı
  MEMBER_FETCH_TIMEOUT_MS: 3500,   // Üye fetch çağrısının bot akışını bloke etmemesi için zaman aşımı (ms)
  MEMBER_FETCH_429_BACKOFF_MS: 30000, // 429 hız sınırında varsayılan geri çekilme süresi (ms)
  STARTUP_CLEANUP_DELAY_MS: 120000, // Açılıştan 2 dakika sonra tek seferlik aktiflik rolü temizliği (ms)
  MONTHLY_CHECK_INTERVAL_MS: 600000, // 10 dakikada bir ay dönümü kontrolü (ms)
  HOURLY_LOG_INTERVAL_MS: 3600000,  // Saatte bir konsola kimliksiz sayaç özeti yazma aralığı (ms)
};

// Aktarma ve oyun bitişi dönüş değerlendirme sebep kodları (tek merkezi sabit liste)
const TRANSFER_REASONS = Object.freeze({
  NO_PRESENCE_DATA: 'NO_PRESENCE_DATA',
  NOT_PLAYING: 'NOT_PLAYING',
  UNMATCHED_ACTIVITY: 'UNMATCHED_ACTIVITY',
  ACTIVITY_IGNORED: 'ACTIVITY_IGNORED',
  TRACKING_OFF: 'TRACKING_OFF',
  AUTOMOVE_OFF: 'AUTOMOVE_OFF',
  NOT_IN_VOICE: 'NOT_IN_VOICE',
  EXCLUDED_CHANNEL: 'EXCLUDED_CHANNEL',
  ALREADY_IN_TARGET: 'ALREADY_IN_TARGET',
  TOKEN_SPENT: 'TOKEN_SPENT',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  TARGET_FULL: 'TARGET_FULL',
  NO_MOVE_PERMISSION: 'NO_MOVE_PERMISSION',
  COMMAND_CHANNEL_UNAVAILABLE: 'COMMAND_CHANNEL_UNAVAILABLE',
  WAITING_CONFIRM: 'WAITING_CONFIRM',
  COUNTDOWN_PENDING: 'COUNTDOWN_PENDING',
  MOVED: 'MOVED',
  CANCELLED_BY_USER: 'CANCELLED_BY_USER',
  LEFT_VOICE_DURING_COUNTDOWN: 'LEFT_VOICE_DURING_COUNTDOWN',
  GAME_CHANGED_DURING_COUNTDOWN: 'GAME_CHANGED_DURING_COUNTDOWN',
  GAME_STOPPED: 'GAME_STOPPED',
  MOVE_FAILED: 'MOVE_FAILED',
  // Oyun bitişinde Salon 1'e dönüş sebep kodları
  RETURN_MOVED: 'RETURN_MOVED',
  RETURN_SKIPPED_NOT_IN_VOICE: 'RETURN_SKIPPED_NOT_IN_VOICE',
  RETURN_SKIPPED_NOT_GAME_CHANNEL: 'RETURN_SKIPPED_NOT_GAME_CHANNEL',
  RETURN_SKIPPED_OTHER_GAME_ACTIVE: 'RETURN_SKIPPED_OTHER_GAME_ACTIVE',
  RETURN_SKIPPED_OPTED_OUT: 'RETURN_SKIPPED_OPTED_OUT',
  RETURN_SKIPPED_NO_PRESENCE: 'RETURN_SKIPPED_NO_PRESENCE',
  RETURN_TARGET_NOT_FOUND: 'RETURN_TARGET_NOT_FOUND',
  RETURN_TARGET_FULL: 'RETURN_TARGET_FULL',
  RETURN_NO_PERMISSION: 'RETURN_NO_PERMISSION',
  RETURN_FAILED: 'RETURN_FAILED',
  // Ses-bazlı rol ve sesten düşme sonrası yeniden aktarma sebep kodları
  ROLE_WAITING_FOR_VOICE: 'ROLE_WAITING_FOR_VOICE',
  REARMED_AFTER_DISCONNECT: 'REARMED_AFTER_DISCONNECT',
  REARM_LIMIT_REACHED: 'REARM_LIMIT_REACHED',
  REARM_RATE_LIMITED: 'REARM_RATE_LIMITED',
});

// Hiçbir koşulda otomatik ses aktarımı yapılmayacak özel ses kanalları (ileride doldurulabilir)
// Not: Sunucunun AFK kanalı ve Stage (Sahne) kanalları otomatik olarak hariç tutulur.
const NO_MOVE_CHANNEL_IDS = [];

// =========================================================================
// 2. OYUN AİLELERİ VE AKTİFLİK ROLLERİ
// =========================================================================

const FAMILIES = {
  roblox: {
    id: 'roblox',
    label: 'Roblox',
    roleId: '1573688445392654396', // 🧱 Roblox Oyun Aktiflik Rolü
    emoji: '🧱',
    name: {
      tr: 'Roblox Oyun Aktiflik',
      en: 'Roblox Game Activity',
    },
  },
  zula: {
    id: 'zula',
    label: 'Zula',
    roleId: '1573688321580990617', // 🪖 Zula Oyun Aktiflik Rolü
    emoji: '🪖',
    name: {
      tr: 'Zula Oyun Aktiflik',
      en: 'Zula Game Activity',
    },
  },
  minecraft: {
    id: 'minecraft',
    label: 'Minecraft',
    roleId: '1573688479634821151', // ⛏️ Minecraft Oyun Aktiflik Rolü
    emoji: '⛏️',
    name: {
      tr: 'Minecraft Oyun Aktiflik',
      en: 'Minecraft Game Activity',
    },
  },
  cs2: {
    id: 'cs2',
    label: 'CS2',
    roleId: '1573688515902832781', // 🎯 CS2 Oyun Aktiflik Rolü
    emoji: '🎯',
    name: {
      tr: 'CS2 Oyun Aktiflik',
      en: 'CS2 Game Activity',
    },
  },
};

// =========================================================================
// 3. YOKSAYILACAK ETKİNLİK ADLARI (Playing türünde olup oyun olmayanlar)
// =========================================================================

const IGNORED_ACTIVITIES = [
  'Visual Studio Code',
  'Medal',
  'Overwolf',
  'Wallpaper Engine',
  'OBS Studio',
  'Streamlabs',
  'Discord',
  'Roblox Studio',
];

// =========================================================================
// 4. ROBLOX BİLİNMEYEN OYUN YEDEK KAYDI (OTHER GAMES)
// =========================================================================

// Üye "Roblox" oynuyor görünüyorsa ancak hangi Roblox oyunu olduğu eşleşmiyorsa kullanılır.
const ROBLOX_UNKNOWN = {
  id: 'roblox_unknown',
  name: 'Roblox',
  label: {
    tr: 'Roblox (oyun bilinmiyor)',
    en: 'Roblox (unknown game)',
  },
  emoji: '🧱',
  family: 'roblox',
  voiceChannelIds: ['1571913882707165216'], // OTHER GAMES ses kanalı
};

// =========================================================================
// 5. DESTEKLENEN OYUNLAR LİSTESİ (Yeni oyun eklemek = buraya kayıt eklemek)
// =========================================================================

const GAMES = [
  // ----- ROBLOX AİLESİ -----
  {
    // The Strongest Battlegrounds (TSB)
    id: 'tsb',
    family: 'roblox',
    name: 'The Strongest Battlegrounds',
    emoji: '🥷',
    placeId: '10449761463',
    voiceChannelIds: ['1571912346773885050'],
    matchers: [
      { field: 'any', op: 'contains', value: 'the strongest battlegrounds' },
      { field: 'any', op: 'contains', value: 'strongest battlegrounds' },
      { field: 'any', op: 'equals', value: 'tsb' },
    ],
  },
  {
    // Bonk & Block
    id: 'bonk',
    family: 'roblox',
    name: 'Bonk & Block',
    emoji: '🔫',
    placeId: '129253568870286',
    voiceChannelIds: ['1571912742116401266'],
    matchers: [
      { field: 'any', op: 'contains', value: 'bonk block' },
      { field: 'any', op: 'contains', value: 'bonk and block' },
      { field: 'any', op: 'contains', value: 'bonk' },
    ],
  },
  {
    // Apeirophobia
    id: 'apeirophobia',
    family: 'roblox',
    name: 'Apeirophobia',
    emoji: '🌀',
    placeId: '10277607801',
    voiceChannelIds: ['1571920790918664324'],
    matchers: [{ field: 'any', op: 'contains', value: 'apeirophobia' }],
  },
  {
    // SCP Roleplay (sadece 'scp' ile eşleştirilmez, tam ifade aranır)
    id: 'scp',
    family: 'roblox',
    name: 'SCP Roleplay',
    emoji: '🔬',
    placeId: '5041144419',
    voiceChannelIds: ['1572944084899733727'],
    matchers: [{ field: 'any', op: 'contains', value: 'scp roleplay' }],
  },
  {
    // Jailbreak
    id: 'jailbreak',
    family: 'roblox',
    name: 'Jailbreak',
    emoji: '🚓',
    placeId: '606849621',
    voiceChannelIds: ['1571913130684973177'],
    matchers: [
      { field: 'any', op: 'contains', value: 'jailbreak' },
      { field: 'any', op: 'contains', value: 'jail break' },
    ],
  },
  {
    // ER:LC (Emergency Response: Liberty County)
    id: 'erlc',
    family: 'roblox',
    name: 'ER:LC (Emergency Response: Liberty County)',
    emoji: '🚔',
    placeId: '2534724415',
    voiceChannelIds: ['1571913477302390834'],
    matchers: [
      { field: 'any', op: 'contains', value: 'emergency response liberty county' },
      { field: 'any', op: 'equals', value: 'er lc' },
      { field: 'any', op: 'equals', value: 'erlc' },
    ],
  },

  // ----- DİĞER OYUN AİLELERİ -----
  {
    // Zula
    id: 'zula',
    family: 'zula',
    name: 'Zula',
    emoji: '🪖',
    placeId: null,
    voiceChannelIds: ['1571914184860504074'],
    matchers: [{ field: 'any', op: 'contains', value: 'zula' }],
  },
  {
    // Minecraft (ve TLauncher üzerinden oynanan Minecraft oturumları)
    id: 'minecraft',
    family: 'minecraft',
    name: 'Minecraft',
    emoji: '⛏️',
    placeId: null,
    voiceChannelIds: ['1571914836248363169', '1571914899569778698'],
    matchers: [
      { field: 'any', op: 'contains', value: 'minecraft' },
      { field: 'any', op: 'contains', value: 'tlauncher' },
    ],
  },
  {
    // Counter-Strike 2 (CS2 / CSGO)
    id: 'cs2',
    family: 'cs2',
    name: 'CS2',
    emoji: '🎯',
    placeId: null,
    voiceChannelIds: ['1571915418728271973'],
    matchers: [
      { field: 'any', op: 'contains', value: 'counter strike' },
      { field: 'any', op: 'contains', value: 'cs2' },
      { field: 'any', op: 'contains', value: 'csgo' },
    ],
  },
];

// =========================================================================
// 6. YARDIMCI VE DOĞRULAMA FONKSİYONLARI
// =========================================================================

/**
 * Oyun ID'sine göre yapılandırma kaydını (ROBLOX_UNKNOWN dahil) döndürür.
 */
function getGameConfigById(gameId, cfg = exportedConfig) {
  if (!gameId) return null;
  const cleanId = String(gameId).trim();
  if (cleanId === 'roblox_unknown') {
    return cfg.ROBLOX_UNKNOWN;
  }
  return (cfg.GAMES || []).find((g) => g.id === cleanId) || null;
}

/**
 * Kullanıcıya gösterilecek oyun adını ve emojisini dile göre döndürür.
 */
function getGameDisplayInfo(gameId, lang = 'tr', cfg = exportedConfig) {
  const isEn = lang === 'en';
  if (gameId === 'roblox_unknown') {
    const unk = cfg.ROBLOX_UNKNOWN || ROBLOX_UNKNOWN;
    return {
      id: 'roblox_unknown',
      name: isEn ? unk.label?.en || 'Roblox (unknown game)' : unk.label?.tr || 'Roblox (oyun bilinmiyor)',
      shortName: unk.name || 'Roblox',
      emoji: unk.emoji || '🧱',
      family: unk.family || 'roblox',
    };
  }

  const game = getGameConfigById(gameId, cfg);
  if (!game) {
    return {
      id: String(gameId || 'unknown'),
      name: String(gameId || 'Bilinmeyen Oyun'),
      shortName: String(gameId || 'Bilinmeyen Oyun'),
      emoji: '🎮',
      family: null,
    };
  }

  return {
    id: game.id,
    name: game.name,
    shortName: game.name,
    emoji: game.emoji || '🎮',
    family: game.family,
  };
}

/**
 * Yönetilen tüm oyun ses kanallarının ID kümesini döndürür (GAMES[].voiceChannelIds + ROBLOX_UNKNOWN.voiceChannelIds).
 * Oyun bitişinde yalnızca bu kanallarda olan üyeler Salon 1'e geri aktarılır.
 */
function getManagedGameChannelIds(cfg = exportedConfig) {
  const ids = new Set();
  for (const game of cfg?.GAMES || []) {
    if (!game || !Array.isArray(game.voiceChannelIds)) continue;
    for (const chId of game.voiceChannelIds) {
      if (chId) ids.add(String(chId));
    }
  }
  if (cfg?.ROBLOX_UNKNOWN && Array.isArray(cfg.ROBLOX_UNKNOWN.voiceChannelIds)) {
    for (const chId of cfg.ROBLOX_UNKNOWN.voiceChannelIds) {
      if (chId) ids.add(String(chId));
    }
  }
  return ids;
}

/**
 * Yapılandırma dosyasının statik bütünlüğünü (eksik alan, tekrarlı ID, geçersiz aile/matcher) doğrular.
 */
function validateActivityConfigStructure(cfg = exportedConfig, { silent = false } = {}) {
  const errors = [];
  const warnings = [];
  const disabledGameIds = new Set();

  if (!cfg || typeof cfg !== 'object') {
    const msg = '[OYUN ETKİNLİĞİ AYAR HATASI] activity.config.js geçerli bir nesne değil.';
    errors.push(msg);
    if (!silent) console.error(msg);
    return { valid: false, errors, warnings, disabledGameIds };
  }

  const families = cfg.FAMILIES && typeof cfg.FAMILIES === 'object' ? cfg.FAMILIES : {};
  if (Object.keys(families).length === 0) {
    const msg = '[OYUN ETKİNLİĞİ AYAR HATASI] FAMILIES tanımı eksik veya boş.';
    errors.push(msg);
    if (!silent) console.error(msg);
  }

  if (!cfg.COMMAND_CHANNEL_ID || typeof cfg.COMMAND_CHANNEL_ID !== 'string') {
    const msg = '[OYUN ETKİNLİĞİ AYAR HATASI] COMMAND_CHANNEL_ID tanımlı değil.';
    errors.push(msg);
    if (!silent) console.error(msg);
  }

  if (cfg.RETURN_ENABLED !== false && (!cfg.RETURN_CHANNEL_ID || typeof cfg.RETURN_CHANNEL_ID !== 'string')) {
    const msg = '[OYUN ETKİNLİĞİ UYARISI] RETURN_CHANNEL_ID tanımlı değil; oyun bitişinde Salon 1\'e dönüş çalışmayacak.';
    warnings.push(msg);
    if (!silent) console.warn(msg);
  }

  if (!Array.isArray(cfg.GAMES)) {
    const msg = '[OYUN ETKİNLİĞİ AYAR HATASI] GAMES listesi dizi değil.';
    errors.push(msg);
    if (!silent) console.error(msg);
    return { valid: false, errors, warnings, disabledGameIds };
  }

  const seenIds = new Set();
  for (let i = 0; i < cfg.GAMES.length; i++) {
    const g = cfg.GAMES[i];
    if (!g || typeof g !== 'object') {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] GAMES[${i}] geçersiz kayıt; devre dışı bırakıldı.`;
      errors.push(msg);
      if (!silent) console.error(msg);
      continue;
    }

    const id = typeof g.id === 'string' ? g.id.trim() : '';
    if (!id) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] GAMES[${i}] için 'id' alanı eksik.`;
      errors.push(msg);
      if (!silent) console.error(msg);
      continue;
    }

    if (id === 'roblox_unknown') {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' ayrılmış bir ID'dir, GAMES içinde kullanılamaz; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }

    if (seenIds.has(id)) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] Tekrarlı oyun ID'si tespit edildi: '${id}'; ikinci kayıt devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }
    seenIds.add(id);

    if (!g.name || typeof g.name !== 'string') {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' oyunu için 'name' alanı eksik; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }

    if (!g.family || !families[g.family]) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' oyununun ailesi ('${g.family}') FAMILIES içinde yok; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }

    if (!Array.isArray(g.voiceChannelIds) || g.voiceChannelIds.length === 0) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' oyunu için 'voiceChannelIds' eksik veya boş; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }

    if (!Array.isArray(g.matchers) || g.matchers.length === 0) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' oyunu için 'matchers' eksik veya boş; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
      continue;
    }

    const badMatcher = g.matchers.some(
      (m) =>
        !m ||
        typeof m !== 'object' ||
        (m.op !== 'contains' && m.op !== 'equals') ||
        typeof m.value !== 'string' ||
        !m.value.trim()
    );
    if (badMatcher) {
      const msg = `[OYUN ETKİNLİĞİ AYAR HATASI] '${id}' oyununda geçersiz matcher tanımı var; devre dışı bırakıldı.`;
      errors.push(msg);
      disabledGameIds.add(id);
      if (!silent) console.error(msg);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    disabledGameIds,
  };
}

/**
 * Bir kanalın normal ses kanalı (Stage hariç) olup olmadığını kontrol eder.
 */
function isRegularVoiceChannel(channel) {
  if (!channel) return false;
  if (channel.type === ChannelType.GuildVoice) return true;
  if (channel.type === ChannelType.GuildStageVoice) return false;
  return false;
}

/**
 * Açılışta yapılandırmayı canlı sunucu (guild) rolleri, ses kanalları ve bot izinleriyle doğrular.
 * Eksik veya hatalı kayıtlar tek satır uyarıyla devre dışı bırakılır; bot asla çökmez.
 */
function validateActivityConfigWithGuild(guild, cfg = exportedConfig, { silent = false } = {}) {
  const base = validateActivityConfigStructure(cfg, { silent });
  const warnings = [...base.warnings];
  const disabledGameIds = new Set(base.disabledGameIds);
  const disabledFamilyIds = new Set();
  const validChannelIdsByGame = new Map();
  let commandChannelOk = true;
  let permissionsOk = true;
  let returnChannelStatus = {
    channelId: cfg?.RETURN_CHANNEL_ID || null,
    exists: false,
    isVoice: false,
    hasPermissions: false,
    userLimit: 0,
    memberCount: 0,
    isFull: false,
    ok: false,
  };

  const logWarn = (msg) => {
    warnings.push(msg);
    if (!silent) console.warn(msg);
  };

  if (!guild) {
    return {
      valid: base.valid,
      errors: base.errors,
      warnings,
      disabledGameIds,
      disabledFamilyIds,
      validChannelIdsByGame,
      commandChannelOk: false,
      permissionsOk: false,
      returnChannelOk: false,
      returnChannelStatus,
    };
  }

  const botMember = guild.members?.me || null;
  const botHighestPos = botMember?.roles?.highest?.position ?? null;

  // 1. Genel bot izinleri (Rolleri Yönet & Üyeleri Taşı)
  if (botMember?.permissions?.has) {
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      permissionsOk = false;
      logWarn('[OYUN ETKİNLİĞİ İZİN UYARISI] Botun "Rolleri Yönet" (ManageRoles) izni eksik; aktiflik rolleri verilemeyebilir.');
    }
    if (!botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
      permissionsOk = false;
      logWarn('[OYUN ETKİNLİĞİ İZİN UYARISI] Botun "Üyeleri Taşı" (MoveMembers) izni eksik; ses kanalı aktarımı çalışmayabilir.');
    }
  }

  // 2. Aile rolleri ve rol hiyerarşisi
  for (const [familyKey, family] of Object.entries(cfg.FAMILIES || {})) {
    const role = guild.roles?.cache?.get?.(family.roleId) || null;
    if (!role) {
      disabledFamilyIds.add(familyKey);
      logWarn(`[OYUN ETKİNLİĞİ UYARISI] '${familyKey}' aktiflik rolü (${family.roleId}) sunucuda bulunamadı; bu ailenin rol işlemi devre dışı.`);
      continue;
    }
    if (botHighestPos !== null && typeof role.position === 'number' && botHighestPos <= role.position) {
      permissionsOk = false;
      logWarn(`[OYUN ETKİNLİĞİ İZİN UYARISI] Botun rolü '${role.name}' (${role.id}) rolünün altında; rol hiyerarşisini yukarı taşıyın.`);
    }
  }

  // 3. Komut kanalı kontrolü
  const cmdChannel = guild.channels?.cache?.get?.(cfg.COMMAND_CHANNEL_ID) || null;
  if (!cmdChannel) {
    commandChannelOk = false;
    logWarn(`[OYUN ETKİNLİĞİ UYARISI] Komut kanalı (${cfg.COMMAND_CHANNEL_ID}) sunucuda bulunamadı; geri sayım mesajları ve duyurular gönderilemeyecek.`);
  } else if (botMember && typeof cmdChannel.permissionsFor === 'function') {
    const perms = cmdChannel.permissionsFor(botMember);
    if (perms && typeof perms.has === 'function') {
      const missing = [];
      if (!perms.has(PermissionFlagsBits.SendMessages)) missing.push('SendMessages');
      if (!perms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EmbedLinks');
      if (missing.length > 0) {
        permissionsOk = false;
        logWarn(`[OYUN ETKİNLİĞİ İZİN UYARISI] Komut kanalında (${cfg.COMMAND_CHANNEL_ID}) eksik bot izni: ${missing.join(', ')}.`);
      }
    }
  }

  // 4. Oyun ses kanalları kontrolü (GAMES + ROBLOX_UNKNOWN)
  const checkEntryChannels = (entryId, channelIds) => {
    const validIds = [];
    for (const chId of channelIds || []) {
      const ch = guild.channels?.cache?.get?.(chId) || null;
      if (!ch) {
        logWarn(`[OYUN ETKİNLİĞİ UYARISI] '${entryId}' için tanımlı kanal (${chId}) sunucuda bulunamadı.`);
        continue;
      }
      if (!isRegularVoiceChannel(ch)) {
        logWarn(`[OYUN ETKİNLİĞİ UYARISI] '${entryId}' için tanımlı kanal (${chId}) normal bir ses kanalı değil.`);
        continue;
      }
      if (botMember && typeof ch.permissionsFor === 'function') {
        const perms = ch.permissionsFor(botMember);
        if (perms && typeof perms.has === 'function') {
          if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
            permissionsOk = false;
            logWarn(`[OYUN ETKİNLİĞİ İZİN UYARISI] '${entryId}' ses kanalında (${chId}) ViewChannel veya Connect izni eksik.`);
          }
        }
      }
      validIds.push(chId);
    }
    validChannelIdsByGame.set(entryId, validIds);
    if (validIds.length === 0) {
      disabledGameIds.add(entryId);
      logWarn(`[OYUN ETKİNLİĞİ UYARISI] '${entryId}' için geçerli ses kanalı kalmadığından bu kayıt devre dışı bırakıldı.`);
    }
  };

  for (const game of cfg.GAMES || []) {
    if (!game || !game.id || disabledGameIds.has(game.id)) continue;
    checkEntryChannels(game.id, game.voiceChannelIds);
  }
  if (cfg.ROBLOX_UNKNOWN && Array.isArray(cfg.ROBLOX_UNKNOWN.voiceChannelIds)) {
    checkEntryChannels('roblox_unknown', cfg.ROBLOX_UNKNOWN.voiceChannelIds);
  }

  // 5. Oyun bitişi dönüş kanalı (Salon 1 - RETURN_CHANNEL_ID) doğrulaması
  const retId = cfg.RETURN_CHANNEL_ID ? String(cfg.RETURN_CHANNEL_ID) : null;
  if (!retId) {
    logWarn('[OYUN ETKİNLİĞİ UYARISI] Dönüş kanalı (RETURN_CHANNEL_ID / Salon 1) tanımlı değil.');
  } else {
    const retCh = guild.channels?.cache?.get?.(retId) || null;
    if (!retCh) {
      logWarn(`[OYUN ETKİNLİĞİ UYARISI] Dönüş kanalı Salon 1 (${retId}) sunucuda bulunamadı; oyun bitince geri taşıma çalışmayacak.`);
    } else if (!isRegularVoiceChannel(retCh)) {
      returnChannelStatus.exists = true;
      logWarn(`[OYUN ETKİNLİĞİ UYARISI] Dönüş kanalı Salon 1 (${retId}) normal bir ses kanalı değil; oyun bitince geri taşıma çalışmayacak.`);
    } else {
      returnChannelStatus.exists = true;
      returnChannelStatus.isVoice = true;
      returnChannelStatus.userLimit = Number(retCh.userLimit) || 0;
      returnChannelStatus.memberCount = retCh.members?.size ?? 0;
      returnChannelStatus.isFull =
        returnChannelStatus.userLimit > 0 && returnChannelStatus.memberCount >= returnChannelStatus.userLimit;

      let retPermOk = true;
      if (botMember && typeof retCh.permissionsFor === 'function') {
        const perms = retCh.permissionsFor(botMember);
        if (perms && typeof perms.has === 'function') {
          if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
            retPermOk = false;
            permissionsOk = false;
            logWarn(`[OYUN ETKİNLİĞİ İZİN UYARISI] Dönüş kanalı Salon 1 (${retId}) için ViewChannel veya Connect izni eksik.`);
          }
        }
      }
      returnChannelStatus.hasPermissions = retPermOk;
      if (returnChannelStatus.isFull) {
        logWarn(
          `[OYUN ETKİNLİĞİ UYARISI] Dönüş kanalı Salon 1 (${retId}) kullanıcı sınırına (${returnChannelStatus.memberCount}/${returnChannelStatus.userLimit}) ulaşmış durumda.`
        );
      }
      returnChannelStatus.ok = returnChannelStatus.exists && returnChannelStatus.isVoice && returnChannelStatus.hasPermissions;
    }
  }

  return {
    valid: base.valid && warnings.length === 0,
    errors: base.errors,
    warnings,
    disabledGameIds,
    disabledFamilyIds,
    validChannelIdsByGame,
    commandChannelOk,
    permissionsOk,
    returnChannelOk: returnChannelStatus.ok,
    returnChannelStatus,
  };
}

/**
 * Belirtilen IANA saat dilimine göre takvim gününü 'YYYY-MM-DD' biçiminde döndürür.
 * Sabit +3 ofseti varsaymaz; tamamen Intl.DateTimeFormat kullanır.
 */
function getDateStringInTimeZone(date = new Date(), timeZone = MANUAL_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value || String(d.getUTCFullYear());
  const m = parts.find((p) => p.type === 'month')?.value || String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = parts.find((p) => p.type === 'day')?.value || String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Belirtilen saat dilimindeki bir zaman damgasının yerel tarih/saat parçalarını döndürür.
 */
function getZonedDateParts(ms, timeZone = MANUAL_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const getNum = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return {
    year: getNum('year'),
    month: getNum('month'),
    day: getNum('day'),
    hour: getNum('hour'),
    minute: getNum('minute'),
    second: getNum('second'),
  };
}

/**
 * Belirtilen IANA saat diliminde bir sonraki 00:00:00 anının UTC milisaniye zaman damgasını hesaplar.
 * Sabit UTC ofseti varsaymaz; Intl.DateTimeFormat üzerinden gerçek saat dilimi farkını çözer.
 */
function getNextMidnightMsInTimeZone(nowMs = Date.now(), timeZone = MANUAL_TIMEZONE) {
  const cur = getZonedDateParts(nowMs, timeZone);
  const targetLocalAsUtc = Date.UTC(cur.year, cur.month - 1, cur.day + 1, 0, 0, 0, 0);

  let guess = targetLocalAsUtc;
  for (let i = 0; i < 3; i++) {
    const p = getZonedDateParts(guess, timeZone);
    const actualAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetLocalAsUtc - actualAsUtc;
    if (diff === 0) break;
    guess += diff;
  }

  if (guess <= nowMs) {
    guess += 24 * 60 * 60 * 1000;
  }
  return guess;
}

/**
 * Belirtilen IANA saat diliminde (varsayılan Europe/Istanbul) ilgili ayın 1'i 00:00:00 anının
 * UTC milisaniye zaman damgasını döndürür. Sabit +3 varsaymaz; Intl.DateTimeFormat ile çözer.
 */
function getIstanbulMonthStartMs(monthStr = null, nowMs = Date.now(), timeZone = TIMEZONE) {
  let year;
  let month;
  if (typeof monthStr === 'string' && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [yStr, mStr] = monthStr.split('-');
    year = Number(yStr);
    month = Number(mStr);
  } else {
    const cur = getZonedDateParts(nowMs, timeZone);
    year = cur.year;
    month = cur.month;
  }

  const targetLocalAsUtc = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  let guess = targetLocalAsUtc;
  for (let i = 0; i < 3; i++) {
    const p = getZonedDateParts(guess, timeZone);
    const actualAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetLocalAsUtc - actualAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/**
 * Geçerli Europe/Istanbul ayının başından şimdiye kadar geçen gerçek süreyi (saniye) döndürür.
 * B3 değişmez kuralı (bir üyenin aylık süresi ay başından beri geçen süreyi aşamaz) için kullanılır.
 */
function getElapsedSecondsInCurrentIstanbulMonth(nowMs = Date.now(), monthStr = null, timeZone = TIMEZONE) {
  const cleanNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const startMs = getIstanbulMonthStartMs(monthStr, cleanNow, timeZone);
  return Math.max(0, Math.floor((cleanNow - startMs) / 1000));
}

/**
 * Tek merkezi süre biçimleyici (bot ve site ile birebir tutarlı).
 * - NaN / Infinity / negatif değerler asla NaN veya Infinity üretmez, 0 kabul edilir.
 * - 0 sn -> "0 dk" / "0 min"
 * - 0 < sn < 60 (1 dakikanın altındaki pozitif süreler) -> "1 dk'dan az" / "<1 min"
 * - 60 dk -> "1 sa" / "1 hr"
 * - 119.6 dk (7176 sn) -> "1 sa 59 dk" / "1 hr 59 min" (asla "1 sa 60 dk" veya ondalık olmaz)
 * - 41 sa 47 dk -> "41 sa 47 dk" / "41 hr 47 min"
 */
function formatDuration(seconds, lang = 'tr') {
  const isEn = lang === 'en';
  const raw = Number(seconds);
  if (!Number.isFinite(raw) || raw <= 0) {
    return isEn ? '0 min' : '0 dk';
  }
  if (raw < 60) {
    return isEn ? '<1 min' : "1 dk'dan az";
  }

  const totalSec = Math.floor(raw);
  const totalMinutes = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return isEn ? `${minutes} min` : `${minutes} dk`;
  }
  if (minutes === 0) {
    return isEn ? `${hours} hr` : `${hours} sa`;
  }
  return isEn ? `${hours} hr ${minutes} min` : `${hours} sa ${minutes} dk`;
}

/**
 * Bir oyun anahtarını (gameId veya 'roblox_unknown') activity.config.js içindeki
 * FAMILIES ve GAMES tanımlarından türeterek oyun ailesine eşler.
 * Eşlenemeyen anahtarlar için null döner (asla çökmez).
 */
function familyOfGame(gameKey, cfg = exportedConfig) {
  if (!gameKey || typeof gameKey !== 'string') return null;
  const cleanKey = gameKey.trim();
  if (!cleanKey) return null;

  const families = cfg?.FAMILIES && typeof cfg.FAMILIES === 'object' ? cfg.FAMILIES : {};
  if (cleanKey === 'roblox_unknown') {
    const unkFam = cfg?.ROBLOX_UNKNOWN?.family || 'roblox';
    return families[unkFam] ? unkFam : null;
  }

  if (Object.prototype.hasOwnProperty.call(families, cleanKey)) {
    return cleanKey;
  }

  const found = (cfg?.GAMES || []).find((g) => g && g.id === cleanKey);
  if (found && found.family && Object.prototype.hasOwnProperty.call(families, found.family)) {
    return found.family;
  }

  return null;
}

/**
 * Aile anahtarının gösterim bilgilerini (etiket ve emoji) yalnızca activity.config.js FAMILIES tanımından okur.
 */
function getFamilyDisplayInfo(familyKey, cfg = exportedConfig) {
  const cleanKey = String(familyKey || '').trim();
  const fam = cfg?.FAMILIES?.[cleanKey] || null;
  if (!fam) {
    return {
      key: cleanKey || 'unknown',
      label: cleanKey || 'Unknown',
      emoji: '🎮',
      known: false,
    };
  }
  return {
    key: fam.id || cleanKey,
    label: fam.label || fam.id || cleanKey,
    emoji: fam.emoji || '🎮',
    known: true,
  };
}

/**
 * Tek merkezi okuma-zamanı aile gruplama yardımcısı (activityStats saklama biçimini DEĞİŞTİRMEZ).
 * - Roblox ailesindeki tüm anahtarları (roblox_unknown + GAMES içindeki family:'roblox' kayıtları)
 *   tek bir "Roblox" satırında toplar ("Roblox (diğer)" artık üretilmez).
 * - Minecraft, CS2 ve Zula kendi aile satırlarında kalır; ad/emoji activity.config.js'ten okunur.
 * - Aynı üye bir ailede birden fazla alt oyun oynasa da uniquePlayers içinde YALNIZCA BİR KEZ sayılır.
 * - Eşlenemeyen anahtarlar çökme yaratmaz, unmappedKeys listesinde (kimliksiz) raporlanır.
 * - SHOW_FAMILY_BREAKDOWN true ise çok oyunlu ailelerde en çok 5 alt oyun + "+N diğer" kırılımı üretilir.
 *
 * @param {Map<string, object>|object} statsInput - Map<uid, {gameId:sec}> | { users: { uid: { games } } } | { gameId: sec }
 * @param {object} [options]
 */
function groupStatsByFamily(
  statsInput,
  {
    cfg = exportedConfig,
    lang = 'tr',
    showBreakdown = null,
    limit = null,
    extraGameTotals = null,
  } = {}
) {
  const isEn = lang === 'en';
  const effectiveShowBreakdown =
    showBreakdown !== null && showBreakdown !== undefined
      ? Boolean(showBreakdown)
      : Boolean(cfg?.SHOW_FAMILY_BREAKDOWN === true);

  const buckets = new Map();
  const robloxKeysFound = new Set();
  const unmappedKeys = new Set();

  const ensureBucket = (bucketKey, mappedFamily) => {
    let b = buckets.get(bucketKey);
    if (!b) {
      if (mappedFamily) {
        const disp = getFamilyDisplayInfo(mappedFamily, cfg);
        b = {
          key: disp.key,
          label: disp.label,
          emoji: disp.emoji,
          family: disp.key,
          unmapped: false,
          totalSeconds: 0,
          players: new Set(),
          subGames: new Map(),
        };
      } else {
        b = {
          key: bucketKey,
          label: bucketKey,
          emoji: '🎮',
          family: null,
          unmapped: true,
          totalSeconds: 0,
          players: new Set(),
          subGames: new Map(),
        };
      }
      buckets.set(bucketKey, b);
    }
    return b;
  };

  const addRecord = (gameId, rawSec, uid = null) => {
    const sec = Math.floor(Number(rawSec));
    if (!gameId || !Number.isFinite(sec) || sec <= 0) return;
    const cleanGid = String(gameId).trim();
    if (!cleanGid) return;

    const famKey = familyOfGame(cleanGid, cfg);
    if (famKey) {
      if (famKey === 'roblox') {
        robloxKeysFound.add(cleanGid);
      }
      const bucket = ensureBucket(famKey, famKey);
      bucket.totalSeconds += sec;
      if (uid) bucket.players.add(String(uid));
      bucket.subGames.set(cleanGid, (bucket.subGames.get(cleanGid) || 0) + sec);
    } else {
      unmappedKeys.add(cleanGid);
      const bucket = ensureBucket(cleanGid, null);
      bucket.totalSeconds += sec;
      if (uid) bucket.players.add(String(uid));
      bucket.subGames.set(cleanGid, (bucket.subGames.get(cleanGid) || 0) + sec);
    }
  };

  // Girdi biçimini çöz: Map<uid, games> | { users: { uid: { games } } } | tek kullanıcı { gameId: sec }
  if (statsInput instanceof Map) {
    for (const [uid, entry] of statsInput.entries()) {
      const gameObj = entry && typeof entry === 'object' && entry.games && typeof entry.games === 'object'
        ? entry.games
        : entry;
      if (!gameObj || typeof gameObj !== 'object') continue;
      for (const [gid, sec] of Object.entries(gameObj)) {
        addRecord(gid, sec, uid);
      }
    }
  } else if (statsInput && typeof statsInput === 'object') {
    if (statsInput.users && typeof statsInput.users === 'object' && !Array.isArray(statsInput.users)) {
      for (const [uid, userObj] of Object.entries(statsInput.users)) {
        const gameObj = userObj?.games && typeof userObj.games === 'object' ? userObj.games : null;
        if (!gameObj) continue;
        for (const [gid, sec] of Object.entries(gameObj)) {
          addRecord(gid, sec, uid);
        }
      }
    } else {
      for (const [gid, sec] of Object.entries(statsInput)) {
        addRecord(gid, sec, '__self__');
      }
    }
  }

  // Tüm zamanlar (activityAllTime.games) gibi kullanıcı kimliği içermeyen ek toplamları birleştir
  if (extraGameTotals && typeof extraGameTotals === 'object') {
    for (const [gid, sec] of Object.entries(extraGameTotals)) {
      addRecord(gid, sec, null);
    }
  }

  const allSorted = Array.from(buckets.values())
    .filter((b) => b.totalSeconds > 0)
    .sort(
      (a, b) =>
        b.totalSeconds - a.totalSeconds ||
        b.players.size - a.players.size ||
        a.key.localeCompare(b.key)
    );

  const grandTotalSeconds = allSorted.reduce((sum, b) => sum + b.totalSeconds, 0);
  const maxItems =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : allSorted.length;

  const families = allSorted.slice(0, maxItems).map((b, idx) => {
    const ratio = grandTotalSeconds > 0 ? b.totalSeconds / grandTotalSeconds : 0;
    const percent = grandTotalSeconds > 0 ? Math.round(ratio * 100) : 0;
    const hours = Number((b.totalSeconds / 3600).toFixed(1));
    const item = {
      key: b.key,
      label: b.label,
      emoji: b.emoji,
      family: b.family,
      totalSeconds: b.totalSeconds,
      uniquePlayers: b.players.size,
      rank: idx + 1,
      ratio,
      percent,
      hours,
      formattedDuration: formatDuration(b.totalSeconds, isEn ? 'en' : 'tr'),
      ...(b.unmapped ? { unmapped: true } : {}),
    };

    if (effectiveShowBreakdown && !b.unmapped && b.subGames.size > 0) {
      const hasNonSelfSub = Array.from(b.subGames.keys()).some((k) => k !== b.key);
      if (hasNonSelfSub) {
        const subSorted = Array.from(b.subGames.entries())
          .filter(([, sec]) => sec > 0)
          .sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]));

        const topSubs = subSorted.slice(0, 5).map(([subId, subSec]) => {
          let subName;
          if (subId === 'roblox_unknown') {
            subName = isEn ? 'Other' : 'Diğer';
          } else {
            const gameCfg = getGameConfigById(subId, cfg);
            subName = gameCfg?.name || subId;
          }
          return {
            id: subId,
            name: subName,
            seconds: subSec,
            formattedDuration: formatDuration(subSec, isEn ? 'en' : 'tr'),
          };
        });
        const overflowCount = Math.max(0, subSorted.length - 5);
        const lineParts = topSubs.map((s) => `${s.name} ${s.formattedDuration}`);
        if (overflowCount > 0) {
          lineParts.push(isEn ? `+${overflowCount} more` : `+${overflowCount} diğer`);
        }
        item.breakdown = {
          items: topSubs,
          overflowCount,
          formattedLine: isEn
            ? `includes: ${lineParts.join(', ')}`
            : `içinde: ${lineParts.join(', ')}`,
        };
      }
    }

    return item;
  });

  return {
    families,
    totalSeconds: grandTotalSeconds,
    robloxKeysFound: Array.from(robloxKeysFound).sort(),
    unmappedKeys: Array.from(unmappedKeys).sort(),
  };
}

const exportedConfig = {
  COMMAND_CHANNEL_ID,
  RETURN_CHANNEL_ID,
  RETURN_ONLY_FROM_GAME_CHANNELS,
  RETURN_ENABLED,
  ROLE_REQUIRES_VOICE,
  ROLE_REMOVE_ON_VOICE_LEAVE,
  REARM_AFTER_DISCONNECT,
  REARM_MAX_PER_SESSION,
  REARM_MIN_GAP_SEC,
  TIMEZONE,
  MANUAL_TIMEZONE,
  MANUAL_CLEAR_ALL_ACTIVITY_ROLES,
  MIN_ACTIVE_MINUTES,
  ACTIVE_METRIC_DEFINITIONS,
  SAYIM_MEMBER_LOOKUP_CAP,
  SAYIM_MEMBER_CACHE_TTL_MS,
  SAYIM_MEMBER_USER_COOLDOWN_MS,
  STATS_CACHE_TTL_MS,
  SHOW_FAMILY_BREAKDOWN,
  REPAIR_OVERSIZED_TOTALS_ON_START,
  TIMINGS,
  TRANSFER_REASONS,
  NO_MOVE_CHANNEL_IDS,
  FAMILIES,
  IGNORED_ACTIVITIES,
  ROBLOX_UNKNOWN,
  GAMES,
  getGameConfigById,
  getGameDisplayInfo,
  getManagedGameChannelIds,
  getDateStringInTimeZone,
  getNextMidnightMsInTimeZone,
  getIstanbulMonthStartMs,
  getElapsedSecondsInCurrentIstanbulMonth,
  formatDuration,
  familyOfGame,
  getFamilyDisplayInfo,
  groupStatsByFamily,
  validateActivityConfigStructure,
  validateActivityConfigWithGuild,
  isRegularVoiceChannel,
};

module.exports = exportedConfig;
