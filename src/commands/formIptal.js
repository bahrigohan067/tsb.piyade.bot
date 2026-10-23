const { SlashCommandBuilder } = require('discord.js');
const { handleCancelFormCommand } = require('../utils/tryoutManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('form-iptal')
    .setDescription('Hatalı doldurulan bir Tryout değerlendirme formunu geri alır ve önceki rolü iade eder.')
    .addStringOption((option) =>
      option
        .setName('form_kodu')
        .setDescription('İptal edilecek formun kodu (Örn: TRY-4821)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const formCode = interaction.options.getString('form_kodu', true).trim();
    return handleCancelFormCommand(interaction, formCode);
  },
};
