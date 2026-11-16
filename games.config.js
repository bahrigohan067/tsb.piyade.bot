/**
 * Piyade Topluluk Botu - Oyun Yapılandırması ve Kayıt Durum Yardımcıları
 * Sunucuda desteklenen oyunlar, rol ID'leri, anket soruları ve kısa kodlar.
 */

const GAMES = [
  {
    id: 'roblox',
    code: 'r',
    name: {
      tr: 'Roblox',
      en: 'Roblox',
    },
    short: {
      tr: 'Roblox',
      en: 'Roblox',
    },
    fullName: 'Roblox',
    emoji: '🎮',
    enabled: true,
    roleId: process.env.GAME_ROLE_ROBLOX || '1571915640976056390',
    questionLabel: {
      tr: 'Roblox kullanıcı adın nedir?',
      en: 'What is your Roblox username?',
    },
    placeholder: {
      tr: 'Örn: Builderman, ID veya profil linki (Görünen ad değil!)',
      en: 'e.g. Builderman, User ID, or profile URL',
    },
    requiresRobloxApi: true,
    maxLength: 120,
  },
  {
    id: 'cs2',
    code: 'c',
    name: {
      tr: 'CS2',
      en: 'CS2',
    },
    short: {
      tr: 'CS2',
      en: 'CS2',
    },
    fullName: 'CS2 (Counter-Strike 2)',
    emoji: '💣',
    enabled: true,
    roleId: process.env.GAME_ROLE_CS2 || '1571915951946076323',
    questionLabel: {
      tr: 'CS2 kullanıcı adın nedir?',
      en: 'What is your CS2 username?',
    },
    placeholder: {
      tr: 'CS2 / Steam arkadaş kodun veya kullanıcı adın',
      en: 'Your CS2 / Steam username or friend code',
    },
    requiresRobloxApi: false,
    maxLength: 64,
  },
  {
    id: 'zula',
    code: 'z',
    name: {
      tr: 'Zula',
      en: 'Zula',
    },
    short: {
      tr: 'Zula',
      en: 'Zula',
    },
    fullName: 'Zula',
    emoji: '🔫',
    enabled: true,
    roleId: process.env.GAME_ROLE_ZULA || '1571915745884115005',
    questionLabel: {
      tr: 'Zula kullanıcı adın nedir?',
      en: 'What is your Zula username?',
    },
    placeholder: {
      tr: 'Oyun içi Zula kullanıcı adın',
      en: 'Your in-game Zula username',
    },
    requiresRobloxApi: false,
    maxLength: 64,
  },
  {
    id: 'minecraft',
    code: 'm',
    name: {
      tr: 'Minecraft',
      en: 'Minecraft',
    },
    short: {
      tr: 'Minecraft',
      en: 'Minecraft',
    },
    fullName: 'Minecraft (TLauncher)',
    emoji: '⛏️',
    enabled: true,
    roleId: process.env.GAME_ROLE_MINECRAFT || '1571915841832886382',
    questionLabel: {
      tr: 'Minecraft kullanıcı adın nedir?',
      en: 'What is your Minecraft username?',
    },
    placeholder: {
      tr: 'Minecraft / TLauncher kullanıcı adın',
      en: 'Your Minecraft / TLauncher username',
    },
    requiresRobloxApi: false,
    maxLength: 64,
  },
];

function getEnabledGames() {
  return GAMES.filter((g) => g.enabled);
}

function getGameById(id) {
  const clean = String(id || '').trim().toLowerCase();
  return GAMES.find((g) => g.id === clean) || null;
}

function getGameByCode(code) {
  const clean = String(code || '').trim().toLowerCase();
  return GAMES.find((g) => g.code === clean) || null;
}

/**
 * Geçerli oyun ID'lerini kanonik sırada tekrarsız diziye çevirir.
 */
function normalizeGameList(gameIds) {
  if (!Array.isArray(gameIds)) return [];
  const validSet = new Set();
  for (const id of gameIds) {
    const game = getGameById(id);
    if (game && game.enabled) {
      validSet.add(game.id);
    }
  }
  return GAMES.filter((g) => validSet.has(g.id)).map((g) => g.id);
}

/**
 * Oyun seçimleri + cinsiyet + dil durumunu kısa customId dizesine kodlar.
 * Örn: "rc:m:tr"
 */
function encodeRegState({ games = [], gender = 'u', lang = 'tr' } = {}) {
  const cleanGames = normalizeGameList(games);
  const gameCodes = cleanGames.map((id) => getGameById(id).code).join('') || '0';
  const genderCode = gender === 'm' || gender === 'f' ? gender : 'u';
  const langCode = lang === 'en' ? 'en' : 'tr';
  return `${gameCodes}:${genderCode}:${langCode}`;
}

/**
 * Kısa durum dizesini ayrıştırır.
 */
function decodeRegState(stateStr) {
  const parts = String(stateStr || '').split(':');
  const gameCodesRaw = parts[0] || '0';
  const genderRaw = parts[1] || 'u';
  const langRaw = parts[2] || 'tr';

  const games = [];
  if (gameCodesRaw !== '0') {
    for (const ch of gameCodesRaw) {
      const game = getGameByCode(ch);
      if (game && game.enabled && !games.includes(game.id)) {
        games.push(game.id);
      }
    }
  }

  return {
    games: normalizeGameList(games),
    gender: genderRaw === 'm' || genderRaw === 'f' ? genderRaw : 'u',
    lang: langRaw === 'en' ? 'en' : 'tr',
  };
}

/**
 * Seçilen oyun listesini emojili okunabilir metne çevirir.
 */
function formatGamesDisplay(gameIds, lang = 'tr') {
  const cleanGames = normalizeGameList(gameIds);
  if (cleanGames.length === 0) return null;
  const l = lang === 'en' ? 'en' : 'tr';
  return cleanGames
    .map((id) => {
      const g = getGameById(id);
      return g ? `${g.emoji} ${g.name[l]}` : id;
    })
    .join(', ');
}

module.exports = {
  GAMES,
  getEnabledGames,
  getGameById,
  getGameByCode,
  normalizeGameList,
  encodeRegState,
  decodeRegState,
  formatGamesDisplay,
};
