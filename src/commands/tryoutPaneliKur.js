const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createTryoutPanel, updateTryoutLeaderboard } = require('../utils/tryoutManager');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tryout_paneli_kur')
    .setDescription('Tryout / Seviye Değerlendirme panelini ve sıralama tablosunu kurar.')
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin kurulacağı kanal (Boş bırakılırsa varsayılan Tryout kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const isAuthorized =
      interaction.user.id === interaction.guild.ownerId ||
      interaction.member.roles.cache.has(config.ROLES.TRYOUT_STAFF) ||
      interaction.member.roles.cache.has(config.ROLES.DEVELOPER) ||
      interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isAuthorized) {
      return interaction.reply({
        content: `❌ Bu komutu sadece Sunucu Kurucusu, Developer veya <@&${config.ROLES.TRYOUT_STAFF}> yetkilileri kullanabilir!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.TRYOUT_PANEL) ||
      (await interaction.guild.channels.fetch(config.CHANNELS.TRYOUT_PANEL).catch(() => null)) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Hedef Tryout paneli kanalı bulunamadı!',
      });
    }

    try {
      const panelPayload = createTryoutPanel();
      await targetChannel.send(panelPayload);

      // Aynı zamanda Tryout Sıralama Tablosunu da oluştur / güncelle
      await updateTryoutLeaderboard(interaction.guild);

      return interaction.editReply({
        content:
          `✅ **Tryout Değerlendirme Paneli** başarıyla <#${targetChannel.id}> kanalına kuruldu!\n` +
          `📊 Ayrıca <#${config.CHANNELS.TRYOUT_LEADERBOARD}> kanalındaki **Tryout Sıralama Tablosu** aktif hale getirildi.`,
      });
    } catch (err) {
      console.error('[TRYOUT PANEL KURULUM HATASI]:', err);
      return interaction.editReply({
        content: `❌ Panel kurulurken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
