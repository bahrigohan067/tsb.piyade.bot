const { Events, ActivityType } = require('discord.js');
const config = require('../../config');

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
          name: 'Piyade Team | Kayıt Sistemi',
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
  },
};
