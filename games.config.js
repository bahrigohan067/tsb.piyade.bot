/**
 * Piyade Topluluk Botu - Çoklu Oyun Yapılandırması (TEK KAYNAK)
 * Yeni oyun eklemek = bu dosyadaki GAMES dizisine yeni bir kayıt eklemek.
 * Not: Discord Modal penceresi en fazla 5 alan destekler (1 Ad + en çok 4 Oyun).
 * 4'ten fazla aktif oyun eklenirse açılışta uyarı loglanır.
 */

/**
 * Ortam değişkeni tanımlıysa rol ID'sini oradan okur, yoksa varsayılanı döner.
 */
function resolveEnvRoleId(envKey, defaultRoleId) {
  if (Object.prototype.hasOwnProperty.call(process.env, envKey)) {
    const cleaned = String(process.env[envKey] || '').trim();
    return cleaned || null;
  }
  return defaultRoleId;
}

const GAMES = [
  {
    id: 'roblox',
    emoji: '🧱',
    name: {
      tr: 'Roblox',
      en: 'Roblox',
    },
    buttonLabel: {
      tr: 'Roblox',
      en: 'Roblox',
    },
    usernameLabel: {
      tr: 'Roblox kullanıcı adın nedir?',
      en: 'What is your Roblox username?',
    },
    usernamePlaceholder: {
      tr: '@kullaniciadi (görünen ad değil)',
      en: '@username (not display name)',
    },
    validate: {
      min: 3,
      max: 100,
    },
    roleId: resolveEnvRoleId('GAME_ROLE_ROBLOX', '1571915640976056390'),
    verifier: 'roblox',
    enabled: true,
  },
  {
    id: 'cs2',
    emoji: '🔫',
    name: {
      tr: 'CS2 (Counter Strike 2)',
      en: 'CS2 (Counter Strike 2)',
    },
    buttonLabel: {
      tr: 'CS2',
      en: 'CS2',
    },
    usernameLabel: {
      tr: 'CS2 kullanıcı adın nedir?',
      en: 'What is your CS2 username?',
    },
    usernamePlaceholder: {
      tr: 'CS2 / Steam kullanıcı adın (Örn: s1mple)',
      en: 'Your CS2 / Steam username (e.g. s1mple)',
    },
    validate: {
      min: 2,
      max: 32,
    },
    roleId: resolveEnvRoleId('GAME_ROLE_CS2', '1571915951946076323'),
    verifier: null,
    enabled: true,
  },
  {
    id: 'zula',
    emoji: '🪖',
    name: {
      tr: 'Zula',
      en: 'Zula',
    },
    buttonLabel: {
      tr: 'Zula',
      en: 'Zula',
    },
    usernameLabel: {
      tr: 'Zula kullanıcı adın nedir?',
      en: 'What is your Zula username?',
    },
    usernamePlaceholder: {
      tr: 'Zula oyun içi kullanıcı adın',
      en: 'Your in-game Zula username',
    },
    validate: {
      min: 2,
      max: 32,
    },
    roleId: resolveEnvRoleId('GAME_ROLE_ZULA', '1571915745884115005'),
    verifier: null,
    enabled: true,
  },
  {
    id: 'minecraft',
    emoji: '⛏️',
    name: {
      tr: 'Minecraft',
      en: 'Minecraft',
    },
    buttonLabel: {
      tr: 'Minecraft',
      en: 'Minecraft',
    },
    usernameLabel: {
      tr: 'Minecraft kullanıcı adın nedir?',
      en: 'What is your Minecraft username?',
    },
    usernamePlaceholder: {
      tr: '3-16 karakter, sadece harf, rakam ve _',
      en: '3-16 chars, letters, numbers, and _ only',
    },
    validate: {
      min: 3,
      max: 16,
      regex: /^[A-Za-z0-9_]{3,16}$/,
    },
    roleId: resolveEnvRoleId('GAME_ROLE_MINECRAFT', '1571915841832886382'),
    verifier: null,
    enabled: true,
  },
];

const MAX_SUPPORTED_GAMES = 4;

/**
 * Etkin (enabled) oyunların listesini GAMES dizisindeki sırasıyla döndürür.
 * Not: Modal sınırı nedeniyle aktif kayıt akışı ilk 4 etkin oyunu destekler.
 */
function getEnabledGames() {
  return GAMES.filter((g) => g.enabled !== false).slice(0, MAX_SUPPORTED_GAMES);
}

/**
 * Tüm etkin oyunları (4 sınırı olmadan, doğrulama uyarısı için) döndürür.
 */
function getAllEnabledGames() {
  return GAMES.filter((g) => g.enabled !== false);
}

/**
 * ID'ye göre oyun yapılandırmasını döndürür.
 */
function getGameById(id) {
  const clean = String(id || '').trim().toLowerCase();
  return GAMES.find((g) => g.id === clean) || null;
}

/**
 * Oyunun bitmask değerini döndürür (GAMES sırasına göre: 1, 2, 4, 8).
 */
function getGameBit(gameOrId) {
  const id = typeof gameOrId === 'string' ? gameOrId : gameOrId?.id;
  const enabled = getEnabledGames();
  const idx = enabled.findIndex((g) => g.id === String(id || '').toLowerCase());
  return idx >= 0 ? (1 << idx) : 0;
}

