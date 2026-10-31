const { EmbedBuilder, PermissionFlagsBits, AuditLogEvent, ChannelType } = require('discord.js');
const config = require('../../config');

/**
 * Sunucu Denetim / Log Yöneticisi
 * Mesaj gönderme hariç sunucudaki tüm olayları detaylı biçimde belirtilen kanala loglar.
 */

// ==========================================
// YARDIMCI SÖZLÜKLER VE ÇEVİRİLER
// ==========================================

const CHANNEL_TYPES_TR = {
  0: 'Metin Kanalı (#)',
  2: 'Ses Kanalı (🔊)',
  4: 'Kategori (📁)',
  5: 'Duyuru Kanalı (📢)',
  10: 'Duyuru Alt Başlığı',
  11: 'Herkese Açık Alt Başlık',
  12: 'Özel Alt Başlık',
  13: 'Sahne Kanalı (🎭)',
  15: 'Forum Kanalı (📋)',
  16: 'Medya Kanalı',
};

const PERMISSIONS_TR = {
  Administrator: 'Yönetici',
  ManageGuild: 'Sunucuyu Yönet',
  ManageRoles: 'Rolleri Yönet',
  ManageChannels: 'Kanalları Yönet',
  KickMembers: 'Üyeleri At',
  BanMembers: 'Üyeleri Yasakla',
  CreateInstantInvite: 'Davet Oluştur',
  ChangeNickname: 'Kullanıcı Adı Değiştir',
  ManageNicknames: 'Kullanıcı Adlarını Yönet',
  ManageEmojisAndStickers: 'İfadeleri ve Çıkartmaları Yönet',
  ManageWebhooks: 'Webhookları Yönet',
  ViewAuditLog: 'Denetim Kaydını Görüntüle',
  SendMessages: 'Mesaj Gönder',
  SendMessagesInThreads: 'Alt Başlıklarda Mesaj Gönder',
  ManageMessages: 'Mesajları Yönet',
  EmbedLinks: 'Bağlantı Yerleştir',
  AttachFiles: 'Dosya Ekle',
  ReadMessageHistory: 'Geçmişi Oku',
  MentionEveryone: 'Herkesten Bahset (@everyone)',
  UseExternalEmojis: 'Harici İfadeler Kullan',
  Connect: 'Bağlan (Ses)',
  Speak: 'Konuş (Ses)',
  MuteMembers: 'Üyeleri Sustur',
  DeafenMembers: 'Üyeleri Sağırlaştır',
  MoveMembers: 'Üyeleri Taşı',
  ModerateMembers: 'Zaman Aşımı Uygula (Timeout)',
  Stream: 'Video / Ekran Paylaşımı',
};

const VERIFICATION_LEVELS_TR = {
  0: 'Yok (Güvenlik Koruması Yok)',
  1: 'Düşük (E-posta Onaylı Hesap)',
  2: 'Orta (5 Dakikadan Uzun Süredir Kayıtlı)',
  3: 'Yüksek (10 Dakikadan Uzun Süredir Üye)',
  4: 'En Yüksek (Telefon Onaylı Hesap)',
};

// ==========================================
// TEMEL YARDIMCI FONKSİYONLAR
// ==========================================

function truncate(text, max = 1024) {
  if (!text) return '';
  const str = String(text);
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function formatChannelType(type) {
  return CHANNEL_TYPES_TR[type] || `Kanal (Tür: ${type})`;
}

function formatUser(user) {
  if (!user) return 'Bilinmeyen Kullanıcı';
  return `<@${user.id}> (\`${user.tag || user.username}\` • \`${user.id}\`)`;
}

function formatExecutor(entry, fallback = 'Belirlenemedi / Kullanıcının Kendisi') {
  if (!entry || !entry.executor) return fallback;
  return `<@${entry.executor.id}> (\`${entry.executor.tag || entry.executor.username}\` • \`${entry.executor.id}\`)`;
}

/**
 * Log kanalına embed gönderir.
 */
async function sendServerLog(guild, embed, files = []) {
  if (!guild || !guild.channels) return;
  const channelId = config.CHANNELS.SERVER_LOG;
  if (!channelId) return;

  try {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    await channel.send({ embeds: [embed], files }).catch((err) => {
      console.error('[SUNUCU LOG GÖNDERME HATASI]:', err.message);
    });
  } catch (err) {
    console.error('[SUNUCU LOG KANALI ÇAĞIRMA HATASI]:', err.message);
  }
}

/**
 * Audit Log'dan ilgili son işlemi çeker (500ms gecikme ile).
 */
async function getAuditLogEntry(guild, type, targetId = null, maxAgeMs = 7000) {
  if (!guild) return null;
  const me = guild.members?.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ViewAuditLog) && !me.permissions.has(PermissionFlagsBits.Administrator)) {
    return null;
  }

  try {
    // Discord API'sinin audit logu yazması için kısa gecikme
    await new Promise((r) => setTimeout(r, 500));

    const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
    if (!logs || !logs.entries) return null;

    const now = Date.now();
    const entry = logs.entries.find((e) => {
      const isRecent = (now - e.createdTimestamp) <= maxAgeMs;
      if (!isRecent) return false;
      if (targetId) {
        return e.targetId === targetId || e.target?.id === targetId;
      }
      return true;
    });

    return entry || null;
  } catch {
    return null;
  }
}

// ==========================================
// DETAYLI OLAY LOGLAMA METOTLARI
// ==========================================

