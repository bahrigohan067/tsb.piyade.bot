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
    .setName('klan-ekle')
    .setDescription('Dost veya düşman klan listesine yeni bir klan ekler.')
    .setDescriptionLocalizations({
      'en-US': 'Adds a new clan to the allied or enemy clan list.',
    })
    .addStringOption((option) =>
      option
        .setName('ad')
        .setDescription('Eklenecek klanın adı (2-32 karakter)')
        .setDescriptionLocalizations({
          'en-US': 'Name of the clan (2-32 characters)',
        })
        .setMinLength(2)
        .setMaxLength(32)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('tur')
        .setDescription('Klanın türü (Dost veya Düşman)')
        .setDescriptionLocalizations({
          'en-US': 'Clan type (Allied or Enemy)',
        })
        .addChoices(
          { name: 'Dost (Ally)', value: 'ally' },
          { name: 'Düşman (Enemy)', value: 'enemy' }
        )
        .setRequired(true)
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

    const rawName = interaction.options.getString('ad');
    const type = interaction.options.getString('tur');

    const sanitized = clanMatcher.sanitizeClanName(rawName);
    if (!sanitized.valid) {
      return interaction.reply({
        content: isEn
          ? (sanitized.error === 'CLAN_BLOCKED'
              ? '❌ The clan name contains disallowed content (mentions, invite links, or profanity).'
              : '❌ Invalid clan name! Must be between 2 and 32 characters and contain valid letters.')
          : (sanitized.error === 'CLAN_BLOCKED'
              ? '❌ Girdiğiniz klan adı uygunsuz içerik (etiket, davet linki veya küfür) içerdiği için reddedildi.'
              : '❌ Geçersiz klan adı! Klan adı 2-32 karakter olmalı ve harf içermelidir.'),
        ephemeral: true,
      });
    }

    const norm = clanMatcher.normalizeClanName(sanitized.cleanName);
    const existingClans = database.getKnownClans();
    const existing = existingClans.find((c) => c.compact === norm.compact);

    if (existing) {
      if (existing.type === type) {
        return interaction.reply({
          content: isEn
            ? `⚠️ This clan is already in the ${type === 'ally' ? 'allied' : 'enemy'} list (**${existing.name}**).`
            : `⚠️ Bu klan zaten ${type === 'ally' ? 'dost' : 'düşman'} klanlar listesinde kayıtlı (**${existing.name}**).`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: isEn
          ? `⚠️ This clan is currently in the ${existing.type === 'ally' ? 'allied' : 'enemy'} list! Use \`/klan-duzenle\` to change its type.`
          : `⚠️ Bu klan şu anda **${existing.type === 'ally' ? 'dost' : 'düşman'}** klanlar listesinde bulunuyor! Türünü değiştirmek için \`/klan-duzenle\` komutunu kullanınız.`,
        ephemeral: true,
      });
    }

    const created = database.addKnownClan({
      name: sanitized.cleanName,
      normalized: norm.full,
      compact: norm.compact,
      type,
      createdBy: interaction.user.id,
    });

    const panelResult = await updateClanPanel(interaction.guild);

    return interaction.reply({
      content: isEn
        ? `✅ Clan **${created.name}** has been successfully added as a **${type === 'ally' ? 'Dost (Ally)' : 'Düşman (Enemy)'}** clan!\n${panelResult.success ? '📊 Clan panel updated.' : '⚠️ Clan panel could not be updated: ' + panelResult.error}`
        : `✅ **${created.name}** klanı başarıyla **${type === 'ally' ? 'Dost' : 'Düşman'}** klan olarak eklendi!\n${panelResult.success ? '📊 Klan paneli otomatik güncellendi.' : '⚠️ Klan paneli güncellenemedi: ' + panelResult.error}`,
      ephemeral: true,
    });
  },
};
