const { Events, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../../config');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    // Botların mesajlarını ve DM'leri yoksay
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();

    // !temizle komutu kontrolü
    if (content.toLowerCase().startsWith('!temizle')) {
      // Yetki Kontrolü (Mesajları Yönet, Yönetici veya Yetkili Rolleri)
      const hasPermission =
        message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
        message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member.roles.cache.has(config.ROLES.STAFF) ||
        message.member.roles.cache.has(config.ROLES.VS_STAFF);

      if (!hasPermission) {
        const errorMsg = await message.reply({
          content: '❌ Bu komutu kullanmak için **Mesajları Yönet** yetkisine sahip olmalısınız!',
        }).catch(() => null);

        // 5 saniye sonra uyarıyı ve komutu temizle
        setTimeout(() => {
          message.delete().catch(() => {});
          if (errorMsg) errorMsg.delete().catch(() => {});
        }, 5000);
        return;
      }

      const args = content.split(/\s+/);
      const rawCount = args[1];

      // Sayı belirtilmemişse
      if (!rawCount) {
        const warnMsg = await message.reply({
          content: '⚠️ Lütfen silinecek mesaj miktarını belirtiniz!\nÖrnek kullanım: `!temizle 20` veya `!temizle 100`',
        }).catch(() => null);

        setTimeout(() => {
          message.delete().catch(() => {});
          if (warnMsg) warnMsg.delete().catch(() => {});
        }, 5000);
        return;
      }

      const count = parseInt(rawCount, 10);

      // Geçersiz sayı veya sıfır/negatif kontrolü
      if (isNaN(count) || count <= 0) {
        const warnMsg = await message.reply({
          content: '⚠️ Lütfen 1 veya daha büyük geçerli bir sayı giriniz!\nÖrnek: `!temizle 50`',
        }).catch(() => null);

        setTimeout(() => {
          message.delete().catch(() => {});
          if (warnMsg) warnMsg.delete().catch(() => {});
        }, 5000);
        return;
      }

      // En fazla tek seferde 300 mesaja kadar izin verelim (Discord rate limit koruması)
      const targetCount = Math.min(count, 300);

      try {
        // Komut yazılan mesajı hemen sil
        await message.delete().catch(() => {});

        let totalDeleted = 0;
        let remaining = targetCount;

        // Discord bulkDelete tek seferde max 100 mesaj silebilir, bu yüzden döngüyle silelim
        while (remaining > 0) {
          const batchSize = Math.min(remaining, 100);
          const deletedCollection = await message.channel.bulkDelete(batchSize, true);
          totalDeleted += deletedCollection.size;

          // Eğer silinen mesaj sayısı istenenden azsa (örneğin kanalda mesaj bitti veya 14 günden eski) dur
          if (deletedCollection.size < batchSize) {
            break;
          }

          remaining -= batchSize;
        }

        let infoText = `🗑️ Başarıyla **${totalDeleted}** adet mesaj temizlendi!`;
        if (totalDeleted < count) {
          infoText += `\n-# ⚠️ Discord kuralları gereği 14 günden eski mesajlar toplu olarak silinemez.`;
        }

        const successMsg = await message.channel.send({
          content: infoText,
        }).catch(() => null);

        // Bilgilendirme mesajını 4 saniye sonra otomatik sil
        if (successMsg) {
          setTimeout(() => {
            successMsg.delete().catch(() => {});
          }, 4000);
        }
      } catch (err) {
        console.error('[TEMİZLE KOMUTU HATASI]:', err);
        const errReply = await message.channel.send({
          content: `❌ Mesajlar silinirken bir hata oluştu: ${err.message}`,
        }).catch(() => null);

        if (errReply) {
          setTimeout(() => {
            errReply.delete().catch(() => {});
          }, 5000);
        }
      }
    }
  },
};
