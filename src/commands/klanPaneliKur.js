const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../../config');
const database = require('../utils/database');
const { updateClanPanel } = require('../utils/clanPanel');
const { resolveLang } = require('../utils/i18n');

function isClanAuthorized(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  for (const roleId of config.ROLES.WARNING_AUTHORITIES || []) {
    if (member.roles?.cache?.has(roleId)) return true;
  }
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klan-paneli-kur')
    .setDescription('Dost/Düşman klan panelini belirtilen kanala kurar veya günceller.')
    .setDescriptionLocalizations({
      'en-US': 'Sets up or updates the Allied/Enemy clan panel in the specified channel.',
    })
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Panelin kurulacağı metin kanalı (Opsiyonel)')
        .setDescriptionLocalizations({
          'en-US': 'Text channel to setup the clan panel in (Optional)',
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const isEn = resolveLang(interaction) === 'en';

    if (!isClanAuthorized(interaction.member)) {
      return interaction.reply({
        content: isEn
          ? '❌ Only authorized staff (Yönetmenlik / Developer / Admin) can use this command.'
          : '❌ Bu komutu sadece yetkililer (Yönetmenlik / Developer / Admin) kullanabilir.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel = interaction.options.getChannel('kanal');
    const channelId = targetChannel ? targetChannel.id : config.CHANNELS.CLAN_PANEL;

    const result = await updateClanPanel(interaction.guild, channelId);

    if (!result.success) {
      return interaction.editReply({
        content: isEn
          ? `❌ Clan panel could not be set up: ${result.error}`
          : `❌ Klan paneli kurulurken hata oluştu: ${result.error}`,
      });
    }

    return interaction.editReply({
      content: isEn
        ? `✅ Allied/Enemy Clan Panel has been successfully set up in <#${channelId}>! Message ID: \`${result.messageId}\``
        : `✅ Dost/Düşman Klan Paneli <#${channelId}> kanalında başarıyla kuruldu ve kaydedildi! Mesaj ID: \`${result.messageId}\``,
    });
  },
};
