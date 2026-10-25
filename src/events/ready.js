const { Events, ActivityType } = require('discord.js');
const config = require('../../config');
const { checkVsDeadlines, updateTop10Message } = require('../utils/vsManager');
const { updateHelpPanelMessage } = require('../utils/helpManager');
const { updateTryoutLeaderboard } = require('../utils/tryoutManager');
const { ensureColorPanelMessage } = require('../utils/colorManager');

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
          name: 'Piyade Team | Kayıt & VS Sistemi',
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
          
          // Sunucu açılışında Top 10, Tryout Sıralama tablosu ve Renk Panelini güncelle/kur
          setTimeout(() => {
            updateTop10Message(guild).catch(() => {});
            updateTryoutLeaderboard(guild).catch(() => {});
            ensureColorPanelMessage(guild).catch(() => {});
          }, 5000);
        } else {
          console.warn(`[SLASH KOMUTLAR] Guild ID (${config.GUILD_ID}) önbellekte bulunamadı. Genel (Global) olarak kaydediliyor...`);
          await client.application.commands.set(commandsData);
        }
      } else {
        await client.application.commands.set(commandsData);
        console.log(`[SLASH KOMUTLAR] ${commandsData.length} komut genel olarak kaydedildi.`);
      }
    } catch (err) {
      console.error('[SLASH KOMUTLAR] Komutlar yüklenirken hata oluştu:', err);
    }

    // Arka Planda Çalışan 48 Saat / 5 Saat VS Kontrol Döngüsü (vs_deadline_check)
    // İlk kontrol 10 saniye sonra, ardından her 30 dakikada bir çalışır
    setTimeout(() => {
      checkVsDeadlines(client).catch(() => {});
    }, 10000);

    setInterval(() => {
      console.log('[VS DEADLINE CHECK] Aktif VS süreleri denetleniyor...');
      checkVsDeadlines(client).catch((err) => {
        console.error('[VS DEADLINE INTERVAL HATASI]:', err);
      });
    }, 30 * 60 * 1000); // 30 dakikada bir

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
  },
};
