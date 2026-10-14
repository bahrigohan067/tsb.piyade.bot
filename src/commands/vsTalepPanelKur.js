const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createVsPanel } = require('../utils/vsManager');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vs_talep_panel_kur')
    .setDescription('Kapışma (VS) Talep panelini belirlenen kanala gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin gönderileceği kanal (Belirtilmezse varsayılan [vs talep] kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.VS_PANEL) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.reply({
        content: '❌ Hedef VS Talep kanalı bulunamadı! Lütfen kanal ayarlarını kontrol edin.',
        ephemeral: true,
      });
    }

    try {
      const panel = createVsPanel();
      await targetChannel.send(panel);

      return interaction.reply({
        content: `✅ VS Talep Paneli başarıyla <#${targetChannel.id}> kanalına kuruldu!`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[VS PANEL KOMUTU] Panel gönderilirken hata:', err);
      return interaction.reply({
        content: `❌ VS Paneli gönderilirken bir hata oluştu: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
