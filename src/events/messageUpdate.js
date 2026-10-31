const { Events } = require('discord.js');
const { moderateMessage } = require('../utils/moderationManager');
const { handleMediaChannel } = require('../utils/mediaChannelManager');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      // Düzenlenen mesajlarla filtreyi atlatmayı engelle
      if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
      if (!newMessage || !newMessage.guild || newMessage.author?.bot) return;

      // Medya kanalında mesaj sonradan salt metne çevrildiyse denetle
      const isMediaRestricted = await handleMediaChannel(newMessage);
      if (isMediaRestricted) return;

      if (oldMessage.content === newMessage.content) return;

      await moderateMessage(newMessage);
    } catch (err) {
      console.error('[MESAJ DÜZENLEME KONTROL HATASI]:', err.message);
    }
  },
};