/**
 * 1. Mesaj Silindi
 */
async function logMessageDelete(message) {
  try {
    if (!message || !message.guild) return;
    if (message.guild.id !== config.GUILD_ID) return;
    if (message.channelId === config.CHANNELS.SERVER_LOG) return;
    if (message.author?.bot) return; // Botların kendi geçici mesaj silmelerini yoksay

    const audit = await getAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, message.author?.id, 6000);
    const executorText = audit ? formatExecutor(audit) : 'Kullanıcının Kendisi veya Belirlenemedi';

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Mesaj Silindi')
      .setAuthor({
        name: `${message.author?.tag || 'Bilinmeyen Kullanıcı'}`,
        iconURL: message.author?.displayAvatarURL({ dynamic: true }) || undefined,
      })
      .addFields(
        { name: '👤 Mesaj Sahibi', value: formatUser(message.author), inline: true },
        { name: '📁 Kanal', value: `<#${message.channelId}> (\`#${message.channel?.name || 'bilinmiyor'}\`)`, inline: true },
        { name: '👮 Silen Kişi / Yetkili', value: executorText, inline: false },
        {
          name: '💬 Silinen Mesaj İçeriği',
          value: message.content ? truncate(message.content, 1024) : '*İçerik önbellekte yok veya yalnızca görsel/ek içeriyordu.*',
          inline: false,
        }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Mesaj ID: ${message.id}` })
      .setTimestamp();

    // Ekli dosya/görseller varsa
    if (message.attachments && message.attachments.size > 0) {
      const attList = message.attachments.map((a, i) => `${i + 1}. [${a.name}](${a.url})`).join('\n');
      embed.addFields({ name: `📎 Ekler (${message.attachments.size})`, value: truncate(attList, 1024), inline: false });

      const firstImage = message.attachments.find((a) => a.contentType && a.contentType.startsWith('image/'));
      if (firstImage) {
        embed.setImage(firstImage.proxyURL || firstImage.url);
      }
    }

    await sendServerLog(message.guild, embed);
  } catch (err) {
    console.error('[LOG - MESAJ SİLME HATASI]:', err.message);
  }
}

/**
 * 2. Mesaj Düzenlendi
 */
async function logMessageUpdate(oldMessage, newMessage) {
  try {
    if (!newMessage || !newMessage.guild) return;
    if (newMessage.guild.id !== config.GUILD_ID) return;
    if (newMessage.channelId === config.CHANNELS.SERVER_LOG) return;
    if (newMessage.author?.bot) return;
    if (oldMessage && oldMessage.content === newMessage.content) return; // İçerik değişmemişse (embed önizlemesi vb.)

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('✏️ Mesaj Düzenlendi')
      .setAuthor({
        name: `${newMessage.author?.tag || 'Bilinmeyen Kullanıcı'}`,
        iconURL: newMessage.author?.displayAvatarURL({ dynamic: true }) || undefined,
      })
      .addFields(
        { name: '👤 Mesaj Sahibi', value: formatUser(newMessage.author), inline: true },
        { name: '📁 Kanal', value: `<#${newMessage.channelId}> (\`#${newMessage.channel?.name || 'bilinmiyor'}\`)`, inline: true },
        {
          name: '📝 Eski Mesaj',
          value: oldMessage?.content ? truncate(oldMessage.content, 1024) : '*Eski içerik önbellekte bulunamadı.*',
          inline: false,
        },
        {
          name: '✨ Yeni Mesaj',
          value: newMessage.content ? truncate(newMessage.content, 1024) : '*Boş*',
          inline: false,
        },
        {
          name: '🔗 Mesaja Git',
          value: `[Mesaja Gitmek İçin Tıklayın](${newMessage.url})`,
          inline: false,
        }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Mesaj ID: ${newMessage.id}` })
      .setTimestamp();

    await sendServerLog(newMessage.guild, embed);
  } catch (err) {
    console.error('[LOG - MESAJ DÜZENLEME HATASI]:', err.message);
  }
}

/**
 * 3. Toplu Mesaj Silindi (!temizle vb.)
 */
async function logMessageBulkDelete(messages, channel) {
  try {
    if (!channel || !channel.guild) return;
    if (channel.guild.id !== config.GUILD_ID) return;
    if (channel.id === config.CHANNELS.SERVER_LOG) return;

    const audit = await getAuditLogEntry(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id, 6000);
    const executorText = audit ? formatExecutor(audit) : 'Belirlenemedi / Bot';

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🧹 Toplu Mesaj Silindi')
      .addFields(
        { name: '📁 Kanal', value: `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
        { name: '📊 Silinen Mesaj Sayısı', value: `**${messages.size}** adet mesaj`, inline: true },
        { name: '👮 İşlemi Yapan Yetkili', value: executorText, inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kanal ID: ${channel.id}` })
      .setTimestamp();

    await sendServerLog(channel.guild, embed);
  } catch (err) {
    console.error('[LOG - TOPLU MESAJ SİLME HATASI]:', err.message);
  }
}

/**
 * 4. Üye Sunucuya Katıldı
 */
async function logMemberAdd(member) {
  try {
    if (!member || !member.guild) return;
    if (member.guild.id !== config.GUILD_ID) return;

    const createdTs = Math.floor(member.user.createdTimestamp / 1000);
    const isNewAccount = Date.now() - member.user.createdTimestamp < 7 * 24 * 60 * 60 * 1000;

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('📥 Yeni Üye Katıldı')
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '👤 Katılan Üye', value: formatUser(member.user), inline: false },
        {
          name: '📅 Hesap Oluşturulma Tarihi',
          value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`,
          inline: false,
        },
        {
          name: '🛡️ Hesap Durumu',
          value: isNewAccount ? '⚠️ **DİKKAT: 7 günden yeni açılmış hesap!**' : '✅ Güvenli / Normal Hesap',
          inline: true,
        },
        {
          name: '🤖 Bot mu?',
          value: member.user.bot ? 'Evet 🤖' : 'Hayır 👤',
          inline: true,
        },
        {
          name: '👥 Toplam Üye Sayısı',
          value: `**${member.guild.memberCount}** üye`,
          inline: true,
        }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
      .setTimestamp();

    await sendServerLog(member.guild, embed);
  } catch (err) {
    console.error('[LOG - ÜYE KATILMA HATASI]:', err.message);
  }
}

