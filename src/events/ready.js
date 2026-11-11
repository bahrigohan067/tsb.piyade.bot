const { Events, ActivityType } = require('discord.js');
const config = require('../../config');
const { updateHelpPanelMessage } = require('../utils/helpManager');
const { updateTryoutLeaderboard, ensureTryoutMessagesUpdated } = require('../utils/tryoutManager');
const { ensureColorPanelMessage } = require('../utils/colorManager');
const { ensureRegisterPanelMessage } = require('../utils/panel');
const { ensureEnglishRole } = require('../utils/i18n');
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

    // Bot durumu ayarlama
    client.user.setPresence({
      activities: [
        {
          name: 'Piyade Team | TSB',
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
          
          // Sunucu açılışında Tryout Sıralama tablosu, Kayıt Paneli, Renk Paneli ve Uyarı Panelini güncelle/kur
          setTimeout(() => {
            ensureEnglishRole(guild).catch(() => {});
            ensureRegisterPanelMessage(guild).catch(() => {});
            updateTryoutLeaderboard(guild).catch(() => {});
            ensureTryoutMessagesUpdated(guild).catch(() => {});
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

    // Acil Yardım Paneli 30 Saniyelik Aktiflik Güncelleme Döngüsü
    setTimeout(() => {
      const guild = client.guilds.cache.get(config.GUILD_ID);
      if (guild) updateHelpPanelMessage(guild).catch(() => {});
    }, 8000);

    setInterval(() => {
      const guild = client.guilds.cache.get(config.GUILD_ID);
      if (guild) {
        updateHelpPanelMessage(guild).catch((err) => {
          // Çok sık log basıp terminali kirletmemesi için warn seviyesinde tutulabilir
        });
      }
    }, 30 * 1000); // 30 saniyede bir paneli güncelle

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
