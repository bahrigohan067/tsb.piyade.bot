const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const database = require('../utils/database');
const config = require('../../config');
const gamesConfig = require('../../games.config');
const { sanitizeInlineCode, escapeEmbedText } = require('../utils/inputSanitizer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit-bilgi')
    .setDescription('Bir kullanıcının kayıt, oyun ve Roblox bilgilerini sorgular.')
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Bilgisi sorgulanacak Discord kullanıcısı')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('roblox_id')
        .setDescription("Sorgulanacak Roblox ID'si")
        .setRequired(false)
    ),

  async execute(interaction) {
    // Sadece yetkili rolleri veya yönetici kullanabilsin
    const staffRoles = [
      config.ROLES.STAFF,
      config.ROLES.STAFF_GENERAL,
      config.ROLES.TRYOUT_STAFF,
      config.ROLES.DEVELOPER,
      config.ROLES.FOUNDER,
      config.ROLES.COMMUNITY_OFFICIAL,
    ].filter(Boolean);
    const hasRole = staffRoles.some((rId) => interaction.member.roles.cache.has(rId));
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasRole && !isAdmin) {
      return interaction.reply({
        content: '❌ Bu komutu sadece Kayıt Yetkilileri kullanabilir.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('kullanici');
    const targetRobloxId = interaction.options.getString('roblox_id');

    let record = null;

    if (targetUser) {
      record = database.getRegistrationByDiscordId(targetUser.id);
    } else if (targetRobloxId) {
      record = database.getRegistrationByRobloxId(targetRobloxId);
    } else {
      record = database.getRegistrationByDiscordId(interaction.user.id);
    }

    if (!record) {
      return interaction.reply({
        content: '🔍 Belirtilen kritere uygun bir kayıt bulunamadı.',
        ephemeral: true,
      });
    }

    const displayName = record.displayName || record.realName || 'Belirtilmemiş';
    const games = Array.isArray(record.games) ? record.games : [];

    // Oyunları games.config.js sırasıyla formatla
    const orderIds = gamesConfig.GAMES.map((g) => g.id);
    const sortedGames = [...games].sort((a, b) => {
      const idxA = orderIds.indexOf(a.id);
      const idxB = orderIds.indexOf(b.id);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    const gamesText =
      sortedGames.length > 0
        ? sortedGames
            .map((g) => {
              const cfg = gamesConfig.getGameById(g.id);
              const emoji = cfg?.emoji || '🎮';
              const label = cfg ? gamesConfig.getGameLabel(cfg, 'tr') : g.id;
              return `${emoji} **${label}** ➜ \`${sanitizeInlineCode(g.username, 64)}\``;
            })
            .join('\n')
        : '*Kayıtlı oyun bilgisi yok*';

    const robloxGame = sortedGames.find((g) => g.id === 'roblox');
    const robloxId = robloxGame?.robloxId || record.robloxId || null;
    const robloxNick = robloxGame?.username || record.robloxUsername || null;

    const embed = new EmbedBuilder()
      .setTitle('📋 Kayıtlı Üye Bilgileri')
      .setColor(config.COLORS.PRIMARY)
      .addFields(
        { name: '👤 Discord Kullanıcısı', value: `<@${record.discordId}> (\`${record.discordId}\`)`, inline: true },
        { name: '📝 Ad / Takma Ad', value: `${escapeEmbedText(displayName, 64)}`, inline: true },
        { name: '🚻 Cinsiyet', value: `${record.gender || 'Belirtilmemiş'}`, inline: true },
        { name: '🎮 Oyunlar ve Kullanıcı Adları', value: gamesText, inline: false }
      );

    if (robloxNick || robloxId) {
      embed.addFields(
        {
          name: '🧱 Roblox Profili',
          value:
            robloxId && /^\d+$/.test(String(robloxId))
              ? `[${sanitizeInlineCode(robloxNick || 'Profil')}](https://www.roblox.com/users/${robloxId}/profile)`
              : `\`${sanitizeInlineCode(robloxNick || '-')}\``,
          inline: true,
        },
        { name: '🆔 Roblox ID', value: `\`${robloxId || '-'}\``, inline: true }
      );
    }

    embed.addFields(
      { name: '👮 Onaylayan Yetkili', value: record.approvedBy ? `<@${record.approvedBy}>` : 'Bilinmiyor', inline: true },
      { name: '📅 Kayıt Tarihi', value: record.registeredAt ? `<t:${Math.floor(record.registeredAt / 1000)}:F>` : 'Bilinmiyor', inline: false }
    );

    embed.setFooter({ text: `${config.BRAND_NAME} | Kayıt Sistemi` }).setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
