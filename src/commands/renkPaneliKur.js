const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createColorPanel } = require('../utils/colorManager');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('renk_paneli_kur')
    .setDescription('İsim Rengi Seçim panelini belirlenen kanala kurar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin kurulacağı kanal (Boş bırakılırsa varsayılan renk kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.COLOR_PANEL) ||
      (await interaction.guild.channels.fetch(config.CHANNELS.COLOR_PANEL).catch(() => null)) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Hedef renk paneli kanalı bulunamadı!',
      });
    }

    try {
      const payload = createColorPanel();
      await targetChannel.send(payload);

      return interaction.editReply({
        content: `✅ **İsim Rengi Seçim Paneli** başarıyla <#${targetChannel.id}> kanalına kuruldu! 🎨✨`,
      });
    } catch (err) {
      console.error('[RENK PANELİ KURULUM HATASI]:', err);
      return interaction.editReply({
        content: `❌ Panel kurulurken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
