const { EmbedBuilder } = require('discord.js');
const config = require('../../../config');

/**
 * Web sitesi paneli üzerinden yapılan yönetim işlemlerini WARNING_LOG kanalına denetim logu olarak gönderir.
 */
async function sendWebAuditLog(guild, { actor, target = null, action, details = '', warnId = null, extraFields = [] }) {
  if (!guild) return;

  const logChannel =
    guild.channels.cache.get(config.CHANNELS.WARNING_LOG) ||
    (await guild.channels.fetch(config.CHANNELS.WARNING_LOG).catch(() => null));

  if (!logChannel) {
    console.warn('[WEB AUDIT LOG] Uyarı log kanalı bulunamadı!');
    return;
  }

  const actorTag = actor.tag || actor.username || actor.id;
  const targetTag = target ? (target.tag || target.username || target.id) : null;

  const embed = new EmbedBuilder()
    .setTitle('🌐 Web Paneli Denetim Logu')
    .setColor(0x5865F2) // Discord Blurple
    .setDescription(
      `Web yönetim paneli üzerinden yeni bir idari işlem gerçekleştirildi.\n\n` +
      `• **İşlemi Yapan Yetkili:** <@${actor.id}> (\`${actorTag}\`)\n` +
      (target ? `• **Hedef Kullanıcı:** <@${target.id}> (\`${targetTag}\`)\n` : '') +
      `• **Yapılan İşlem:** **${action}**\n` +
      (warnId ? `• **Uyarı ID:** \`#${warnId}\`\n` : '') +
      `• **Zaman:** <t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)\n\n` +
      (details ? `>>> **Detaylar:**\n${details}` : '')
    )
    .setFooter({
      text: `Piyade Team • Web Panel Denetim Sistemi • Kaynak: Web API`,
    })
    .setTimestamp();

  if (Array.isArray(extraFields) && extraFields.length > 0) {
    embed.addFields(extraFields);
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[WEB AUDIT LOG HATASI]:', err.message);
  }
}

module.exports = {
  sendWebAuditLog,
};
