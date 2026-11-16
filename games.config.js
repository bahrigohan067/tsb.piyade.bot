/**
 * Yeni oyun eklemek = bu dosyaya bir kayıt
 * 
 * Piyade Topluluk Botu - Oyun Yapılandırması (İskelet)
 * Bu dosya ileride eklenecek "oyun bazlı roller ve kayıt" sistemi için hazırlanmıştır.
 */

module.exports = {
  GAMES: [
    {
      id: 'roblox',
      name: {
        tr: 'Roblox',
        en: 'Roblox',
      },
      short: {
        tr: 'Roblox',
        en: 'Roblox',
      },
      emoji: '🎮',
      enabled: true,
      roleId: process.env.GAME_ROLE_ROBLOX || null,
    },
    {
      id: 'zula',
      name: {
        tr: 'Zula',
        en: 'Zula',
      },
      short: {
        tr: 'Zula',
        en: 'Zula',
      },
      emoji: '🔫',
      enabled: true,
      roleId: process.env.GAME_ROLE_ZULA || null,
    },
    {
      id: 'minecraft',
      name: {
        tr: 'TLauncher (Minecraft)',
        en: 'TLauncher (Minecraft)',
      },
      short: {
        tr: 'Minecraft',
        en: 'Minecraft',
      },
      emoji: '⛏️',
      enabled: true,
      roleId: process.env.GAME_ROLE_MINECRAFT || null,
    },
    {
      id: 'cs2',
      name: {
        tr: 'CS2',
        en: 'CS2',
      },
      short: {
        tr: 'CS2',
        en: 'CS2',
      },
      emoji: '💣',
      enabled: true,
      roleId: process.env.GAME_ROLE_CS2 || null,
    },
  ],
};
