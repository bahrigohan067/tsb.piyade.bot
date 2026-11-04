const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config');

/**
 * Medya Kanalı Denetim Yöneticisi
 * - Sadece belirlenen medya kanalındaki (config.CHANNELS.MEDIA) mesajları inceler.
 * - Botlar ve Üst Yönetim / Kurucu muaf tutulur.
 * - Ek dosya (foto/video/gif/ses), link veya embed içermeyen düz metin mesajlarını anında siler.
 * - Kullanıcıyı etiketleyerek geçici bir uyarı gönderir ve 5 saniye sonra bu uyarıyı siler.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} Mesaj silinip işlem yapıldıysa true, serbest bırakıldıysa false döner.
 */
async function handleMediaChannel(message) {
  // Sadece hedeflenen medya kanalını denetle
  const mediaChannelId = config.CHANNELS.MEDIA;
  if (!mediaChannelId) return false;

  const currentChannelId = message.channelId || message.channel?.id;
  if (currentChannelId !== mediaChannelId) {
    return false;
  }

  // 1. Bot Kontrolü: Bot mesajları (bildirim, duyuru vb.) etkilenmez
  if (message.author?.bot) {
    return false;
  }

  // 2. Yönetim Muafiyeti (Kurucu veya Üst Yönetim)
  let member = message.member;
  if (!member && message.guild) {
    member = await message.guild.members.fetch(message.author.id).catch(() => null);
  }

  const isOwner = message.guild?.ownerId === message.author.id;
  const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
  const exemptRoles = config.ROLES.MEDIA_EXEMPT || [
    '1559614111128490044', // Yönetmenlik
    '1561777507223601353', // Kurucu / Developer
  ];
  const hasExemptRole = Boolean(member && exemptRoles.some((rId) => member.roles.cache.has(rId)));

  if (isOwner || isAdmin || hasExemptRole) {
    return false; // Yetkililerin mesajı hiçbir şekilde silinmez
  }

  // 3. İçerik Analizi
  // Ek Dosya Var mı? (fotoğraf, video, GIF, ses vb.)
  const hasAttachment = Boolean(message.attachments && message.attachments.size > 0);

  // Web Bağlantısı (Link) Var mı? (http://, https:// veya www. ile başlayan linkler: YouTube, Streamable, Tenor, Imgur vb.)
  const content = message.content || '';
  const linkRegex = /(?:https?:\/\/|www\.)\S+/i;
  const hasLink = linkRegex.test(content) ||
    content.split(/\s+/).some((w) => /^https?:\/\//i.test(w) || /^www\./i.test(w));

  // Gömülü İçerik (Embed) Var mı? (link önizlemesi veya bot embed'i)
  const hasEmbed = Boolean(message.embeds && message.embeds.length > 0);

  // Discord Çıkartması (Sticker) Var mı?
  const hasSticker = Boolean(message.stickers && message.stickers.size > 0);

  // Dosya eki, link veya embed varsa (yanında açıklama yazısı olsa dahi) serbesttir
  if (hasAttachment || hasLink || hasEmbed || hasSticker) {
    return false;
  }

  // 4. Silme ve Geçici Uyarı Mekanizması
  // Düz metin / sohbet mesajını anında sil
  try {
    await message.delete();
  } catch (err) {
    console.error('[MEDYA KANALI] Mesaj silinirken hata oluştu:', err.message);
  }

  // Kullanıcıya etiketli geçici uyarı gönder
  try {
    const warnMsg = await message.channel.send({
      content: `<@${message.author.id}> Bu kanal sadece medya içindir. Yazı yazamazsın! / This channel is for media only, text messages are not allowed!`,
    });

    // Kanal temizliği (delete_after=5): 5 saniye sonra uyarı mesajını otomatik sil
    if (warnMsg) {
      setTimeout(() => {
        warnMsg.delete().catch(() => {});
      }, 5000);
    }
  } catch (err) {
    console.error('[MEDYA KANALI] Uyarı mesajı gönderilirken hata oluştu:', err.message);
  }

  return true;
}

module.exports = {
  handleMediaChannel,
};
