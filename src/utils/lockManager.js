const { EmbedBuilder, OverwriteType } = require('discord.js');
const config = require('../../config');
const database = require('./database');

const LOCK_ROLE_IDS = config.ROLES.LOCK_AUTHORITIES || [
  '1559614111128490044', // Yönetmenlik
  '1561777507223601353', // Developer
  '1559604770396967022', // Üst Yetkili
];

/**
 * Kullanıcının !lock / !unlock komutlarını kullanma ve kilitli kanalda yazma yetkisi olup olmadığını kontrol eder.
 * Sadece 1559614111128490044, 1561777507223601353 ve 1559604770396967022 rollerine sahip olanlar yetkilidir.
 */
function hasLockAuthority(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return LOCK_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Kilitli bir kanala yetkisiz bir üye mesaj gönderirse anında siler (Ek Güvenlik Katmanı).
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} Mesaj silindiyse true, serbestse false döner.
 */
async function enforceLockedChannelMessage(message) {
  if (!message || !message.guild || !message.channel || message.author?.bot) return false;

  const channelId = message.channel.id;
  const parentId = message.channel.parentId;

  const isLocked =
    Boolean(database.getLockedChannel(channelId)) ||
    (message.channel.isThread?.() && Boolean(database.getLockedChannel(parentId)));

  if (!isLocked) return false;

  let member = message.member;
  if (!member) {
    member = await message.guild.members.fetch(message.author.id).catch(() => null);
  }

  // Sadece izin verilen 3 rolden birine sahipse yazabilir
  if (hasLockAuthority(member)) {
    return false;
  }

  try {
    await message.delete();
  } catch (err) {
    // Mesaj zaten silinmiş olabilir
  }
  return true;
}

/**
 * !lock Komutunu İşler
 * @param {import('discord.js').Message} message
 */