/**
 * Geçerli en büyük mask değerini döndürür (örn. 4 oyun için 15).
 */
function getMaxValidMask() {
  const count = getEnabledGames().length;
  return count > 0 ? (1 << count) - 1 : 0;
}

/**
 * Verilen ham mask değerini doğrular ve sayıya çevirir.
 * Geçersizse null döndürür.
 */
function parseMask(rawMask, { allowZero = false } = {}) {
  if (rawMask === undefined || rawMask === null) return null;
  const str = String(rawMask).trim();
  if (!/^\d+$/.test(str)) return null;

  const mask = Number(str);
  const maxMask = getMaxValidMask();
  if (!Number.isInteger(mask) || mask < (allowZero ? 0 : 1) || mask > maxMask) {
    return null;
  }
  if ((mask & ~maxMask) !== 0) {
    return null;
  }
  return mask;
}

/**
 * Mask içindeki bitlere karşılık gelen oyunları yapılandırma sırasıyla döndürür.
 */
function getGamesFromMask(rawMask) {
  const mask = typeof rawMask === 'number' ? rawMask : parseMask(rawMask, { allowZero: true });
  if (mask === null) return [];

  const enabled = getEnabledGames();
  return enabled.filter((_, idx) => (mask & (1 << idx)) !== 0);
}

/**
 * Verilen oyun ID listesini bitmask sayısına çevirir.
 */
function getMaskFromGames(gameIds) {
  if (!Array.isArray(gameIds)) return 0;
  let mask = 0;
  for (const rawId of gameIds) {
    const bit = getGameBit(rawId);
    if (bit > 0) mask |= bit;
  }
  return mask;
}

/**
 * Oyunun kısa veya tam adını dil tercihine göre döndürür.
 */
function getGameLabel(gameOrId, lang = 'tr', { useFullName = false } = {}) {
  const game = typeof gameOrId === 'string' ? getGameById(gameOrId) : gameOrId;
  if (!game) return String(gameOrId || '');
  const l = lang === 'en' ? 'en' : 'tr';
  if (useFullName) {
    return game.name?.[l] || game.buttonLabel?.[l] || game.id;
  }
  return game.buttonLabel?.[l] || game.name?.[l] || game.id;
}

/**
 * Mask'a göre seçili oyunların emojili özet metnini üretir (Örn: "🧱 Roblox, 🔫 CS2").
 */
function formatGamesFromMask(mask, lang = 'tr') {
  const games = getGamesFromMask(mask);
  if (games.length === 0) return '';
  return games.map((g) => `${g.emoji} ${getGameLabel(g, lang)}`).join(', ');
}

/**
 * Açılışta oyun yapılandırmasını denetler.
 * 4'ten fazla etkin oyun varsa (Discord Modal max 5 alan = 1 Ad + 4 Oyun) net uyarı loglar.
 */
function validateGamesConfig() {
  const warnings = [];
  const allEnabled = getAllEnabledGames();

  if (allEnabled.length > MAX_SUPPORTED_GAMES) {
    const msg =
      `[OYUN YAPILANDIRMASI UYARISI] ${allEnabled.length} aktif oyun tanımlı! ` +
      `Discord Modal en fazla 5 alan (1 Ad + ${MAX_SUPPORTED_GAMES} Oyun) desteklediği için şimdilik yalnızca ilk ${MAX_SUPPORTED_GAMES} oyun aktif edilir. ` +
      `Daha fazla oyun için iki adımlı form gerekir.`;
    warnings.push(msg);
    console.warn(msg);
  }

  for (const game of allEnabled.slice(0, MAX_SUPPORTED_GAMES)) {
    if (!game.roleId) {
      const msg = `[OYUN YAPILANDIRMASI UYARISI] '${game.id}' oyunu için roleId tanımlı değil.`;
      warnings.push(msg);
      console.warn(msg);
    }
    for (const l of ['tr', 'en']) {
      if ((game.usernameLabel?.[l] || '').length > 45) {
        const msg = `[OYUN YAPILANDIRMASI UYARISI] '${game.id}' (${l}) usernameLabel 45 karakteri aşıyor.`;
        warnings.push(msg);
        console.warn(msg);
      }
      if ((game.usernamePlaceholder?.[l] || '').length > 100) {
        const msg = `[OYUN YAPILANDIRMASI UYARISI] '${game.id}' (${l}) usernamePlaceholder 100 karakteri aşıyor.`;
        warnings.push(msg);
        console.warn(msg);
      }
      if ((game.buttonLabel?.[l] || '').length > 75) {
        const msg = `[OYUN YAPILANDIRMASI UYARISI] '${game.id}' (${l}) buttonLabel 75 karakteri aşıyor.`;
        warnings.push(msg);
        console.warn(msg);
      }
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    activeCount: Math.min(allEnabled.length, MAX_SUPPORTED_GAMES),
    totalEnabled: allEnabled.length,
  };
}

module.exports = {
  GAMES,
  MAX_SUPPORTED_GAMES,
  getEnabledGames,
  getAllEnabledGames,
  getGameById,
  getGameBit,
  getMaxValidMask,
  parseMask,
  getGamesFromMask,
  getMaskFromGames,
  getGameLabel,
  formatGamesFromMask,
  validateGamesConfig,
};
