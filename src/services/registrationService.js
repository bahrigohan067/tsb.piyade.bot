const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');

const config = require('../../config');
const database = require('../utils/database');
const robloxService = require('./roblox');

/**
 * Kayıt Başvurusunu Oluşturan Çekirdek Servis (Discord & Web API ortak)
 */
async function createRegistrationApplication({
  guild,
  member,
  user,
  realName,
  gender,
  robloxInput,
  source = 'discord',
}) {
  if (!guild || !member || !user) {
    return { success: false, code: 'INVALID_MEMBER', message: 'Geçersiz sunucu veya üye bilgisi.' };
  }

  // 1. Zaten Kayıtlı mı?
  if (member.roles.cache.has(config.ROLES.REGISTERED_CHECK)) {
    return {
      success: false,
      code: 'ALREADY_REGISTERED',
      message: 'Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.',
    };
  }

  // 2. Aktif Başvuru Kontrolü
  const activeApp = database.getActiveApplication(user.id);
  if (activeApp && activeApp.threadId) {
    const existingThread = await guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (existingThread) {
      return {
        success: false,
        code: 'ACTIVE_APPLICATION',
        message: `Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
        threadId: activeApp.threadId,
      };
    } else {
      database.removeActiveApplication(user.id);
    }
  }

  // 3. Roblox API Doğrulaması
  const robloxResult = await robloxService.resolveUser(robloxInput);

  if (!robloxResult.success) {
    if (robloxResult.error === 'NOT_FOUND') {
      try {
        await user.send(
          `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
          `**Sebep:** Belirtilen Roblox hesabı bulunamadı.\n` +
          `📌 **Önemli Bilgi:** Lütfen Roblox'taki görünen adınızı (Display Name) değil, profilinizdeki asıl **@kullanıcı** adınızı, ID'nizi veya profil linkinizi yazarak tekrar başvurunuz.`
        ).catch(() => {});
      } catch (e) {}

      return {
        success: false,
        code: 'ROBLOX_NOT_FOUND',
        message: 'Girilen Roblox hesabı bulunamadı! Lütfen profilinizdeki asıl @kullanıcı adınızı, ID\'nizi veya linkinizi giriniz.',
      };
    }

    if (robloxResult.error === 'BANNED') {
      try {
        await user.send(
          `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
          `**Sebep:** Belirtilen Roblox hesabı Roblox platformunda kalıcı olarak yasaklanmıştır (Banned). Yasaklı hesaplarla sunucumuza kayıt olunamaz.`
        ).catch(() => {});
      } catch (e) {}

      return {
        success: false,
        code: 'ROBLOX_BANNED',
        message: 'Bu Roblox hesabı platform üzerinde kalıcı olarak yasaklanmıştır (Banned)!',
      };
    }

    return {
      success: false,
      code: 'ROBLOX_ERROR',
      message: robloxResult.message || 'Roblox doğrulaması yapılamadı.',
    };
  }

  const robloxUser = robloxResult.user;

  // 4. Multi-Hesap (Tekil Kimlik) Koruması
  const existingReg = database.getRegistrationByRobloxId(robloxUser.id);
  if (existingReg && String(existingReg.discordId) !== String(user.id)) {
    return {
      success: false,
      code: 'MULTI_ACCOUNT',
      message: `Bu Roblox hesabı ([${robloxUser.name}](https://www.roblox.com/users/${robloxUser.id}/profile)) sunucumuzda başka bir Discord kullanıcısına (<@${existingReg.discordId}>) zaten kayıtlıdır!`,
    };
  }

  // 5. Özel Kayıt Odası (Thread) Oluşturma
  const registerChannel = guild.channels.cache.get(config.CHANNELS.REGISTER);
  if (!registerChannel) {
    return {
      success: false,
      code: 'CHANNEL_NOT_FOUND',
      message: 'Kayıt kanalı bulunamadı!',
    };
  }

  let thread;
  try {
    thread = await registerChannel.threads.create({
      name: `🟡・${user.username}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `Özel Kayıt Odası - ${realName} (${user.tag}) [${source}]`,
    });
  } catch (err) {
    try {
      thread = await registerChannel.threads.create({
        name: `🟡・${user.username}`,
        autoArchiveDuration: 1440,
        type: ChannelType.PublicThread,
        reason: `Özel Kayıt Odası - ${realName} (${user.tag}) [${source}]`,
      });
    } catch (createErr) {
      console.error('[THREAD ERROR] Kayıt odası oluşturulamadı:', createErr);
      return {
        success: false,
        code: 'THREAD_CREATE_ERROR',
        message: 'Özel kayıt odası oluşturulurken bir hata meydana geldi. Lütfen yetkililer ile iletişime geçiniz.',
      };
    }
  }

  await thread.members.add(user.id).catch(() => {});

  const threadInfoEmbed = new EmbedBuilder()
    .setTitle('🟡 Başvuru İnceleniyor...')
    .setColor(config.COLORS.PENDING)
    .setDescription(
      `👋 Hoş geldin <@${user.id}>!\n\n` +
      `📋 **Kayıt İşleyişi Bilgilendirmesi:**\n` +
      `• Bilgileriniz ve Roblox profiliniz başarıyla doğrulandı.\n` +
      (source === 'site' ? `• Başvuru kaynağı: **Web Sitesi Kayıt Formu** 🌐\n` : '') +
      `• Başvurunuz yetkili onay kanalına iletildi.\n` +
      `• Yetkililerimiz onayladığında rolleriniz otomatik olarak tanımlanacak ve odanız silinecektir.\n` +
      `• Başvurunuz reddedilirse, red sebebi bu odadan ve DM üzerinden size bildirilecektir.\n\n` +
      `⏳ *Lütfen yetkili kararını sabırla bekleyiniz.*`
    )
    .setFooter({ text: `Piyade Team • Kayıt Sistemi${source === 'site' ? ' • Web Kayıt' : ''}` })
    .setTimestamp();

  await thread.send({
    content: `<@${user.id}>`,
    embeds: [threadInfoEmbed],
  }).catch(() => {});

  // 6. Yetkili Onay Kartı Gönderme
  const staffChannel = guild.channels.cache.get(config.CHANNELS.STAFF_APPROVAL);
  let staffMessage = null;

  if (staffChannel) {
    const staffEmbed = new EmbedBuilder()
      .setTitle('📋 Yeni Kayıt Başvurusu' + (source === 'site' ? ' (Web Sitesi)' : ''))
      .setColor(config.COLORS.PENDING)
      .setThumbnail(robloxUser.avatarUrl)
      .addFields(
        { name: '👤 Discord Kullanıcısı', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
        { name: '🆔 Discord ID', value: `\`${user.id}\``, inline: true },
        { name: '📝 Gerçek Adı', value: `${realName}`, inline: true },
        { name: '🚻 Cinsiyet', value: `${gender}`, inline: true },
        {
          name: '📅 Discord Hesap Açılış Tarihi',
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`,
          inline: false,
        },
        {
          name: '📥 Sunucuya Katılış Tarihi',
          value: member.joinedTimestamp
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
            : '`Bilinmiyor`',
          inline: false,
        },
        {
          name: '🎮 Roblox Kullanıcı Adı',
          value: `[${robloxUser.name} (@${robloxUser.displayName})](https://www.roblox.com/users/${robloxUser.id}/profile)`,
          inline: true,
        },
        { name: '🆔 Roblox ID', value: `\`${robloxUser.id}\``, inline: true },
        {
          name: '🔗 Profil Linki',
          value: `[Profili Görüntüle](https://www.roblox.com/users/${robloxUser.id}/profile)`,
          inline: true,
        },
        { name: '🧵 Özel Kayıt Odası', value: `<#${thread.id}>`, inline: true },
        { name: '🌐 Başvuru Kaynağı', value: source === 'site' ? '`Web Sitesi Formu`' : '`Discord Paneli`', inline: true }
      )
      .setFooter({ text: 'Piyade Team • Yetkili Onay Sistemi' })
      .setTimestamp();

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_approve_${user.id}`)
        .setLabel('✅ ONAYLA')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`btn_reject_${user.id}`)
        .setLabel('✖️ REDDET')
        .setStyle(ButtonStyle.Danger)
    );

    staffMessage = await staffChannel.send({
      content: `<@&${config.ROLES.STAFF}>`,
      embeds: [staffEmbed],
      components: [buttonsRow],
    }).catch(() => null);
  }

  // 7. Aktif Başvuruyu Veritabanına Kaydet
  database.setActiveApplication(user.id, {
    threadId: thread.id,
    realName,
    gender,
    robloxId: robloxUser.id,
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
    staffMessageId: staffMessage ? staffMessage.id : null,
    staffChannelId: staffChannel ? staffChannel.id : null,
    source,
  });

  return {
    success: true,
    message: 'Başvurunuz başarıyla alındı! Size özel kayıt odası açıldı.',
    threadId: thread.id,
    threadUrl: thread.url,
    robloxUser: {
      id: robloxUser.id,
      name: robloxUser.name,
      displayName: robloxUser.displayName,
      profileUrl: `https://www.roblox.com/users/${robloxUser.id}/profile`,
      avatarUrl: robloxUser.avatarUrl,
    },
  };
}

module.exports = {
  createRegistrationApplication,
};