/**
 * 5. Üye Sunucudan Ayrıldı / Atıldı (Kick)
 */
async function logMemberRemove(member) {
  try {
    if (!member || !member.guild) return;
    if (member.guild.id !== config.GUILD_ID) return;

    // Kick kontrolü için audit log
    const auditKick = await getAuditLogEntry(member.guild, AuditLogEvent.MemberKick, member.id, 6000);

    if (auditKick) {
      // Üye Kicklendi
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('👢 Üye Sunucudan Atıldı (Kick)')
        .setThumbnail(member.user?.displayAvatarURL({ dynamic: true, size: 256 }) || undefined)
        .addFields(
          { name: '👤 Atılan Üye', value: formatUser(member.user), inline: false },
          { name: '👮 Atan Yetkili', value: formatExecutor(auditKick), inline: true },
          { name: '📋 Atılma Sebebi', value: auditKick.reason || 'Belirtilmedi', inline: true },
          { name: '👥 Kalan Üye Sayısı', value: `**${member.guild.memberCount}** üye`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(member.guild, embed);
      return;
    }

    // Kendi isteğiyle ayrıldı
    const joinedTs = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
    const embed = new EmbedBuilder()
      .setColor(0x95A5A6)
      .setTitle('📤 Üye Sunucudan Ayrıldı')
      .setThumbnail(member.user?.displayAvatarURL({ dynamic: true, size: 256 }) || undefined)
      .addFields(
        { name: '👤 Ayrılan Üye', value: formatUser(member.user), inline: false },
        {
          name: '⏳ Sunucudaki Geçmişi',
          value: joinedTs ? `<t:${joinedTs}:F> tarihinde katılmıştı (<t:${joinedTs}:R>).` : '*Giriş tarihi tespit edilemedi.*',
          inline: false,
        },
        { name: '👥 Kalan Üye Sayısı', value: `**${member.guild.memberCount}** üye`, inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
      .setTimestamp();

    await sendServerLog(member.guild, embed);
  } catch (err) {
    console.error('[LOG - ÜYE AYRILMA HATASI]:', err.message);
  }
}

/**
 * 6. Üye Güncellendi (Takma Ad, Roller, Timeout)
 */
async function logMemberUpdate(oldMember, newMember) {
  try {
    if (!newMember || !newMember.guild) return;
    if (newMember.guild.id !== config.GUILD_ID) return;

    // A. Takma Ad (Nickname) Değişimi
    if (oldMember.nickname !== newMember.nickname) {
      const audit = await getAuditLogEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id, 6000);
      const executorText = audit ? formatExecutor(audit) : 'Kullanıcının Kendisi veya Belirlenemedi';

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📝 Takma Ad (Nickname) Değiştirildi')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(newMember.user), inline: false },
          { name: '⏪ Eski İsim', value: `\`${oldMember.nickname || oldMember.user.username}\``, inline: true },
          { name: '⏩ Yeni İsim', value: `\`${newMember.nickname || newMember.user.username}\``, inline: true },
          { name: '👮 Değiştiren', value: executorText, inline: false }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${newMember.id}` })
        .setTimestamp();

      await sendServerLog(newMember.guild, embed);
    }

    // B. Rol Değişikliği
    const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
      const audit = await getAuditLogEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id, 6000);
      const executorText = audit ? formatExecutor(audit) : 'Belirlenemedi / Bot';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛡️ Üye Rolleri Güncellendi')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(newMember.user), inline: false },
          {
            name: '➕ Eklenen Roller',
            value: addedRoles.size > 0 ? addedRoles.map((r) => `<@&${r.id}>`).join(' ') : '*Yok*',
            inline: false,
          },
          {
            name: '➖ Kaldırılan Roller',
            value: removedRoles.size > 0 ? removedRoles.map((r) => `<@&${r.id}>`).join(' ') : '*Yok*',
            inline: false,
          },
          { name: '👮 İşlemi Yapan Yetkili', value: executorText, inline: false }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${newMember.id}` })
        .setTimestamp();

      await sendServerLog(newMember.guild, embed);
    }

    // C. Zaman Aşımı (Timeout) Durumu
    const wasTimeout = oldMember.isCommunicationDisabled();
    const isTimeout = newMember.isCommunicationDisabled();

    if (!wasTimeout && isTimeout) {
      // Timeout Verildi
      const audit = await getAuditLogEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id, 6000);
      const untilTs = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('⏳ Üyeye Zaman Aşımı (Timeout) Verildi')
        .addFields(
          { name: '👤 Cezalandırılan Üye', value: formatUser(newMember.user), inline: false },
          { name: '⏰ Bitiş Zamanı', value: `<t:${untilTs}:F> (<t:${untilTs}:R>)`, inline: true },
          { name: '👮 Veren Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true },
          { name: '📋 Sebep', value: audit?.reason || 'Belirtilmedi', inline: false }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${newMember.id}` })
        .setTimestamp();

      await sendServerLog(newMember.guild, embed);
    } else if (wasTimeout && !isTimeout) {
      // Timeout Kaldırıldı
      const audit = await getAuditLogEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id, 6000);

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔓 Zaman Aşımı (Timeout) Kaldırıldı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(newMember.user), inline: false },
          { name: '👮 Kaldıran Yetkili', value: audit ? formatExecutor(audit) : 'Süre Doldu / Belirlenemedi', inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${newMember.id}` })
        .setTimestamp();

      await sendServerLog(newMember.guild, embed);
    }
  } catch (err) {
    console.error('[LOG - ÜYE GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 7. Üye Yasaklandı (Ban)
 */
async function logBanAdd(ban) {
  try {
    if (!ban || !ban.guild) return;
    if (ban.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle('🔨 Üye Sunucudan Yasaklandı (Ban)')
      .setThumbnail(ban.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '👤 Yasaklanan Üye', value: formatUser(ban.user), inline: false },
        { name: '👮 Yasaklayan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true },
        { name: '📋 Yasaklama Sebebi', value: audit?.reason || ban.reason || 'Belirtilmedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kullanıcı ID: ${ban.user.id}` })
      .setTimestamp();

    await sendServerLog(ban.guild, embed);
  } catch (err) {
    console.error('[LOG - BAN HATASI]:', err.message);
  }
}

/**
 * 8. Yasak Kaldırıldı (Unban)
 */
async function logBanRemove(ban) {
  try {
    if (!ban || !ban.guild) return;
    if (ban.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🔓 Üyenin Yasağı Kaldırıldı (Unban)')
      .addFields(
        { name: '👤 Yasağı Kalkan Üye', value: formatUser(ban.user), inline: false },
        { name: '👮 Kaldıran Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true },
        { name: '📋 Sebep', value: audit?.reason || 'Belirtilmedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kullanıcı ID: ${ban.user.id}` })
      .setTimestamp();

    await sendServerLog(ban.guild, embed);
  } catch (err) {
    console.error('[LOG - UNBAN HATASI]:', err.message);
  }
}

/**
 * 9. Ses Kanalı Hareketleri (Katılma, Ayrılma, Değiştirme, Sunucu Mute/Deafen, Yayın, Kamera)
 */
async function logVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild || guild.id !== config.GUILD_ID) return;

    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return; // Botların ses hareketlerini filtrele

    // A. Ses Kanalına Katıldı
    if (!oldState.channelId && newState.channelId) {
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔊 Sese Katıldı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ses Kanalı', value: `<#${newState.channelId}> (\`#${newState.channel?.name || 'bilinmiyor'}\`)`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // B. Ses Kanalından Ayrıldı
    if (oldState.channelId && !newState.channelId) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔈 Sesten Ayrıldı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ayrıldığı Ses Kanalı', value: `<#${oldState.channelId}> (\`#${oldState.channel?.name || 'bilinmiyor'}\`)`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // C. Ses Kanalı Değiştirdi
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🔄 Ses Kanalı Değiştirdi')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: false },
          { name: '⏪ Eski Kanal', value: `<#${oldState.channelId}> (\`#${oldState.channel?.name || 'bilinmiyor'}\`)`, inline: true },
          { name: '⏩ Yeni Kanal', value: `<#${newState.channelId}> (\`#${newState.channel?.name || 'bilinmiyor'}\`)`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // D. Sunucu Tarafından Susturma (Server Mute)
    if (oldState.serverMute !== newState.serverMute) {
      const audit = await getAuditLogEntry(guild, AuditLogEvent.MemberUpdate, member.id, 6000);
      const isMuted = newState.serverMute;

      const embed = new EmbedBuilder()
        .setColor(isMuted ? 0xE67E22 : 0x2ECC71)
        .setTitle(isMuted ? '🔇 Sunucu Tarafından Susturuldu (Server Mute)' : '🔊 Sunucu Susturması Kaldırıldı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Bulunduğu Kanal', value: `<#${newState.channelId}>`, inline: true },
          { name: '👮 İşlemi Yapan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // E. Sunucu Tarafından Sağırlaştırma (Server Deafen)
    if (oldState.serverDeaf !== newState.serverDeaf) {
      const audit = await getAuditLogEntry(guild, AuditLogEvent.MemberUpdate, member.id, 6000);
      const isDeaf = newState.serverDeaf;

      const embed = new EmbedBuilder()
        .setColor(isDeaf ? 0xE67E22 : 0x2ECC71)
        .setTitle(isDeaf ? '🔕 Sunucu Tarafından Sağırlaştırıldı (Server Deafen)' : '🔔 Sunucu Sağırlaştırması Kaldırıldı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Bulunduğu Kanal', value: `<#${newState.channelId}>`, inline: true },
          { name: '👮 İşlemi Yapan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // F. Canlı Yayın (Streaming)
    if (!oldState.streaming && newState.streaming) {
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📺 Ses Kanalında Canlı Yayın Başlattı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ses Kanalı', value: `<#${newState.channelId}>`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    } else if (oldState.streaming && !newState.streaming) {
      const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('🛑 Canlı Yayını Sonlandırdı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ses Kanalı', value: `<#${newState.channelId || oldState.channelId}>`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    }

    // G. Kamera (Video)
    if (!oldState.selfVideo && newState.selfVideo) {
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📹 Kamera Açtı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ses Kanalı', value: `<#${newState.channelId}>`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
      return;
    } else if (oldState.selfVideo && !newState.selfVideo) {
      const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('📷 Kamerayı Kapattı')
        .addFields(
          { name: '👤 Kullanıcı', value: formatUser(member.user), inline: true },
          { name: '📁 Ses Kanalı', value: `<#${newState.channelId || oldState.channelId}>`, inline: true }
        )
        .setFooter({ text: `Piyade Team | Denetim Kaydı • Üye ID: ${member.id}` })
        .setTimestamp();

      await sendServerLog(guild, embed);
    }
  } catch (err) {
    console.error('[LOG - SES HAREKETİ HATASI]:', err.message);
  }
}

/**
 * 10. Kanal Oluşturuldu
 */
async function logChannelCreate(channel) {
  try {
    if (!channel || !channel.guild) return;
    if (channel.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('📁 Yeni Kanal Oluşturuldu')
      .addFields(
        { name: '📁 Kanal', value: `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
        { name: '🏷️ Kanal Türü', value: formatChannelType(channel.type), inline: true },
        { name: '📂 Kategori', value: channel.parent ? channel.parent.name : '*Yok*', inline: true },
        { name: '👮 Oluşturan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kanal ID: ${channel.id}` })
      .setTimestamp();

    await sendServerLog(channel.guild, embed);
  } catch (err) {
    console.error('[LOG - KANAL OLUŞTURMA HATASI]:', err.message);
  }
}

/**
 * 11. Kanal Silindi
 */
async function logChannelDelete(channel) {
  try {
    if (!channel || !channel.guild) return;
    if (channel.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Kanal Silindi')
      .addFields(
        { name: '📁 Silinen Kanal', value: `\`#${channel.name}\``, inline: true },
        { name: '🏷️ Kanal Türü', value: formatChannelType(channel.type), inline: true },
        { name: '📂 Bulunduğu Kategori', value: channel.parent ? channel.parent.name : '*Yok*', inline: true },
        { name: '👮 Silen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kanal ID: ${channel.id}` })
      .setTimestamp();

    await sendServerLog(channel.guild, embed);
  } catch (err) {
    console.error('[LOG - KANAL SİLME HATASI]:', err.message);
  }
}

/**
 * 12. Kanal Ayarları Güncellendi
 */
async function logChannelUpdate(oldChannel, newChannel) {
  try {
    if (!newChannel || !newChannel.guild) return;
    if (newChannel.guild.id !== config.GUILD_ID) return;

    const changes = [];

    if (oldChannel.name !== newChannel.name) {
      changes.push(`• **İsim Değişti:** \`#${oldChannel.name}\` ➔ \`#${newChannel.name}\``);
    }
    if (oldChannel.topic !== newChannel.topic) {
      changes.push(`• **Konu (Topic) Değişti:**\n  Eski: \`${oldChannel.topic || 'Yok'}\`\n  Yeni: \`${newChannel.topic || 'Yok'}\``);
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push(`• **Yavaş Mod (Slowmode):** \`${oldChannel.rateLimitPerUser || 0} sn\` ➔ \`${newChannel.rateLimitPerUser || 0} sn\``);
    }
    if (oldChannel.parentId !== newChannel.parentId) {
      changes.push(`• **Kategori Değişti:** \`${oldChannel.parent?.name || 'Yok'}\` ➔ \`${newChannel.parent?.name || 'Yok'}\``);
    }
    if (oldChannel.nsfw !== newChannel.nsfw) {
      changes.push(`• **NSFW:** \`${oldChannel.nsfw ? 'Açık' : 'Kapalı'}\` ➔ \`${newChannel.nsfw ? 'Açık' : 'Kapalı'}\``);
    }

    if (changes.length === 0) return; // İlgili ayarlar değişmemişse yoksay

    const audit = await getAuditLogEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('⚙️ Kanal Ayarları Güncellendi')
      .addFields(
        { name: '📁 Kanal', value: `<#${newChannel.id}> (\`#${newChannel.name}\`)`, inline: true },
        { name: '🏷️ Kanal Türü', value: formatChannelType(newChannel.type), inline: true },
        { name: '📝 Yapılan Değişiklikler', value: changes.join('\n'), inline: false },
        { name: '👮 Güncelleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kanal ID: ${newChannel.id}` })
      .setTimestamp();

    await sendServerLog(newChannel.guild, embed);
  } catch (err) {
    console.error('[LOG - KANAL GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 13. Rol Oluşturuldu
 */
async function logRoleCreate(role) {
  try {
    if (!role || !role.guild) return;
    if (role.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(role.guild, AuditLogEvent.RoleCreate, role.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🎭 Yeni Rol Oluşturuldu')
      .addFields(
        { name: '🛡️ Rol', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
        { name: '🎨 Rengi', value: `\`${role.hexColor}\``, inline: true },
        { name: '👮 Oluşturan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Rol ID: ${role.id}` })
      .setTimestamp();

    await sendServerLog(role.guild, embed);
  } catch (err) {
    console.error('[LOG - ROL OLUŞTURMA HATASI]:', err.message);
  }
}

/**
 * 14. Rol Silindi
 */
async function logRoleDelete(role) {
  try {
    if (!role || !role.guild) return;
    if (role.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(role.guild, AuditLogEvent.RoleDelete, role.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('❌ Rol Silindi')
      .addFields(
        { name: '🛡️ Silinen Rol', value: `\`${role.name}\``, inline: true },
        { name: '🎨 Rengi', value: `\`${role.hexColor}\``, inline: true },
        { name: '👮 Silen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Rol ID: ${role.id}` })
      .setTimestamp();

    await sendServerLog(role.guild, embed);
  } catch (err) {
    console.error('[LOG - ROL SİLME HATASI]:', err.message);
  }
}

/**
 * 15. Rol Güncellendi (İsim, Renk, İzinler)
 */
async function logRoleUpdate(oldRole, newRole) {
  try {
    if (!newRole || !newRole.guild) return;
    if (newRole.guild.id !== config.GUILD_ID) return;

    const changes = [];

    if (oldRole.name !== newRole.name) {
      changes.push(`• **İsim:** \`${oldRole.name}\` ➔ \`${newRole.name}\``);
    }
    if (oldRole.hexColor !== newRole.hexColor) {
      changes.push(`• **Renk:** \`${oldRole.hexColor}\` ➔ \`${newRole.hexColor}\``);
    }
    if (oldRole.hoist !== newRole.hoist) {
      changes.push(`• **Ayrı Göster:** \`${oldRole.hoist ? 'Açık' : 'Kapalı'}\` ➔ \`${newRole.hoist ? 'Açık' : 'Kapalı'}\``);
    }
    if (oldRole.mentionable !== newRole.mentionable) {
      changes.push(`• **Etiketlenebilir:** \`${oldRole.mentionable ? 'Açık' : 'Kapalı'}\` ➔ \`${newRole.mentionable ? 'Açık' : 'Kapalı'}\``);
    }

    // Kritik Yetki Değişimleri
    const addedPerms = oldRole.permissions.missing(newRole.permissions).map((p) => PERMISSIONS_TR[p] || p);
    const removedPerms = newRole.permissions.missing(oldRole.permissions).map((p) => PERMISSIONS_TR[p] || p);

    if (addedPerms.length > 0) {
      changes.push(`• **Eklenen Yetkiler:** ${addedPerms.map((p) => `\`+${p}\``).join(', ')}`);
    }
    if (removedPerms.length > 0) {
      changes.push(`• **Kaldırılan Yetkiler:** ${removedPerms.map((p) => `\`-${p}\``).join(', ')}`);
    }

    if (changes.length === 0) return; // Pozisyon sıralaması gibi önemsiz değişiklikleri yoksay

    const audit = await getAuditLogEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🛡️ Rol Güncellendi')
      .addFields(
        { name: '🛡️ Rol', value: `<@&${newRole.id}> (\`${newRole.name}\`)`, inline: true },
        { name: '📝 Yapılan Değişiklikler', value: changes.join('\n'), inline: false },
        { name: '👮 Güncelleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Rol ID: ${newRole.id}` })
      .setTimestamp();

    await sendServerLog(newRole.guild, embed);
  } catch (err) {
    console.error('[LOG - ROL GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 16. Emoji İşlemleri (Create, Delete, Update)
 */
async function logEmojiCreate(emoji) {
  try {
    if (!emoji || !emoji.guild) return;
    if (emoji.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('😀 Yeni Emoji Eklendi')
      .setThumbnail(emoji.url)
      .addFields(
        { name: '🏷️ Emoji', value: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}> (\`:${emoji.name}:\`)`, inline: true },
        { name: '👮 Ekleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Emoji ID: ${emoji.id}` })
      .setTimestamp();

    await sendServerLog(emoji.guild, embed);
  } catch (err) {
    console.error('[LOG - EMOJİ EKLEME HATASI]:', err.message);
  }
}

async function logEmojiDelete(emoji) {
  try {
    if (!emoji || !emoji.guild) return;
    if (emoji.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Emoji Silindi')
      .addFields(
        { name: '🏷️ Silinen Emoji', value: `\`:${emoji.name}:\``, inline: true },
        { name: '👮 Silen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Emoji ID: ${emoji.id}` })
      .setTimestamp();

    await sendServerLog(emoji.guild, embed);
  } catch (err) {
    console.error('[LOG - EMOJİ SİLME HATASI]:', err.message);
  }
}

async function logEmojiUpdate(oldEmoji, newEmoji) {
  try {
    if (!newEmoji || !newEmoji.guild) return;
    if (newEmoji.guild.id !== config.GUILD_ID) return;
    if (oldEmoji.name === newEmoji.name) return;

    const audit = await getAuditLogEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('✏️ Emoji Güncellendi')
      .setThumbnail(newEmoji.url)
      .addFields(
        { name: '🏷️ Emoji', value: `<${newEmoji.animated ? 'a' : ''}:${newEmoji.name}:${newEmoji.id}>`, inline: true },
        { name: '⏪ Eski İsim', value: `\`:${oldEmoji.name}:\``, inline: true },
        { name: '⏩ Yeni İsim', value: `\`:${newEmoji.name}:\``, inline: true },
        { name: '👮 Güncelleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Emoji ID: ${newEmoji.id}` })
      .setTimestamp();

    await sendServerLog(newEmoji.guild, embed);
  } catch (err) {
    console.error('[LOG - EMOJİ GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 17. Çıkartma (Sticker) İşlemleri
 */
async function logStickerCreate(sticker) {
  try {
    if (!sticker || !sticker.guild) return;
    if (sticker.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(sticker.guild, AuditLogEvent.StickerCreate, sticker.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🎨 Yeni Çıkartma (Sticker) Eklendi')
      .setThumbnail(sticker.url)
      .addFields(
        { name: '🏷️ Çıkartma Adı', value: `\`${sticker.name}\``, inline: true },
        { name: '👮 Ekleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Çıkartma ID: ${sticker.id}` })
      .setTimestamp();

    await sendServerLog(sticker.guild, embed);
  } catch (err) {
    console.error('[LOG - ÇIKARTMA EKLEME HATASI]:', err.message);
  }
}

async function logStickerDelete(sticker) {
  try {
    if (!sticker || !sticker.guild) return;
    if (sticker.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(sticker.guild, AuditLogEvent.StickerDelete, sticker.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Çıkartma (Sticker) Silindi')
      .addFields(
        { name: '🏷️ Silinen Çıkartma', value: `\`${sticker.name}\``, inline: true },
        { name: '👮 Silen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Çıkartma ID: ${sticker.id}` })
      .setTimestamp();

    await sendServerLog(sticker.guild, embed);
  } catch (err) {
    console.error('[LOG - ÇIKARTMA SİLME HATASI]:', err.message);
  }
}

async function logStickerUpdate(oldSticker, newSticker) {
  try {
    if (!newSticker || !newSticker.guild) return;
    if (newSticker.guild.id !== config.GUILD_ID) return;
    if (oldSticker.name === newSticker.name) return;

    const audit = await getAuditLogEntry(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('✏️ Çıkartma Güncellendi')
      .addFields(
        { name: '⏪ Eski İsim', value: `\`${oldSticker.name}\``, inline: true },
        { name: '⏩ Yeni İsim', value: `\`${newSticker.name}\``, inline: true },
        { name: '👮 Güncelleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Çıkartma ID: ${newSticker.id}` })
      .setTimestamp();

    await sendServerLog(newSticker.guild, embed);
  } catch (err) {
    console.error('[LOG - ÇIKARTMA GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 18. Davet İşlemleri (Invite Create / Delete)
 */
async function logInviteCreate(invite) {
  try {
    if (!invite || !invite.guild) return;
    if (invite.guild.id !== config.GUILD_ID) return;

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('📨 Yeni Davet Bağlantısı Oluşturuldu')
      .addFields(
        { name: '🔗 Davet Kodu', value: `[discord.gg/${invite.code}](https://discord.gg/${invite.code}) (\`${invite.code}\`)`, inline: true },
        { name: '📁 Kanal', value: `<#${invite.channelId}>`, inline: true },
        { name: '👤 Oluşturan', value: invite.inviter ? formatUser(invite.inviter) : 'Belirlenemedi', inline: false },
        { name: '📊 Maks Kullanım', value: invite.maxUses ? `${invite.maxUses} kişi` : 'Sınırsız', inline: true },
        { name: '⏳ Geçerlilik Süresi', value: invite.maxAge ? `${Math.floor(invite.maxAge / 60)} dakika` : 'Süresiz', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Davet Kodu: ${invite.code}` })
      .setTimestamp();

    await sendServerLog(invite.guild, embed);
  } catch (err) {
    console.error('[LOG - DAVET OLUŞTURMA HATASI]:', err.message);
  }
}

async function logInviteDelete(invite) {
  try {
    if (!invite || !invite.guild) return;
    if (invite.guild.id !== config.GUILD_ID) return;

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('❌ Davet Bağlantısı Silindi / Süresi Doldu')
      .addFields(
        { name: '🔗 Davet Kodu', value: `\`${invite.code}\``, inline: true },
        { name: '📁 Kanal', value: `<#${invite.channelId}>`, inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Davet Kodu: ${invite.code}` })
      .setTimestamp();

    await sendServerLog(invite.guild, embed);
  } catch (err) {
    console.error('[LOG - DAVET SİLME HATASI]:', err.message);
  }
}

/**
 * 19. Sunucu Ayarları Güncellendi (GuildUpdate)
 */
async function logGuildUpdate(oldGuild, newGuild) {
  try {
    if (!newGuild || newGuild.id !== config.GUILD_ID) return;

    const changes = [];

    if (oldGuild.name !== newGuild.name) {
      changes.push(`• **Sunucu Adı:** \`${oldGuild.name}\` ➔ \`${newGuild.name}\``);
    }
    if (oldGuild.icon !== newGuild.icon) {
      changes.push(`• **Sunucu Simgesi (Icon) Değiştirildi.**`);
    }
    if (oldGuild.banner !== newGuild.banner) {
      changes.push(`• **Sunucu Afişi (Banner) Değiştirildi.**`);
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
      changes.push(`• **AFK Kanalı:** \`${oldGuild.afkChannel?.name || 'Yok'}\` ➔ \`${newGuild.afkChannel?.name || 'Yok'}\``);
    }
    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
      changes.push(`• **AFK Süresi:** \`${oldGuild.afkTimeout / 60} dk\` ➔ \`${newGuild.afkTimeout / 60} dk\``);
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
      changes.push(`• **Doğrulama Seviyesi:** \`${VERIFICATION_LEVELS_TR[oldGuild.verificationLevel] || oldGuild.verificationLevel}\` ➔ \`${VERIFICATION_LEVELS_TR[newGuild.verificationLevel] || newGuild.verificationLevel}\``);
    }

    if (changes.length === 0) return;

    const audit = await getAuditLogEntry(newGuild, AuditLogEvent.GuildUpdate, null, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🏰 Sunucu Ayarları Güncellendi')
      .setThumbnail(newGuild.iconURL({ dynamic: true }) || undefined)
      .addFields(
        { name: '📝 Yapılan Değişiklikler', value: changes.join('\n'), inline: false },
        { name: '👮 Güncelleyen Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Sunucu ID: ${newGuild.id}` })
      .setTimestamp();

    await sendServerLog(newGuild, embed);
  } catch (err) {
    console.error('[LOG - SUNUCU AYARLARI HATASI]:', err.message);
  }
}

/**
 * 20. Alt Başlık (Thread) İşlemleri
 */
async function logThreadCreate(thread) {
  try {
    if (!thread || !thread.guild) return;
    if (thread.guild.id !== config.GUILD_ID) return;

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🧵 Yeni Alt Başlık (Thread) Açıldı')
      .addFields(
        { name: '🧵 Alt Başlık', value: `<#${thread.id}> (\`#${thread.name}\`)`, inline: true },
        { name: '📁 Ana Kanal', value: `<#${thread.parentId}>`, inline: true },
        { name: '👤 Açan Üye', value: thread.ownerId ? `<@${thread.ownerId}>` : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Thread ID: ${thread.id}` })
      .setTimestamp();

    await sendServerLog(thread.guild, embed);
  } catch (err) {
    console.error('[LOG - THREAD AÇILMA HATASI]:', err.message);
  }
}

async function logThreadDelete(thread) {
  try {
    if (!thread || !thread.guild) return;
    if (thread.guild.id !== config.GUILD_ID) return;

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Alt Başlık (Thread) Silindi')
      .addFields(
        { name: '🧵 Silinen Alt Başlık', value: `\`#${thread.name}\``, inline: true },
        { name: '📁 Bulunduğu Ana Kanal', value: `<#${thread.parentId}>`, inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Thread ID: ${thread.id}` })
      .setTimestamp();

    await sendServerLog(thread.guild, embed);
  } catch (err) {
    console.error('[LOG - THREAD SİLME HATASI]:', err.message);
  }
}

async function logThreadUpdate(oldThread, newThread) {
  try {
    if (!newThread || !newThread.guild) return;
    if (newThread.guild.id !== config.GUILD_ID) return;

    const changes = [];
    if (oldThread.name !== newThread.name) {
      changes.push(`• **İsim:** \`#${oldThread.name}\` ➔ \`#${newThread.name}\``);
    }
    if (oldThread.archived !== newThread.archived) {
      changes.push(`• **Arşiv Durumu:** \`${newThread.archived ? 'Arşivlendi 🔒' : 'Arşivden Çıkarıldı 🔓'}\``);
    }
    if (oldThread.locked !== newThread.locked) {
      changes.push(`• **Kilit Durumu:** \`${newThread.locked ? 'Kilitlendi 🔐' : 'Kilidi Açıldı 🔓'}\``);
    }

    if (changes.length === 0) return;

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('🧵 Alt Başlık Güncellendi')
      .addFields(
        { name: '🧵 Alt Başlık', value: `<#${newThread.id}> (\`#${newThread.name}\`)`, inline: true },
        { name: '📁 Ana Kanal', value: `<#${newThread.parentId}>`, inline: true },
        { name: '📝 Yapılan Değişiklikler', value: changes.join('\n'), inline: false }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Thread ID: ${newThread.id}` })
      .setTimestamp();

    await sendServerLog(newThread.guild, embed);
  } catch (err) {
    console.error('[LOG - THREAD GÜNCELLEME HATASI]:', err.message);
  }
}

/**
 * 21. Webhooks Güncellendi
 */
async function logWebhooksUpdate(channel) {
  try {
    if (!channel || !channel.guild) return;
    if (channel.guild.id !== config.GUILD_ID) return;

    const audit = await getAuditLogEntry(channel.guild, AuditLogEvent.WebhookCreate, null, 6000) ||
                  await getAuditLogEntry(channel.guild, AuditLogEvent.WebhookUpdate, null, 6000) ||
                  await getAuditLogEntry(channel.guild, AuditLogEvent.WebhookDelete, null, 6000);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🪝 Webhook İşlemi Tespit Edildi')
      .addFields(
        { name: '📁 Kanal', value: `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
        { name: '👮 İşlemi Yapan Yetkili', value: audit ? formatExecutor(audit) : 'Belirlenemedi', inline: true }
      )
      .setFooter({ text: `Piyade Team | Denetim Kaydı • Kanal ID: ${channel.id}` })
      .setTimestamp();

    await sendServerLog(channel.guild, embed);
  } catch (err) {
    console.error('[LOG - WEBHOOK HATASI]:', err.message);
  }
}

module.exports = {
  sendServerLog,
  getAuditLogEntry,
  logMessageDelete,
  logMessageUpdate,
  logMessageBulkDelete,
  logMemberAdd,
  logMemberRemove,
  logMemberUpdate,
  logBanAdd,
  logBanRemove,
  logVoiceStateUpdate,
  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,
  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,
  logEmojiCreate,
  logEmojiDelete,
  logEmojiUpdate,
  logStickerCreate,
  logStickerDelete,
  logStickerUpdate,
  logInviteCreate,
  logInviteDelete,
  logGuildUpdate,
  logThreadCreate,
  logThreadDelete,
  logThreadUpdate,
  logWebhooksUpdate,
};
