const { SlashCommandBuilder, ChannelType } = require('discord.js');
const {
  isDeveloper,
  ensureWarningRoles,
  createWarningPanel,
} = require('../utils/warningManager');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uyari-panel')
    .setDescription('Sunucu Uyarı Panelini kurar ve uyarı kademe rollerini oluşturur. (Sadece Developer)')
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin kurulacağı kanal (Boş bırakılırsa varsayılan uyarı paneli kanalı kullanılır)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    // Sadece <@&1561777507223601353> Developer rolü kullanabilir
    if (!isDeveloper(interaction.member)) {
      return interaction.reply({
        content: `❌ Bu komutu yalnızca <@&${config.ROLES.DEVELOPER}> rolüne sahip kişiler kullanabilir!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel =
      interaction.options.getChannel('kanal') ||
      interaction.guild.channels.cache.get(config.CHANNELS.WARNING_PANEL) ||
      (await interaction.guild.channels.fetch(config.CHANNELS.WARNING_PANEL).catch(() => null)) ||
      interaction.channel;

    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Hedef uyarı paneli kanalı bulunamadı!',
      });
    }

    try {
      // Uyarı 1-5 ve Yetkili Uyarı 1-3 rollerini otomatik kontrol et / oluştur
      await ensureWarningRoles(interaction.guild);

      const panelPayload = createWarningPanel();
      await targetChannel.send(panelPayload);

      return interaction.editReply({
        content:
          `✅ **Sunucu Uyarı Paneli** başarıyla <#${targetChannel.id}> kanalına kuruldu!\n` +
          `🛡️ Katılımcı (\`Uyarı 1-5\`, \`Yasaklı\`) ve Yetkili (\`Yetkili Uyarı 1-3\`) kademe rolleri otomatik olarak hazırlandı.`,
      });
    } catch (err) {
      console.error('[UYARI PANELİ KURULUM HATASI]:', err);
      return interaction.editReply({
        content: `❌ Panel kurulurken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
