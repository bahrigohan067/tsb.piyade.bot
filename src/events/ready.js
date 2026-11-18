const { Events, ActivityType } = require('discord.js');
const config = require('../../config');
const { validateGamesConfig } = require('../../games.config');
const { ensureColorPanelMessage } = require('../utils/colorManager');
const { ensureRegisterPanelMessage } = require('../utils/panel');
const { ensureEnglishRole, logLanguageStartupStats } = require('../utils/i18n');
const { syncAfkVoiceStatesOnStartup } = require('../utils/afkVoiceManager');
const { checkFeedbackChannelOnStartup } = require('../utils/feedbackManager');
const {
  ensureWarningPanelMessage,
  checkThirtyDayAmnesty,
  checkSuspendedExpirations,
} = require('../utils/warningManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`=========================================`);
    console.log(`🤖 Bot Aktif: ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Sunucu Sayısı: ${client.guilds.cache.size}`);
    console.log(`=========================================`);

    // Oyun yapılandırması doğrulaması (4+ oyun uyarısı ve alan limitleri)
    validateGamesConfig();

    // Bot durumu ayarlama
    client.user.setPresence({
      activities: [
        {
          name: config.BRAND_NAME,
          type: ActivityType.Watching,
        },
      ],
      status: 'online',
    });

    // Slash Komutlarını Sunucuya Kaydetme (Anında aktif olur)
    try {
      const commandsData = [];
      for (const command of client.commands.values()) {
        commandsData.push(command.data.toJSON());
      }

      if (config.GUILD_ID) {
        const guild = client.guilds.cache.get(config.GUILD_ID);
        if (guild) {
          await guild.commands.set(commandsData);
          console.log(`[SLASH KOMUTLAR] ${commandsData.length} komut '${guild.name}' sunucusuna başarıyla yüklendi.`);

          // Sunucu açılışında Kayıt Paneli, Renk Paneli, Uyarı Paneli, Dil Raporu ve AFK Ses Durumunu eşitle
          setTimeout(async () => {
            await ensureEnglishRole(guild).catch(() => {});
            logLanguageStartupStats(guild);
            syncAfkVoiceStatesOnStartup(guild).catch(() => {});
            ensureRegisterPanelMessage(guild).catch(() => {});
            ensureColorPanelMessage(guild).catch(() => {});
            ensureWarningPanelMessage(guild).catch(() => {});
            checkFeedbackChannelOnStartup(guild).catch(() => {});
          }, 5000);
        } else {
          console.warn(`[SLASH KOMUTLAR] Guild ID (${config.GUILD_ID}) önbellekte bulunamadı. Genel (Global) olarak kaydediliyor...`);
          await client.application.commands.set(commandsData);
          checkFeedbackChannelOnStartup(null).catch(() => {});
        }
      } else {
        await client.application.commands.set(commandsData);
        console.log(`[SLASH KOMUTLAR] ${commandsData.length} komut genel olarak kaydedildi.`);
        checkFeedbackChannelOnStartup(null).catch(() => {});
      }
    } catch (err) {
      console.error('[SLASH KOMUTLAR] Komutlar yüklenirken hata oluştu:', err);
    }

    // Uyarı Sistemi: 30 Dakikada Bir @Askıda (1 Haftalık Karantina) Süre Kontrolü
    setTimeout(() => {
      checkSuspendedExpirations(client).catch(() => {});
      checkThirtyDayAmnesty(client).catch(() => {});
    }, 15000);

    setInterval(() => {
      checkSuspendedExpirations(client).catch(() => {});
    }, 30 * 60 * 1000); // Her 30 dakikada bir

    // Uyarı Sistemi: Saat Başı 30 Günlük Otomatik Af Kontrolü
    setInterval(() => {
      checkThirtyDayAmnesty(client).catch(() => {});
    }, 60 * 60 * 1000); // Her 1 saatte bir
  },
};
