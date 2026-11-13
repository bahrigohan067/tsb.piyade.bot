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
const { resolveLang, setMemberLanguage, parseGenderInput } = require('../utils/i18n');
const clanMatcher = require('../utils/clanMatcher');

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
  registrationType = 'own',
  clanName = null,
  source = 'discord',
  lang = null,
}) {
  if (!guild || !member || !user) {
    return { success: false, code: 'INVALID_MEMBER', message: 'Geçersiz sunucu veya üye bilgisi.' };
  }

  const userLang = resolveLang(member, lang);
  const isEn = userLang === 'en';

  if (lang === 'en') {
    await setMemberLanguage(member, 'en').catch(() => {});
  }

  const parsedGender = parseGenderInput(gender);
  const normalizedGender = parsedGender.tr;
  const isOtherClan = registrationType === 'other';

  // 1. Zaten Kayıtlı mı?
  if (config.isRegisteredMember(member)) {
    const isOtherClanRole = Boolean(config.ROLES?.OTHER_CLAN && member.roles.cache.has(config.ROLES.OTHER_CLAN));
    return {
      success: false,
      code: 'ALREADY_REGISTERED',
      message: isOtherClanRole
        ? (isEn
            ? 'You are already registered (Other Clan member). Please contact staff to switch to Piyade Clan.'
            : 'Zaten kayıtlısınız (Diğer Klan üyesi). Piyade Klanına geçmek için yetkililere ulaşın.')
        : (isEn
            ? 'You are already registered on our server! You cannot submit another application.'
            : 'Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.'),
    };
  }

  // 1.1 Başka Klan ise Klan Adı Doğrulaması ve Çözümlemesi
  let clanCleanName = null;
  let clanResolution = null;

  if (isOtherClan) {
    if (!clanName || typeof clanName !== 'string' || !clanName.trim()) {
      return {
        success: false,
        code: 'CLAN_REQUIRED',
        message: isEn
          ? 'Please specify the name of the clan you belong to.'
          : 'Lütfen üyesi olduğunuz klanın adını giriniz.',
      };
    }

    const sanitized = clanMatcher.sanitizeClanName(clanName);
    if (!sanitized.valid) {
      if (sanitized.error === 'CLAN_BLOCKED') {
        return {
          success: false,
          code: 'CLAN_BLOCKED',
          message: isEn
            ? 'The clan name you entered contains disallowed content (mentions, invite links, or inappropriate language).'
            : 'Girdiğiniz klan adı uygunsuz içerik (etiket, davet linki veya küfür) içerdiği için reddedildi.',
        };
      }
      return {
        success: false,
        code: 'CLAN_INVALID',
        message: isEn
          ? 'Invalid clan name! It must be between 2 and 32 characters and contain valid letters.'
          : 'Geçersiz klan adı! Klan adı 2-32 karakter olmalı ve geçerli harfler içermelidir (örn: Dark Wolves).',
      };
    }

    clanCleanName = sanitized.cleanName;

    // Güncel güvenli rolleri derle
    const registryRoles = database.getClanRoles();
    const safeGuildRoles = Array.from(guild.roles.cache.values()).filter((r) =>
      clanMatcher.isSafeClanRole(r, guild, config, database)
    );
    const knownClans = database.getKnownClans();

    clanResolution = clanMatcher.resolveClan(clanCleanName, {
      registryRoles,
      safeGuildRoles,
      knownClans,
      ownClanAliases: config.OWN_CLAN_ALIASES,
    });

    // Kendi klanımız mı yazılmış?
    if (clanResolution.ownClan) {
      return {
        success: false,
        code: 'CLAN_IS_OWN',
        message: isEn
          ? 'If you want to join Piyade Clan, please use the first option (I Want to Join the Piyade Clan).'
          : 'Piyade Klanına katılmak istiyorsan lütfen ilk seçeneği (Piyade Klanına Katılmak İstiyorum) kullan.',
      };
    }
  }

  // 2. Aktif Başvuru Kontrolü
  const activeApp = database.getActiveApplication(user.id);
  if (activeApp && activeApp.threadId) {
    const existingThread = await guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (existingThread) {
      return {
        success: false,
        code: 'ACTIVE_APPLICATION',
        message: isEn
          ? `You already have an active registration application! Please check your registration thread: <#${activeApp.threadId}>`
          : `Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
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
          isEn
            ? `❌ **Piyade Team | Registration Application Rejected**\n\n` +
              `**Reason:** The specified Roblox account could not be found.\n` +
              `📌 **Important:** Please enter your actual Roblox **@username**, User ID, or profile URL — **not** your Display Name.`
            : `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
              `**Sebep:** Belirtilen Roblox hesabı bulunamadı.\n` +
              `📌 **Önemli Bilgi:** Lütfen Roblox'taki görünen adınızı (Display Name) değil, profilinizdeki asıl **@kullanıcı** adınızı, ID'nizi veya profil linkinizi yazarak tekrar başvurunuz.`
        ).catch(() => {});
      } catch (e) {}

      return {
        success: false,
        code: 'ROBLOX_NOT_FOUND',
        message: isEn
          ? 'Roblox account not found! Please enter your actual @username, User ID, or profile link (not your Display Name).'
          : 'Girilen Roblox hesabı bulunamadı! Lütfen profilinizdeki asıl @kullanıcı adınızı, ID\'nizi veya linkinizi giriniz.',
      };
    }

    if (robloxResult.error === 'BANNED') {
      try {
        await user.send(
          isEn
            ? `❌ **Piyade Team | Registration Application Rejected**\n\n` +
              `**Reason:** This Roblox account is permanently banned/terminated on Roblox. Banned accounts cannot register on our server.`
            : `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
              `**Sebep:** Belirtilen Roblox hesabı Roblox platformunda kalıcı olarak yasaklanmıştır (Banned). Yasaklı hesaplarla sunucumuza kayıt olunamaz.`
        ).catch(() => {});
      } catch (e) {}

      return {
        success: false,
        code: 'ROBLOX_BANNED',
        message: isEn
          ? 'This Roblox account is permanently banned on the Roblox platform!'
          : 'Bu Roblox hesabı platform üzerinde kalıcı olarak yasaklanmıştır (Banned)!',
      };
    }

    return {
      success: false,
      code: 'ROBLOX_ERROR',
      message: isEn
        ? 'Could not verify your Roblox account at this time. Please try again.'
        : robloxResult.message || 'Roblox doğrulaması yapılamadı.',
    };
  }

  const robloxUser = robloxResult.user;

  // 4. Multi-Hesap (Tekil Kimlik) Koruması
  const existingReg = database.getRegistrationByRobloxId(robloxUser.id);
  if (existingReg && String(existingReg.discordId) !== String(user.id)) {
    return {
      success: false,
      code: 'MULTI_ACCOUNT',
      message: isEn
        ? `This Roblox account ([${robloxUser.name}](https://www.roblox.com/users/${robloxUser.id}/profile)) is already registered to another Discord user (<@${existingReg.discordId}>)!`
        : `Bu Roblox hesabı ([${robloxUser.name}](https://www.roblox.com/users/${robloxUser.id}/profile)) sunucumuzda başka bir Discord kullanıcısına (<@${existingReg.discordId}>) zaten kayıtlıdır!`,
    };
  }

  // 5. Özel Kayıt Odası (Thread) Oluşturma
  const registerChannel = guild.channels.cache.get(config.CHANNELS.REGISTER);
  if (!registerChannel) {
    return {
      success: false,
      code: 'CHANNEL_NOT_FOUND',
      message: isEn ? 'Registration channel not found!' : 'Kayıt kanalı bulunamadı!',
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
        message: isEn
          ? 'An error occurred while creating your private registration thread. Please contact staff.'
          : 'Özel kayıt odası oluşturulurken bir hata meydana geldi. Lütfen yetkililer ile iletişime geçiniz.',
      };
    }
  }

  await thread.members.add(user.id).catch(() => {});

  const threadInfoEmbed = new EmbedBuilder()
    .setTitle(isEn ? '🟡 Application Under Review...' : '🟡 Başvuru İnceleniyor...')
    .setColor(isOtherClan ? config.COLORS.OTHER_CLAN : config.COLORS.PENDING)
    .setDescription(
      isEn
        ? `👋 Welcome <@${user.id}>!\n\n` +
          `📋 **Registration Process Information:**\n` +
          `• Application Type: **${isOtherClan ? '🏳️ Other Clan Member' : '🛡️ Piyade Clan Membership'}**\n` +
          (isOtherClan && clanCleanName ? `• Clan: **${clanCleanName}**\n` : '') +
          `• Your details and Roblox profile have been successfully verified.\n` +
          (source === 'site' ? `• Application source: **Website Registration Form** 🌐\n` : '') +
          `• Your application has been forwarded to our staff approval channel.\n` +
          `• Once approved by staff, your roles will be assigned automatically and this thread will be closed.\n` +
          `• If rejected, the reason will be sent here and via Direct Message (DM).\n\n` +
          `⏳ *Please wait patiently for a staff member to review your application.*`
        : `👋 Hoş geldin <@${user.id}>!\n\n` +
          `📋 **Kayıt İşleyişi Bilgilendirmesi:**\n` +
          `• Başvuru Türü: **${isOtherClan ? '🏳️ Başka Klan Üyesi' : '🛡️ Piyade Klanı Üyeliği'}**\n` +
          (isOtherClan && clanCleanName ? `• Belirtilen Klan: **${clanCleanName}**\n` : '') +
          `• Bilgileriniz ve Roblox profiliniz başarıyla doğrulandı.\n` +
          (source === 'site' ? `• Başvuru kaynağı: **Web Sitesi Kayıt Formu** 🌐\n` : '') +
          `• Başvurunuz yetkili onay kanalına iletildi.\n` +
          `• Yetkililerimiz onayladığında rolleriniz otomatik olarak tanımlanacak ve odanız silinecektir.\n` +
          `• Başvurunuz reddedilirse, red sebebi bu odadan ve DM üzerinden size bildirilecektir.\n\n` +
          `⏳ *Lütfen yetkili kararını sabırla bekleyiniz.*`
    )
    .setFooter({
      text: isEn
        ? `Piyade Team • Registration System${source === 'site' ? ' • Web Registration' : ''}`
        : `Piyade Team • Kayıt Sistemi${source === 'site' ? ' • Web Kayıt' : ''}`,
    })
    .setTimestamp();

  await thread.send({
    content: `<@${user.id}>`,
    embeds: [threadInfoEmbed],
  }).catch(() => {});

  // 6. Yetkili Onay Kartı Gönderme
  const staffChannel = guild.channels.cache.get(config.CHANNELS.STAFF_APPROVAL);
  let staffMessage = null;

  if (staffChannel) {
    let roleDecisionText = '';
    if (isOtherClan && clanResolution) {
      if (clanResolution.mode === 'existing') {
        roleDecisionText = `✅ Mevcut rol kullanılacak: <@&${clanResolution.roleId}> (%${Math.round(clanResolution.score * 100)})`;
      } else if (clanResolution.mode === 'suggested') {
        const candidateList = (clanResolution.candidates || [])
          .map((c) => `• <@&${c.roleId}> (%${Math.round(c.score * 100)})`)
          .join('\n');
        roleDecisionText = `⚠️ Benzer rol bulundu: <@&${clanResolution.roleId}> (%${Math.round(clanResolution.score * 100)}) — kontrol et; yanlışsa 'Klanı Düzenle'\n${candidateList}`;
      } else {
        roleDecisionText = `🆕 Yeni rol oluşturulacak: **${clanResolution.displayName}**`;
      }
    }

    const staffEmbed = new EmbedBuilder()
      .setTitle(
        isOtherClan
          ? '📋 Yeni Kayıt Başvurusu — 🏳️ Başka Klan' + (source === 'site' ? ' (Web Sitesi)' : '')
          : '📋 Yeni Kayıt Başvurusu' + (source === 'site' ? ' (Web Sitesi)' : '')
      )
      .setColor(isOtherClan ? config.COLORS.OTHER_CLAN : config.COLORS.PENDING)
      .setThumbnail(robloxUser.avatarUrl)
      .addFields(
        { name: '👤 Discord Kullanıcısı', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
        { name: '🆔 Discord ID', value: `\`${user.id}\``, inline: true },
        { name: '📝 Gerçek Adı', value: `${realName}`, inline: true },
        { name: '🚻 Cinsiyet', value: `${normalizedGender}`, inline: true },
        { name: '🌐 Dil / Language', value: isEn ? '🇬🇧 `English`' : '🇹🇷 `Türkçe`', inline: true },
        {
          name: '🏳️ Başvuru Türü',
          value: isOtherClan ? '`🏳️ Başka Klan Üyesi`' : '`🛡️ Piyade Klanı`',
          inline: true,
        }
      );

    if (isOtherClan) {
      staffEmbed.addFields(
        { name: '🏷️ Yazdığı Klan', value: `\`${clanCleanName}\``, inline: true },
        { name: '🧩 Rol Kararı', value: roleDecisionText || '`Belirleniyor`', inline: false }
      );

      if (clanResolution && clanResolution.knownClan) {
        const kc = clanResolution.knownClan;
        const kcLabel =
          kc.type === 'enemy'
            ? `⚫ **DÜŞMAN KLAN ⚠️** (${kc.name})`
            : `⚪ **Dost Klan** (${kc.name})`;
        staffEmbed.addFields({ name: '⚔️ Dost / Düşman Durumu', value: kcLabel, inline: false });
      }

      staffEmbed.addFields({
        name: '🎭 Verilecek Roller',
        value: '• Other Clan\n• Hesabı onaylı\n• Klan Rolü\n• Cinsiyet Rolü\n*(Kayıtlı Üye rolü VERİLMEZ)*',
        inline: false,
      });
    }

    staffEmbed.addFields(
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

    const buttons = [
      new ButtonBuilder()
        .setCustomId(`btn_approve_${user.id}`)
        .setLabel('✅ ONAYLA')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`btn_reject_${user.id}`)
        .setLabel('✖️ REDDET')
        .setStyle(ButtonStyle.Danger),
    ];

    if (isOtherClan) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`btn_clan_edit_${user.id}`)
          .setLabel('🏷️ Klanı Düzenle')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    const buttonsRow = new ActionRowBuilder().addComponents(buttons);

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
    gender: normalizedGender,
    lang: userLang,
    registrationType,
    clanTypedName: clanCleanName,
    clanResolution,
    robloxId: robloxUser.id,
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
    staffMessageId: staffMessage ? staffMessage.id : null,
    staffChannelId: staffChannel ? staffChannel.id : null,
    source,
  });

  return {
    success: true,
    message: isEn
      ? 'Your registration application has been submitted! Your private registration thread has been created.'
      : 'Başvurunuz başarıyla alındı! Size özel kayıt odası açıldı.',
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