async function handleLockCommand(message) {
  let member = message.member;
  if (!member && message.guild) {
    member = await message.guild.members.fetch(message.author.id).catch(() => null);
  }

  const roleMentions = LOCK_ROLE_IDS.map((id) => `<@&${id}>`).join(', ');

  // 1. Yetki Kontrolü (Sadece belirlenen 3 rol kullanabilir)
  if (!hasLockAuthority(member)) {
    const errorMsg = await message
      .reply({
        content: `❌ Bu komutu yalnızca ${roleMentions} rollerine sahip yetkililer kullanabilir!`,
        allowedMentions: { parse: [], repliedUser: true },
      })
      .catch(() => null);

    setTimeout(() => {
      message.delete().catch(() => {});
      if (errorMsg) errorMsg.delete().catch(() => {});
    }, 5000);
    return;
  }

  const channel = message.channel;

  try {
    // Komut mesajını temizle
    await message.delete().catch(() => {});

    // Mevcut kanal izinlerinin yedeğini (snapshot) henüz kilitli değilse kaydet
    const existingLock = database.getLockedChannel(channel.id);
    let snapshot = existingLock?.overwrites || null;

    if (!snapshot && channel.permissionOverwrites?.cache) {
      snapshot = channel.permissionOverwrites.cache.map((ow) => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield.toString(),
        deny: ow.deny.bitfield.toString(),
      }));
    }

    // 2. Discord Kanal İzinlerini Güncelle
    if (channel.permissionOverwrites) {
      const reason = `Kanal kilitlendi (!lock - Yetkili: ${message.author.tag})`;

      // a) @everyone için mesaj yazmayı ve alt başlık oluşturmayı kapat
      await channel.permissionOverwrites
        .edit(
          message.guild.id,
          {
            SendMessages: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
          },
          { reason }
        )
        .catch(() => {});

      // b) Kayıtlı üye rolleri ve kanalda mevcut izin tanımlı diğer tüm rolleri (3 yetkili rol hariç) kapat
      const rolesToRestrict = new Set([
        ...(config.ROLES.APPROVED_ROLES || []),
        config.ROLES.REGISTERED_CHECK,
        config.ROLES.OTHER_CLAN,
        config.ROLES.UNREGISTERED,
      ].filter(Boolean));

      if (channel.permissionOverwrites.cache) {
        channel.permissionOverwrites.cache.forEach((ow) => {
          if (
            ow.type === OverwriteType.Role &&
            ow.id !== message.guild.id &&
            !LOCK_ROLE_IDS.includes(ow.id)
          ) {
            rolesToRestrict.add(ow.id);
          }
        });
      }

      for (const roleId of rolesToRestrict) {
        if (LOCK_ROLE_IDS.includes(roleId)) continue;
        if (!message.guild.roles.cache.has(roleId)) continue;

        await channel.permissionOverwrites
          .edit(
            roleId,
            {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
            },
            { reason }
          )
          .catch(() => {});
      }

      // c) Sadece belirlenen 3 yetkili rolüne yazma izni ver
      for (const allowedRoleId of LOCK_ROLE_IDS) {
        if (!message.guild.roles.cache.has(allowedRoleId)) continue;

        await channel.permissionOverwrites
          .edit(
            allowedRoleId,
            {
              SendMessages: true,
              SendMessagesInThreads: true,
            },
            { reason }
          )
          .catch(() => {});
      }

      // d) Botun kendisi mesaj gönderebilsin
      if (message.client?.user?.id) {
        await channel.permissionOverwrites
          .edit(
            message.client.user.id,
            {
              ViewChannel: true,
              SendMessages: true,
              SendMessagesInThreads: true,
            },
            { reason }
          )
          .catch(() => {});
      }
    }

    // 3. Veritabanına Kilit Durumunu Kaydet
    database.setLockedChannel(channel.id, {
      channelId: channel.id,
      lockedBy: message.author.id,
      lockedAt: Date.now(),
      overwrites: snapshot,
    });

    // 4. Kanalda Bilgilendirme Mesajı Gönder
    const lockEmbed = new EmbedBuilder()
      .setTitle('🔒 Kanal Kilitlendi / Channel Locked')
      .setColor(config.COLORS.DANGER)
      .setDescription(
        `🇹🇷 Bu kanal <@${message.author.id}> tarafından **kilitlenmiştir**.\n` +
        `> Kanal kilidi açılana kadar yalnızca ${roleMentions} rollerine sahip yetkililer mesaj gönderebilir.\n\n` +
        `🇬🇧 This channel has been **locked** by <@${message.author.id}>.\n` +
        `> Only authorized staff members can send messages until the channel is unlocked.`
      )
      .setFooter({ text: 'Piyade Team • Kanal Yönetim Sistemi (!unlock ile açılabilir)' })
      .setTimestamp();

    await channel.send({
      embeds: [lockEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[LOCK KOMUTU HATASI]:', err);
    const errMsg = await channel
      .send({
        content: `❌ Kanal kilitlenirken bir hata oluştu: ${err.message}`,
      })
      .catch(() => null);

    if (errMsg) {
      setTimeout(() => errMsg.delete().catch(() => {}), 5000);
    }
  }
}

/**
 * !unlock Komutunu İşler
 * @param {import('discord.js').Message} message
 */
async function handleUnlockCommand(message) {
  let member = message.member;
  if (!member && message.guild) {
    member = await message.guild.members.fetch(message.author.id).catch(() => null);
  }

  const roleMentions = LOCK_ROLE_IDS.map((id) => `<@&${id}>`).join(', ');

  // 1. Yetki Kontrolü (Sadece belirlenen 3 rol kullanabilir)
  if (!hasLockAuthority(member)) {
    const errorMsg = await message
      .reply({
        content: `❌ Bu komutu yalnızca ${roleMentions} rollerine sahip yetkililer kullanabilir!`,
        allowedMentions: { parse: [], repliedUser: true },
      })
      .catch(() => null);

    setTimeout(() => {
      message.delete().catch(() => {});
      if (errorMsg) errorMsg.delete().catch(() => {});
    }, 5000);
    return;
  }

  const channel = message.channel;

  try {
    // Komut mesajını temizle
    await message.delete().catch(() => {});

    const lockData = database.getLockedChannel(channel.id);

    // 2. Kanal İzinlerini Önceki Haline Döndür
    if (channel.permissionOverwrites) {
      const reason = `Kanal kilidi açıldı (!unlock - Yetkili: ${message.author.tag})`;

      if (lockData && Array.isArray(lockData.overwrites) && lockData.overwrites.length > 0) {
        // Kaydedilmiş orijinal kanal izinlerini birebir geri yükle
        const restoredOverwrites = lockData.overwrites.map((ow) => ({
          id: ow.id,
          type: ow.type,
          allow: BigInt(ow.allow),
          deny: BigInt(ow.deny),
        }));

        await channel.permissionOverwrites.set(restoredOverwrites, reason).catch(async () => {
          // set başarısız olursa tek tek düzelt
          await fallbackUnlockOverwrites(channel, message.guild, reason);
        });
      } else {
        await fallbackUnlockOverwrites(channel, message.guild, reason);
      }
    }

    // 3. Veritabanından Kilit Kaydını Sil
    database.removeLockedChannel(channel.id);

    // 4. Kanalda Bilgilendirme Mesajı Gönder
    const unlockEmbed = new EmbedBuilder()
      .setTitle('🔓 Kanal Kilidi Açıldı / Channel Unlocked')
      .setColor(config.COLORS.SUCCESS)
      .setDescription(
        `🇹🇷 Bu kanalın kilidi <@${message.author.id}> tarafından **açılmıştır**.\n` +
        `> Üyelerimiz kurallar çerçevesinde tekrar mesaj gönderebilir.\n\n` +
        `🇬🇧 This channel has been **unlocked** by <@${message.author.id}>.\n` +
        `> Members can send messages again.`
      )
      .setFooter({ text: 'Piyade Team • Kanal Yönetim Sistemi' })
      .setTimestamp();

    await channel.send({
      embeds: [unlockEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[UNLOCK KOMUTU HATASI]:', err);
    const errMsg = await channel
      .send({
        content: `❌ Kanal kilidi açılırken bir hata oluştu: ${err.message}`,
      })
      .catch(() => null);

    if (errMsg) {
      setTimeout(() => errMsg.delete().catch(() => {}), 5000);
    }
  }
}

/**
 * Yedek (Snapshot) bulunmayan durumlarda kanal izinlerini normale döndürür
 */
async function fallbackUnlockOverwrites(channel, guild, reason) {
  await channel.permissionOverwrites
    .edit(
      guild.id,
      {
        SendMessages: null,
        SendMessagesInThreads: null,
        CreatePublicThreads: null,
        CreatePrivateThreads: null,
      },
      { reason }
    )
    .catch(() => {});

  const memberRoles = new Set([
    ...(config.ROLES.APPROVED_ROLES || []),
    config.ROLES.REGISTERED_CHECK,
    config.ROLES.OTHER_CLAN,
  ].filter(Boolean));

  for (const roleId of memberRoles) {
    if (!guild.roles.cache.has(roleId)) continue;
    await channel.permissionOverwrites
      .edit(
        roleId,
        {
          SendMessages: null,
          SendMessagesInThreads: null,
          CreatePublicThreads: null,
          CreatePrivateThreads: null,
        },
        { reason }
      )
      .catch(() => {});
  }
}

module.exports = {
  LOCK_ROLE_IDS,
  hasLockAuthority,
  enforceLockedChannelMessage,
  handleLockCommand,
  handleUnlockCommand,
};
