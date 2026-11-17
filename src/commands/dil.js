const { SlashCommandBuilder } = require('discord.js');
const { resolveLang, setMemberLanguage } = require('../utils/i18n');

const DIL_COOLDOWN_MS = 10 * 1000;
const dilCooldowns = new Map();

/**
 * Testler için /dil bekleme süresi önbelleğini sıfırlar.
 */
function resetDilCooldowns() {
  dilCooldowns.clear();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dil')
    .setNameLocalizations({
      'en-US': 'language',
      'en-GB': 'language',
    })
    .setDescription('Bot dilini seç: Türkçe, English veya otomatik 🌐')
    .setDescriptionLocalizations({
      'en-US': 'Choose the bot language: Turkish, English or automatic 🌐',
      'en-GB': 'Choose the bot language: Turkish, English or automatic 🌐',
    })
    .addStringOption((option) =>
      option
        .setName('tercih')
        .setNameLocalizations({
          'en-US': 'preference',
          'en-GB': 'preference',
        })
        .setDescription('Kullanmak istediğiniz bot dilini seçin')
        .setDescriptionLocalizations({
          'en-US': 'Select your preferred bot language',
          'en-GB': 'Select your preferred bot language',
        })
        .setRequired(true)
        .addChoices(
          {
            name: '🇹🇷 Türkçe',
            name_localizations: {
              'en-US': '🇹🇷 Turkish',
              'en-GB': '🇹🇷 Turkish',
            },
            value: 'tr',
          },
          {
            name: '🇬🇧 English',
            name_localizations: {
              'en-US': '🇬🇧 English',
              'en-GB': '🇬🇧 English',
            },
            value: 'en',
          },
          {
            name: '🔄 Otomatik / Automatic',
            name_localizations: {
              'en-US': '🔄 Automatic',
              'en-GB': '🔄 Automatic',
            },
            value: 'auto',
          }
        )
    ),

  resetDilCooldowns,
  DIL_COOLDOWN_MS,

  async execute(interaction) {
    const userId = interaction.user?.id;
    const now = Date.now();
    const lastUsed = userId ? dilCooldowns.get(userId) || 0 : 0;

    if (now - lastUsed < DIL_COOLDOWN_MS) {
      const remainingSec = Math.max(1, Math.ceil((DIL_COOLDOWN_MS - (now - lastUsed)) / 1000));
      const curLang = resolveLang(interaction);
      return interaction.reply({
        content:
          curLang === 'en'
            ? `⏳ Please wait **${remainingSec} seconds** before changing your language again.`
            : `⏳ Dil tercihini tekrar değiştirmek için lütfen **${remainingSec} saniye** bekle.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    const choice = interaction.options.getString('tercih', true);
    if (!['tr', 'en', 'auto'].includes(choice)) {
      return interaction.reply({
        content: '❌ Geçersiz dil seçimi. / Invalid language choice.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    if (userId) {
      dilCooldowns.set(userId, now);
    }

    // Yalnızca /dil komutu kalıcı tercih yazar ve English rolünü senkronize eder.
    // Rol hatası durumunda setMemberLanguage sadece loglar; kullanıcıya hata gösterilmez.
    await setMemberLanguage(interaction.member || userId, choice);

    let replyContent;
    if (choice === 'tr') {
      replyContent = '✅ Dil tercihin Türkçe olarak kaydedildi.';
    } else if (choice === 'en') {
      replyContent = '✅ Your language preference was saved as English.';
    } else {
      replyContent =
        '🔄 Artık Discord dil ayarına göre otomatik. / Now automatic, based on your Discord language.';
    }

    return interaction.reply({
      content: replyContent,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
