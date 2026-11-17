const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { ensureRegisterPanelMessage } = require('../utils/panel');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kayit-paneli')
    .setDescription('Kayıt kanalında mevcut kayıt panelini günceller veya yoksa yeni panel gönderir.')
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
      (await interaction.guild.channels.fetch(config.CHANNELS.REGISTER).catch(() => null)) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.reply({
        content: "❌ Hedef kayıt kanalı bulunamadı! Lütfen kanal ID'sini kontrol edin.",
        ephemeral: true,
      });
    }

    try {
      const result = await ensureRegisterPanelMessage(interaction.guild, {
        channelId: targetChannel.id,
        createIfMissing: true,
      });

      if (result.action === 'updated') {
        const extraNote =
          result.duplicatesFound > 0
            ? ` (Not: Kanalda ${result.duplicatesFound + 1} panel tespit edildi; yalnızca en yenisi güncellendi.)`
            : '';
        return interaction.reply({
          content: `✅ <#${targetChannel.id}> kanalındaki mevcut kayıt paneli güncellendi!${extraNote}`,
          ephemeral: true,
        });
      }

      if (result.action === 'created') {
        return interaction.reply({
          content: `✅ Kayıt paneli başarıyla <#${targetChannel.id}> kanalına gönderildi!`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: `❌ Kayıt paneli işlemi tamamlanamadı (${result.error || result.action}).`,
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
