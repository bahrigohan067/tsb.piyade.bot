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

// Aylık sıfırlama ve tarih hesaplamalarında kullanılan saat dilimi
const TIMEZONE = 'Europe/Istanbul';

// Süre, gecikme ve kuyruk sabitleri
const TIMINGS = {
  CONFIRM_SEC: 15,                 // Etkinlik bu kadar kesintisiz sürmeden oyun oturumu onaylanmaz
  STOP_GRACE_SEC: 60,              // Etkinlik kesilince bu süre dolmadan oyun bırakıldı sayılmaz
  COUNTDOWN_SEC: 10,               // Ses kanalına aktarmadan önce iptal edilebilir geri sayım süresi
  CHECKPOINT_SEC: 60,              // Süre biriktirme ve toplu veritabanı kayıt aralığı (saniye)
  PROFILE_COOLDOWN_SEC: 30,        // /aktivitem komutu kullanıcı başına bekleme süresi (saniye)
  ROLE_QUEUE_GAP_MS: 500,          // Rol ekleme/çıkarma kuyruğu işlem aralığı (ms)
  MOVE_QUEUE_GAP_MS: 1000,         // Ses taşıma kuyruğu işlem aralığı (ms)
  VOICE_DEBOUNCE_SEC: 3,           // Ses kanalı değişiminde aktarma değerlendirmesi öncesi bekleme (saniye)
  VOICE_JOIN_DELAY_MS: 3000,       // Geriye dönük uyumluluk için VOICE_DEBOUNCE_SEC (ms) karşılığı
  SWEEP_SEC: 30,                   // Sesteki üyeler için yedek aktarma taraması aralığı (saniye)
  DECISION_TTL_MIN: 30,            // Bellekteki son aktarma karar izinin saklanma süresi (dakika)
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

// Aktarma değerlendirme sebep kodları (tek merkezi sabit liste)
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
    roleId: '1573688445392654396', // 🧱 Roblox Oyun Aktiflik Rolü
    emoji: '🧱',
    name: {
      tr: 'Roblox Oyun Aktiflik',
      en: 'Roblox Game Activity',
    },
  },
  zula: {
    id: 'zula',
    roleId: '1573688321580990617', // 🪖 Zula Oyun Aktiflik Rolü
    emoji: '🪖',
    name: {
      tr: 'Zula Oyun Aktiflik',
      en: 'Zula Game Activity',
    },
  },
  minecraft: {
    id: 'minecraft',
    roleId: '1573688479634821151', // ⛏️ Minecraft Oyun Aktiflik Rolü
    emoji: '⛏️',
    name: {
      tr: 'Minecraft Oyun Aktiflik',
      en: 'Minecraft Game Activity',
    },
  },
  cs2: {
    id: 'cs2',
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

  return {
    valid: base.valid && warnings.length === 0,
    errors: base.errors,
    warnings,
    disabledGameIds,
    disabledFamilyIds,
    validChannelIdsByGame,
    commandChannelOk,
    permissionsOk,
  };
}

const exportedConfig = {
  COMMAND_CHANNEL_ID,
  TIMEZONE,
  TIMINGS,
  TRANSFER_REASONS,
  NO_MOVE_CHANNEL_IDS,
  FAMILIES,
  IGNORED_ACTIVITIES,
  ROBLOX_UNKNOWN,
  GAMES,
  getGameConfigById,
  getGameDisplayInfo,
  validateActivityConfigStructure,
  validateActivityConfigWithGuild,
  isRegularVoiceChannel,
};

module.exports = exportedConfig;
