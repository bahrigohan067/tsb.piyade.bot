const { SlashCommandBuilder } = require('discord.js');
const { handleCancelWarningCommand } = require('../utils/warningManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uyari-iptal')
    .setDescription('Verilen bir uyarıyı (puan, rol, timeout, askıda veya ban dahil) tamamen geri alır.')
    .addStringOption((option) =>
      option
        .setName('uyari_id')
        .setDescription('İptal edilecek uyarının 4 haneli ID kodu (Örn: A8F2 veya #A8F2)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const warnId = interaction.options.getString('uyari_id', true).trim();
    return handleCancelWarningCommand(interaction, warnId);
  },
};
