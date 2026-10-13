const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const database = require('../utils/database');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit-bilgi')
    .setDescription('Bir kullanıcının kayıt ve Roblox bilgilerini sorgular.')
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
    const hasRole = interaction.member.roles.cache.has(config.ROLES.STAFF);
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

    const embed = new EmbedBuilder()
      .setTitle('📋 Kayıtlı Üye Bilgileri')
      .setColor(config.COLORS.PRIMARY)
      .addFields(
        { name: '👤 Discord Kullanıcısı', value: `<@${record.discordId}> (\`${record.discordId}\`)`, inline: true },
        { name: '📝 Gerçek Adı', value: `${record.realName || 'Belirtilmemiş'}`, inline: true },
        { name: '🚻 Cinsiyet', value: `${record.gender || 'Belirtilmemiş'}`, inline: true },
        { name: '🎮 Roblox Kullanıcı Adı', value: `[${record.robloxUsername || 'Profil'}](https://www.roblox.com/users/${record.robloxId}/profile)`, inline: true },
        { name: '🆔 Roblox ID', value: `\`${record.robloxId}\``, inline: true },
        { name: '👮 Onaylayan Yetkili', value: record.approvedBy ? `<@${record.approvedBy}>` : 'Bilinmiyor', inline: true },
        { name: '📅 Kayıt Tarihi', value: record.registeredAt ? `<t:${Math.floor(record.registeredAt / 1000)}:F>` : 'Bilinmiyor', inline: false }
      )
      .setFooter({ text: 'Piyade Team | Kayıt Sistemi' })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
