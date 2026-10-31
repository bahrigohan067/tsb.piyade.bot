const { Events } = require('discord.js');
const { moderateMessage } = require('../utils/moderationManager');
const { logMessageUpdate } = require('../utils/serverLogManager');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
      if (!newMessage || !newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage && oldMessage.content === newMessage.content) return;

      // 1. Sunucu Genel Log Kanalına bildir (Mesaj Düzenlendi)
      logMessageUpdate(oldMessage, newMessage).catch((err) =>
        console.error('[MESAJ DÜZENLEME LOG HATASI]:', err.message)
      );

      // 2. Küfür / Argo moderasyonu
      await moderateMessage(newMessage);
    } catch (err) {
      console.error('[MESAJ DÜZENLEME KONTROL HATASI]:', err.message);
    }
  },
};
