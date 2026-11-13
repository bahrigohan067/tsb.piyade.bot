const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const config = require('../../config');
const database = require('../utils/database');
const clanMatcher = require('../utils/clanMatcher');
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
    .setName('klan-sil')
    .setDescription('Dost veya düşman klan listesinden bir klanı siler.')
    .setDescriptionLocalizations({
      'en-US': 'Removes a clan from the allied or enemy clan list.',
    })
    .addStringOption((option) =>
      option
        .setName('klan')
        .setDescription('Silinecek klanı seçin')
        .setDescriptionLocalizations({
          'en-US': 'Select the clan to remove',
        })
        .setAutocomplete(true)
        .setRequired(true)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().trim();
    const clans = database.getKnownClans();

    let matches = clans;
    if (focusedValue) {
      const normQuery = clanMatcher.normalizeClanName(focusedValue).compact;
      matches = clans
        .map((c) => ({
          clan: c,
          score: Math.max(
            c.compact.includes(normQuery) ? 0.9 : 0,
            clanMatcher.similarity(focusedValue, c.name)
          ),
        }))
        .filter((item) => item.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.clan);
    }

    const choices = matches.slice(0, 25).map((c) => ({
      name: `${c.name} (${c.type === 'ally' ? '⚪ Dost' : '⚫ Düşman'})`.slice(0, 100),
      value: c.id,
    }));

    return interaction.respond(choices).catch(() => {});
  },

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

    const clanId = interaction.options.getString('klan');
    const existingClan = database.findKnownClanById(clanId);

    if (!existingClan) {
      return interaction.reply({
        content: isEn
          ? '❌ The selected clan was not found in the list.'
          : '❌ Seçilen klan listede bulunamadı.',
        ephemeral: true,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_confirm_clan_delete')
        .setLabel(isEn ? '✅ Yes, Delete' : '✅ Evet, Sil')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('btn_cancel_clan_delete')
        .setLabel(isEn ? '✖️ Cancel' : '✖️ Vazgeç')
        .setStyle(ButtonStyle.Secondary)
    );

    const replyMsg = await interaction.reply({
      content: isEn
        ? `⚠️ Are you sure you want to delete **${existingClan.name}** (${existingClan.type === 'ally' ? 'Allied' : 'Enemy'}) from the clan list?`
        : `⚠️ **${existingClan.name}** (${existingClan.type === 'ally' ? 'Dost' : 'Düşman'}) klanını listeden silmek istediğinize emin misiniz?`,
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      const confirmation = await replyMsg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30000,
        filter: (btn) => btn.user.id === interaction.user.id,
      });

      if (confirmation.customId === 'btn_confirm_clan_delete') {
        database.removeKnownClan(clanId);
        const panelResult = await updateClanPanel(interaction.guild);

        return confirmation.update({
          content: isEn
            ? `✅ Clan **${existingClan.name}** has been removed.\n${panelResult.success ? '📊 Clan panel updated.' : '⚠️ Clan panel error: ' + panelResult.error}`
            : `✅ **${existingClan.name}** klanı başarıyla silindi.\n${panelResult.success ? '📊 Klan paneli otomatik güncellendi.' : '⚠️ Klan paneli güncellenemedi: ' + panelResult.error}`,
          components: [],
        });
      } else {
        return confirmation.update({
          content: isEn ? '✖️ Deletion cancelled.' : '✖️ Silme işlemi iptal edildi.',
          components: [],
        });
      }
    } catch (e) {
      return interaction.editReply({
        content: isEn
          ? '⏳ Confirmation timed out (30 seconds). Deletion cancelled.'
          : '⏳ 30 saniye içinde onaylanmadığı için silme işlemi zaman aşımına uğradı ve iptal edildi.',
        components: [],
      }).catch(() => {});
    }
  },
};
