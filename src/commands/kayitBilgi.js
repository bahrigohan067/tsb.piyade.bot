const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const database = require('../utils/database');
const config = require('../../config');
const gamesConfig = require('../../games.config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit-bilgi')
    .setDescription('Bir kullanıcının kayıt ve oyun bilgilerini sorgular.')
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Bilgisi sorgulanacak Discord kullanıcısı')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('roblox_id')
        .setDescription('Sorgulanacak Roblox ID\'si')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Sadece yetkili rolü veya yönetici kullanabilsin
    const hasRole =
      interaction.member.roles.cache.has(config.ROLES.STAFF) ||
      interaction.member.roles.cache.has(config.ROLES.STAFF_GENERAL) ||
      interaction.member.roles.cache.has(config.ROLES.DEVELOPER) ||
      interaction.member.roles.cache.has(config.ROLES.FOUNDER) ||
      interaction.member.roles.cache.has(config.ROLES.COMMUNITY_OFFICIAL);
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

    const gamesList = gamesConfig.normalizeGameList(record.games || (record.robloxId ? ['roblox'] : []));
    const gamesDisplay = gamesConfig.formatGamesDisplay(gamesList, 'tr') || 'Belirtilmemiş';
    const usernames = record.gameUsernames || {};

    const fields = [
      { name: '👤 Discord Kullanıcısı', value: `<@${record.discordId}> (\`${record.discordId}\`)`, inline: true },
      { name: '📝 Adı / Takma Adı', value: `${record.realName || 'Belirtilmemiş'}`, inline: true },
      { name: '🚻 Cinsiyet', value: `${record.gender || 'Belirtilmemiş'}`, inline: true },
      { name: '🎮 Seçtiği Oyunlar', value: gamesDisplay, inline: false },
    ];

    if (record.robloxId || record.robloxUsername) {
      const robloxLink = record.robloxId
        ? `[${record.robloxUsername || 'Profil'}](https://www.roblox.com/users/${record.robloxId}/profile)`
        : `\`${record.robloxUsername}\``;
      fields.push(
        { name: '🎮 Roblox Kullanıcı Adı', value: robloxLink, inline: true },
        { name: '🆔 Roblox ID', value: record.robloxId ? `\`${record.robloxId}\`` : '`Yok`', inline: true }
      );
    }

    for (const gId of gamesList) {
      if (gId === 'roblox') continue;
      const g = gamesConfig.getGameById(gId);
      if (!g) continue;
      fields.push({
        name: `${g.emoji} ${g.name.tr} Kullanıcı Adı`,
        value: usernames[gId] ? `\`${usernames[gId]}\`` : '`Belirtilmemiş`',
        inline: true,
      });
    }

    fields.push(
      { name: '👮 Onaylayan Yetkili', value: record.approvedBy ? `<@${record.approvedBy}>` : 'Bilinmiyor', inline: true },
      { name: '📅 Kayıt Tarihi', value: record.registeredAt ? `<t:${Math.floor(record.registeredAt / 1000)}:F>` : 'Bilinmiyor', inline: false }
    );

    const embed = new EmbedBuilder()
      .setTitle('📋 Kayıtlı Üye Bilgileri')
      .setColor(config.COLORS.PRIMARY)
      .addFields(fields)
      .setFooter({ text: `${config.BRAND_NAME} | Kayıt Sistemi` })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
