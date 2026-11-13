const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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
    .setName('klan-duzenle')
    .setDescription('Dost/düşman listesindeki bir klanı yeniden adlandırır veya türünü değiştirir.')
    .setDescriptionLocalizations({
      'en-US': 'Renames or changes the type of a clan in the allied/enemy list.',
    })
    .addStringOption((option) =>
      option
        .setName('klan')
        .setDescription('Düzenlenecek klanı seçin')
        .setDescriptionLocalizations({
          'en-US': 'Select the clan to edit',
        })
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('yeni_ad')
        .setDescription('Klanın yeni adı (Opsiyonel)')
        .setDescriptionLocalizations({
          'en-US': 'New clan name (Optional)',
        })
        .setMinLength(2)
        .setMaxLength(32)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('tur')
        .setDescription('Klanın yeni türü (Opsiyonel)')
        .setDescriptionLocalizations({
          'en-US': 'New clan type (Optional)',
        })
        .addChoices(
          { name: 'Dost (Ally)', value: 'ally' },
          { name: 'Düşman (Enemy)', value: 'enemy' }
        )
        .setRequired(false)
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
    const newNameRaw = interaction.options.getString('yeni_ad');
    const newType = interaction.options.getString('tur');

    if (!newNameRaw && !newType) {
      return interaction.reply({
        content: isEn
          ? '❌ You must provide at least one option to update: new name or new type.'
          : '❌ Düzenlemek için en az bir alan belirtmelisiniz: Yeni ad veya Yeni tür.',
        ephemeral: true,
      });
    }

    const existingClan = database.findKnownClanById(clanId);
    if (!existingClan) {
      return interaction.reply({
        content: isEn
          ? '❌ The selected clan was not found in the list.'
          : '❌ Seçilen klan listede bulunamadı.',
        ephemeral: true,
      });
    }

    const patch = {};

    if (newNameRaw) {
      const sanitized = clanMatcher.sanitizeClanName(newNameRaw);
      if (!sanitized.valid) {
        return interaction.reply({
          content: isEn
            ? '❌ The new clan name is invalid or contains disallowed content.'
            : '❌ Yeni klan adı geçersiz veya uygunsuz içerik barındırıyor.',
          ephemeral: true,
        });
      }
      const norm = clanMatcher.normalizeClanName(sanitized.cleanName);
      patch.name = sanitized.cleanName;
      patch.normalized = norm.full;
      patch.compact = norm.compact;
    }

    if (newType) {
      patch.type = newType;
    }

    const updated = database.updateKnownClan(clanId, patch);
    const panelResult = await updateClanPanel(interaction.guild);

    return interaction.reply({
      content: isEn
        ? `✅ Clan updated: **${updated.name}** (${updated.type === 'ally' ? '⚪ Dost / Ally' : '⚫ Düşman / Enemy'})\n${panelResult.success ? '📊 Clan panel updated.' : '⚠️ Clan panel error: ' + panelResult.error}`
        : `✅ Klan başarıyla güncellendi: **${updated.name}** (${updated.type === 'ally' ? '⚪ Dost' : '⚫ Düşman'})\n${panelResult.success ? '📊 Klan paneli otomatik güncellendi.' : '⚠️ Klan paneli güncellenemedi: ' + panelResult.error}`,
      ephemeral: true,
    });
  },
};
