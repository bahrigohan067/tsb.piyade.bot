const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createHelpPanelPayload } = require('../utils/helpManager');
const database = require('../utils/database');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('yardim_paneli_kur')
    .setDescription('Acil Yardım ve Takviye Çağrısı panelini belirlenen kanala kurar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin kurulacağı kanal (Varsayılan yardım paneli kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.HELP_PANEL) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Hedef yardım paneli kanalı bulunamadı! Lütfen kanal ayarlarını kontrol edin.',
      });
    }

    try {
      const payload = await createHelpPanelPayload(interaction.guild);
      const sentMsg = await targetChannel.send(payload);

      // Mesaj ID'sini kaydet (30 saniyede bir otomatik güncellenecek)
      database.setHelpPanelMessageId(sentMsg.id);

      return interaction.editReply({
        content: `✅ Acil Yardım Paneli başarıyla <#${targetChannel.id}> kanalına kuruldu ve 30 saniyelik aktiflik döngüsü bağlandı!`,
      });
    } catch (err) {
      console.error('[YARDIM PANELİ KURULUM HATASI]:', err);
      return interaction.editReply({
        content: `❌ Panel kurulurken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
