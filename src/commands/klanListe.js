const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config');
const { buildClanPanelEmbeds } = require('../utils/clanPanel');
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
    .setName('klan-liste')
    .setDescription('Dost ve düşman klanların listesini gösterir.')
    .setDescriptionLocalizations({
      'en-US': 'Displays the list of allied and enemy clans.',
    }),

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

    const embeds = buildClanPanelEmbeds();

    return interaction.reply({
      embeds,
      ephemeral: true,
    });
  },
};
