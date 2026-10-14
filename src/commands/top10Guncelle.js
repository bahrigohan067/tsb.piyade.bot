const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateTop10Message } = require('../utils/vsManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top10_guncelle')
    .setDescription('Top 10 sıralama tablosunu anında yeniler ve günceller.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      await updateTop10Message(interaction.guild);
      return interaction.editReply({
        content: '✅ Top 10 Sıralama Tablosu başarıyla güncellendi!',
      });
    } catch (err) {
      console.error('[TOP 10 GÜNCELLEME HATASI]:', err);
      return interaction.editReply({
        content: `❌ Sıralama tablosu güncellenirken hata oluştu: ${err.message}`,
      });
    }
  },
};
