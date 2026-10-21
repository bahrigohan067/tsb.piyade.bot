const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temizle')
    .setDescription('Belirtilen miktarda mesajı kanaldan siler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('sayi')
        .setDescription('Silinecek mesaj miktarı (1 - 300)')
        .setMinValue(1)
        .setMaxValue(300)
        .setRequired(true)
    ),

  async execute(interaction) {
    const count = interaction.options.getInteger('sayi');

    await interaction.deferReply({ ephemeral: true });

    try {
      let totalDeleted = 0;
      let remaining = count;

      while (remaining > 0) {
        const batchSize = Math.min(remaining, 100);
        const deletedCollection = await interaction.channel.bulkDelete(batchSize, true);
        totalDeleted += deletedCollection.size;

        if (deletedCollection.size < batchSize) {
          break;
        }

        remaining -= batchSize;
      }

      let infoText = `🗑️ Başarıyla **${totalDeleted}** adet mesaj temizlendi!`;
      if (totalDeleted < count) {
        infoText += `\n-# ⚠️ Discord kuralları gereği 14 günden eski mesajlar toplu olarak silinemez.`;
      }

      return interaction.editReply({
        content: infoText,
      });
    } catch (err) {
      console.error('[SLASH TEMİZLE HATASI]:', err);
      return interaction.editReply({
        content: `❌ Mesajlar silinirken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
