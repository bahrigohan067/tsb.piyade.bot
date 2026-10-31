const { Events } = require('discord.js');
const serverLogManager = require('../utils/serverLogManager');

/**
 * Sunucu Denetim Olayları (Audit Logs)
 * Mesaj gönderme haricindeki tüm sunucu hareketlerini dinler ve SERVER_LOG kanalına aktarır.
 */

module.exports = [
  // 1. Mesaj Silinmesi
  {
    name: Events.MessageDelete,
    async execute(message) {
      serverLogManager.logMessageDelete(message);
    },
  },

  // 2. Toplu Mesaj Silinmesi
  {
    name: Events.MessageBulkDelete,
    async execute(messages, channel) {
      serverLogManager.logMessageBulkDelete(messages, channel);
    },
  },

  // 3. Üye Ayrılması / Atılması (Kick)
  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      serverLogManager.logMemberRemove(member);
    },
  },

  // 4. Üye Güncellenmesi (Takma Ad, Roller, Timeout)
  {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
      serverLogManager.logMemberUpdate(oldMember, newMember);
    },
  },

  // 5. Üye Yasaklanması (Ban)
  {
    name: Events.GuildBanAdd,
    async execute(ban) {
      serverLogManager.logBanAdd(ban);
    },
  },

  // 6. Yasak Kaldırılması (Unban)
  {
    name: Events.GuildBanRemove,
    async execute(ban) {
      serverLogManager.logBanRemove(ban);
    },
  },

  // 7. Ses Kanalı Hareketleri (Katılma, Ayrılma, Değiştirme, Susturma, Yayın, Kamera)
  {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
      serverLogManager.logVoiceStateUpdate(oldState, newState);
    },
  },

  // 8. Kanal Oluşturuldu
  {
    name: Events.ChannelCreate,
    async execute(channel) {
      serverLogManager.logChannelCreate(channel);
    },
  },

  // 9. Kanal Silindi
  {
    name: Events.ChannelDelete,
    async execute(channel) {
      serverLogManager.logChannelDelete(channel);
    },
  },

  // 10. Kanal Ayarları Güncellendi
  {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
      serverLogManager.logChannelUpdate(oldChannel, newChannel);
    },
  },

  // 11. Rol Oluşturuldu
  {
    name: Events.GuildRoleCreate,
    async execute(role) {
      serverLogManager.logRoleCreate(role);
    },
  },

  // 12. Rol Silindi
  {
    name: Events.GuildRoleDelete,
    async execute(role) {
      serverLogManager.logRoleDelete(role);
    },
  },

  // 13. Rol Güncellendi
  {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
      serverLogManager.logRoleUpdate(oldRole, newRole);
    },
  },

  // 14. Emoji Eklendi
  {
    name: Events.GuildEmojiCreate,
    async execute(emoji) {
      serverLogManager.logEmojiCreate(emoji);
    },
  },

  // 15. Emoji Silindi
  {
    name: Events.GuildEmojiDelete,
    async execute(emoji) {
      serverLogManager.logEmojiDelete(emoji);
    },
  },

  // 16. Emoji Güncellendi
  {
    name: Events.GuildEmojiUpdate,
    async execute(oldEmoji, newEmoji) {
      serverLogManager.logEmojiUpdate(oldEmoji, newEmoji);
    },
  },

  // 17. Çıkartma (Sticker) Eklendi
  {
    name: Events.GuildStickerCreate,
    async execute(sticker) {
      serverLogManager.logStickerCreate(sticker);
    },
  },

  // 18. Çıkartma Silindi
  {
    name: Events.GuildStickerDelete,
    async execute(sticker) {
      serverLogManager.logStickerDelete(sticker);
    },
  },

  // 19. Çıkartma Güncellendi
  {
    name: Events.GuildStickerUpdate,
    async execute(oldSticker, newSticker) {
      serverLogManager.logStickerUpdate(oldSticker, newSticker);
    },
  },

  // 20. Davet Oluşturuldu
  {
    name: Events.InviteCreate,
    async execute(invite) {
      serverLogManager.logInviteCreate(invite);
    },
  },

  // 21. Davet Silindi
  {
    name: Events.InviteDelete,
    async execute(invite) {
      serverLogManager.logInviteDelete(invite);
    },
  },

  // 22. Sunucu Ayarları Güncellendi
  {
    name: Events.GuildUpdate,
    async execute(oldGuild, newGuild) {
      serverLogManager.logGuildUpdate(oldGuild, newGuild);
    },
  },

  // 23. Alt Başlık (Thread) Açıldı
  {
    name: Events.ThreadCreate,
    async execute(thread) {
      serverLogManager.logThreadCreate(thread);
    },
  },

  // 24. Alt Başlık Silindi
  {
    name: Events.ThreadDelete,
    async execute(thread) {
      serverLogManager.logThreadDelete(thread);
    },
  },

  // 25. Alt Başlık Güncellendi
  {
    name: Events.ThreadUpdate,
    async execute(oldThread, newThread) {
      serverLogManager.logThreadUpdate(oldThread, newThread);
    },
  },

  // 26. Webhook İşlemleri
  {
    name: Events.WebhooksUpdate,
    async execute(channel) {
      serverLogManager.logWebhooksUpdate(channel);
    },
  },
];
