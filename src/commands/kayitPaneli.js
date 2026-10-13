const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createRegisterPanel } = require('../utils/panel');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit-paneli')
    .setDescription('Kayıt kanalına kayıt olma panelini gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin gönderileceği kanal (Belirtilmezse varsayılan kayıt kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.REGISTER) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.reply({
        content: '❌ Hedef kayıt kanalı bulunamadı! Lütfen kanal ID\'sini kontrol edin.',
        ephemeral: true,
      });
    }

    try {
      const panel = createRegisterPanel();
      await targetChannel.send(panel);

      return interaction.reply({
        content: `✅ Kayıt paneli başarıyla <#${targetChannel.id}> kanalına gönderildi!`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[PANEL KOMUTU] Panel gönderilirken hata:', err);
      return interaction.reply({
        content: `❌ Panel gönderilirken bir hata oluştu: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
