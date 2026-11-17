const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../../config');
const gamesConfig = require('../../games.config');
const database = require('../utils/database');
const { resolveLang } = require('../utils/i18n');
const { sanitizeInlineCode, escapeEmbedText } = require('../utils/inputSanitizer');

// Kullanıcı başına bekleme süresi takibi (Map<userId, timestamp>)
const profileCooldowns = new Map();

/**
 * Testler için profil bekleme süresi önbelleğini sıfırlar.
 */
function resetProfileCooldowns() {
  profileCooldowns.clear();
}

/**
 * Kayıtlı kullanıcının /profilim yanıt yükünü (embed + varsa Roblox link butonu) oluşturur.
 */
function buildProfilePayload({ user, member, registration, lang = 'tr' }) {
  const isEn = lang === 'en';
  const showName = config.PROFILE?.SHOW_NAME !== false;
  const displayName = registration?.displayName || registration?.realName || null;

  // Oyunları games.config.js sırasına göre diz
  const rawGames = Array.isArray(registration?.games) ? registration.games : [];
  const orderIds = gamesConfig.GAMES.map((g) => g.id);
  const sortedGames = [...rawGames].sort((a, b) => {
    const idxA = orderIds.indexOf(a.id);
    const idxB = orderIds.indexOf(b.id);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

  const gameLines = sortedGames.map((entry) => {
    const gameCfg = gamesConfig.getGameById(entry.id);
    const emoji = gameCfg?.emoji || '🎮';
    const label = gameCfg ? gamesConfig.getGameLabel(gameCfg, lang) : entry.id;
    return `${emoji} **${label}** ➜ \`${sanitizeInlineCode(entry.username, 64)}\``;
  });

  const gamesSection =
    sortedGames.length > 0
      ? gameLines.join('\n')
      : isEn
        ? '*No game info yet*'
        : '*Henüz oyun bilgisi yok*';

  const regTimestampMs = registration?.approvedAt || registration?.registeredAt || null;
  const regDateStr = regTimestampMs ? `<t:${Math.floor(regTimestampMs / 1000)}:D>` : '`Bilinmiyor`';
  const joinTimestampMs = member?.joinedTimestamp || null;
  const joinDateStr = joinTimestampMs ? `<t:${Math.floor(joinTimestampMs / 1000)}:R>` : '`Bilinmiyor`';

  const lines = ['━━━━━━━━━━━━━━━━━━━━'];
  if (showName && displayName) {
    lines.push(
      isEn
        ? `👤 **Name:** ${escapeEmbedText(displayName, 64)}`
        : `👤 **Ad:** ${escapeEmbedText(displayName, 64)}`
    );
  }
  lines.push(`🏷️ **Discord:** <@${user.id}>`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(
    isEn
      ? `🕹️ **Games Played** (${sortedGames.length})`
      : `🕹️ **Oynadığı Oyunlar** (${sortedGames.length})`
  );
  lines.push(gamesSection);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(
    isEn
      ? `📅 **Registered:** ${regDateStr}  •  🚪 **Joined:** ${joinDateStr}`
      : `📅 **Kayıt:** ${regDateStr}  •  🚪 **Sunucuya katılım:** ${joinDateStr}`
  );
  lines.push(
    isEn
      ? '💡 Copy a username to add as a friend! 🤝'
      : '💡 Arkadaş eklemek için kullanıcı adını kopyala! 🤝'
  );

  const avatarUrl =
    typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ size: 256 })
      : null;

  const embed = new EmbedBuilder()
    .setTitle(isEn ? '🎮✨ Player Profile' : '🎮✨ Oyuncu Profili')
    .setColor(config.COLORS.PURPLE || config.COLORS.PRIMARY)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${config.BRAND_NAME} • /profilim` });

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  // Roblox oyunu varsa ve geçerli sayısal ID bulunuyorsa profil link butonu ekle
  const components = [];
  const robloxGame = sortedGames.find((g) => g.id === 'roblox');
  const robloxId = robloxGame?.robloxId || registration?.robloxId || null;
  if (robloxGame && robloxId && /^\d+$/.test(String(robloxId))) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(isEn ? '🧱 Roblox Profile' : '🧱 Roblox Profili')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/users/${robloxId}/profile`)
      )
    );
  }

  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profilim')
    .setNameLocalizations({
      'en-US': 'profile',
      'en-GB': 'profile',
    })
    .setDescription('Oynadığın oyunları ve kullanıcı adlarını herkese göster 🎮')
    .setDescriptionLocalizations({
      'en-US': 'Show the games you play and your usernames to everyone 🎮',
      'en-GB': 'Show the games you play and your usernames to everyone 🎮',
    }),

  buildProfilePayload,
  resetProfileCooldowns,

  async execute(interaction) {
    const lang = resolveLang(interaction);
    const isEn = lang === 'en';

    // 1. Kayıtlı üye kontrolü (isRegisteredMember rolü + veritabanı kaydı)
    const regRecord = database.getRegistrationByDiscordId(interaction.user.id);
    const isRegistered = config.isRegisteredMember(interaction.member) && Boolean(regRecord);

    if (!isRegistered) {
      return interaction.reply({
        content: isEn
          ? `You are not registered yet. Use the button in <#${config.CHANNELS.REGISTER}> to register 📝`
          : `Henüz kayıtlı değilsin. Kayıt için <#${config.CHANNELS.REGISTER}> kanalındaki butonu kullan 📝`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    // 2. Bekleme süresi (cooldown) kontrolü (kullanıcı başına 30 sn)
    const cooldownSec = Number(config.PROFILE?.COOLDOWN_SEC ?? 30);
    const cooldownMs = Math.max(0, cooldownSec) * 1000;
    const now = Date.now();
    const lastUsed = profileCooldowns.get(interaction.user.id) || 0;

    if (cooldownMs > 0 && now - lastUsed < cooldownMs) {
      const remainingSec = Math.max(1, Math.ceil((cooldownMs - (now - lastUsed)) / 1000));
      return interaction.reply({
        content: isEn
          ? `Try again in ${remainingSec} sec ⏳`
          : `${remainingSec} sn sonra tekrar dene ⏳`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    profileCooldowns.set(interaction.user.id, now);

    // 3. Herkese açık profil yanıtı gönder (kimseyi pinglemeden)
    const payload = buildProfilePayload({
      user: interaction.user,
      member: interaction.member,
      registration: regRecord,
      lang,
    });

    return interaction.reply({
      ...payload,
      ephemeral: false,
    });
  },
};
