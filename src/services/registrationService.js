const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');

const config = require('../../config');
const gamesConfig = require('../../games.config');
const database = require('../utils/database');
const robloxService = require('./roblox');
const { resolveLang, setMemberLanguage, parseGenderInput } = require('../utils/i18n');

/**
 * Çoklu Oyun Kayıt Başvurusunu Oluşturan Çekirdek Servis (Discord & Web API ortak)
 */
async function createRegistrationApplication({
  guild,
  member,
  user,
  realName,
  gender,
  games = null,
  gameUsernames = null,
  robloxInput = null,
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

  // 0. Seçilen oyunları ve oyun kullanıcı adlarını normalize et
  let selectedGames = gamesConfig.normalizeGameList(games || []);
  const usernamesMap = {};

  if (gameUsernames && typeof gameUsernames === 'object') {
    for (const gId of selectedGames) {
      const val = String(gameUsernames[gId] || '').trim();
      if (val) usernamesMap[gId] = val;
    }
  }

  // Geriye dönük uyumluluk (Sadece robloxInput gönderen eski istemciler için)
  if (selectedGames.length === 0 && robloxInput && typeof robloxInput === 'string' && robloxInput.trim()) {
    selectedGames = ['roblox'];
    usernamesMap.roblox = robloxInput.trim();
  }

  if (selectedGames.length === 0) {
    return {
      success: false,
      code: 'NO_GAMES_SELECTED',
      message: isEn
        ? 'You must select at least 1 game before submitting your registration.'
        : 'Başvuru göndermek için en az 1 oyun seçmelisiniz.',
    };
  }

  for (const gId of selectedGames) {
    if (!usernamesMap[gId] || !String(usernamesMap[gId]).trim()) {
      const g = gamesConfig.getGameById(gId);
      const gLabel = g ? g.name[userLang] : gId;
      return {
        success: false,
        code: 'MISSING_GAME_USERNAME',
        message: isEn
          ? `Please enter your in-game username for ${gLabel}.`
          : `Lütfen **${gLabel}** oyunu için kullanıcı adınızı giriniz.`,
      };
    }
  }

  // 1. Zaten Kayıtlı mı?
  if (config.isRegisteredMember(member)) {
    return {
      success: false,
      code: 'ALREADY_REGISTERED',
      message: isEn
        ? 'You are already registered on our server! You cannot submit another application.'
        : 'Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.',
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
        message: isEn
          ? `You already have an active registration application! Please check your registration thread: <#${activeApp.threadId}>`
          : `Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
        threadId: activeApp.threadId,
      };
    } else {
      database.removeActiveApplication(user.id);
    }
  }

  // 3. Roblox Doğrulaması (Yalnızca kullanıcı Roblox seçtiyse zorunlu olarak çalışır)
  const playsRoblox = selectedGames.includes('roblox');
  let robloxUser = null;

  if (playsRoblox) {
    const robloxResult = await robloxService.resolveUser(usernamesMap.roblox);

    if (!robloxResult.success) {
      if (robloxResult.error === 'NOT_FOUND') {
        try {
          await user.send(
            isEn
              ? `❌ **${config.BRAND_NAME} | Registration Application Rejected**\n\n` +
                `**Reason:** The specified Roblox account (\`${usernamesMap.roblox}\`) could not be found.\n` +
                `📌 **Important:** Please enter your actual Roblox **@username**, User ID, or profile URL — **not** your Display Name.`
              : `❌ **${config.BRAND_NAME} | Kayıt Başvurusu Reddedildi**\n\n` +
                `**Sebep:** Belirtilen Roblox hesabı (\`${usernamesMap.roblox}\`) Roblox platformunda bulunamadı.\n` +
                `📌 **Önemli Bilgi:** Lütfen Roblox'taki görünen adınızı (Display Name) değil, profilinizdeki asıl **@kullanıcı** adınızı, ID'nizi veya profil linkinizi yazarak tekrar başvurunuz.`
          ).catch(() => {});
        } catch (e) {}

        return {
          success: false,
          code: 'ROBLOX_NOT_FOUND',
          message: isEn
            ? 'Roblox account not found! Application rejected. Please enter your actual @username, User ID, or profile link (not your Display Name).'
            : 'Girilen Roblox hesabı bulunamadı ve başvurunuz reddedildi! Lütfen profilinizdeki asıl @kullanıcı adınızı, ID\'nizi veya linkinizi giriniz.',
        };
      }

      if (robloxResult.error === 'BANNED') {
        try {
          await user.send(
            isEn
              ? `❌ **${config.BRAND_NAME} | Registration Application Rejected**\n\n` +
                `**Reason:** This Roblox account is permanently banned/terminated on Roblox. Banned accounts cannot register on our server.`
              : `❌ **${config.BRAND_NAME} | Kayıt Başvurusu Reddedildi**\n\n` +
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

    robloxUser = robloxResult.user;
    // Doğrulanmış resmi Roblox kullanıcı adını kaydet
    usernamesMap.roblox = robloxUser.name;

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

  const gamesDisplayEn = gamesConfig.formatGamesDisplay(selectedGames, 'en');
  const gamesDisplayTr = gamesConfig.formatGamesDisplay(selectedGames, 'tr');

  const threadInfoEmbed = new EmbedBuilder()
    .setTitle(isEn ? '🟡 Application Under Review...' : '🟡 Başvuru İnceleniyor...')
    .setColor(config.COLORS.PENDING)
    .setDescription(
      isEn
        ? `👋 Welcome <@${user.id}>!\n\n` +
          `📋 **Registration Process Information:**\n` +
          `• **Selected Games:** ${gamesDisplayEn}\n` +
          (playsRoblox ? `• Your details and Roblox profile have been successfully verified.\n` : `• Your registration details have been received.\n`) +
          (source === 'site' ? `• Application source: **Website Registration Form** 🌐\n` : '') +
          `• Your application has been forwarded to our staff approval channel.\n` +
          `• Once approved by staff, your game roles, gender role, and member roles will be assigned automatically and this thread will be closed.\n` +
          `• If rejected, the reason will be sent here and via Direct Message (DM).\n\n` +
          `⏳ *Please wait patiently for a staff member to review your application.*`
        : `👋 Hoş geldin <@${user.id}>!\n\n` +
          `📋 **Kayıt İşleyişi Bilgilendirmesi:**\n` +
          `• **Seçilen Oyunlar:** ${gamesDisplayTr}\n` +
          (playsRoblox ? `• Bilgileriniz ve Roblox profiliniz başarıyla doğrulandı.\n` : `• Oyun ve kayıt bilgileriniz başarıyla alındı.\n`) +
          (source === 'site' ? `• Başvuru kaynağı: **Web Sitesi Kayıt Formu** 🌐\n` : '') +
          `• Başvurunuz yetkili onay kanalına iletildi.\n` +
          `• Yetkililerimiz onayladığında oyun rolleriniz, cinsiyet rolünüz ve üye rolleriniz otomatik tanımlanacak ve odanız silinecektir.\n` +
          `• Başvurunuz reddedilirse, red sebebi bu odadan ve DM üzerinden size bildirilecektir.\n\n` +
          `⏳ *Lütfen yetkili kararını sabırla bekleyiniz.*`
    )
    .setFooter({
      text: isEn
        ? `${config.BRAND_NAME} • Registration System${source === 'site' ? ' • Web Registration' : ''}`
        : `${config.BRAND_NAME} • Kayıt Sistemi${source === 'site' ? ' • Web Kayıt' : ''}`,
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
    const thumbnailUrl = robloxUser
      ? robloxUser.avatarUrl
      : typeof user.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ size: 256, dynamic: true })
      : null;

    const staffFields = [
      { name: '👤 Discord Kullanıcısı', value: `<@${user.id}> (\`${user.tag}\`)`, inline: true },
      { name: '🆔 Discord ID', value: `\`${user.id}\``, inline: true },
      { name: '📝 Adı / Takma Adı', value: `${realName}`, inline: true },
      { name: '🚻 Cinsiyet', value: `${normalizedGender}`, inline: true },
      { name: '🌐 Dil / Language', value: isEn ? '🇬🇧 `English`' : '🇹🇷 `Türkçe`', inline: true },
      { name: '🎯 Seçtiği Oyunlar', value: gamesDisplayTr || '`Belirtilmedi`', inline: true },
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
    ];

    // Roblox oynuyorsa doğrulanmış profil linki ve tüm detaylarını ekle
    if (playsRoblox && robloxUser) {
      const verifiedTag = robloxUser.hasVerifiedBadge ? ' ☑️ *(Doğrulanmış)*' : '';
      staffFields.push(
        {
          name: '🎮 Roblox Kullanıcı Adı',
          value: `[${robloxUser.name} (@${robloxUser.displayName})](https://www.roblox.com/users/${robloxUser.id}/profile)${verifiedTag}`,
          inline: true,
        },
        { name: '🆔 Roblox ID', value: `\`${robloxUser.id}\``, inline: true },
        {
          name: '🔗 Roblox Profil Linki',
          value: `[Profili Görüntüle](https://www.roblox.com/users/${robloxUser.id}/profile)`,
          inline: true,
        }
      );

      if (robloxUser.createdAt) {
        const robloxCreatedSec = Math.floor(new Date(robloxUser.createdAt).getTime() / 1000);
        if (!Number.isNaN(robloxCreatedSec) && robloxCreatedSec > 0) {
          staffFields.push({
            name: '📆 Roblox Hesap Açılışı',
            value: `<t:${robloxCreatedSec}:D> (<t:${robloxCreatedSec}:R>)`,
            inline: true,
          });
        }
      }

      if (robloxUser.description && robloxUser.description.trim()) {
        const cleanDesc = robloxUser.description.trim().slice(0, 180).replace(/`/g, "'");
        staffFields.push({
          name: '📄 Roblox Hakkında',
          value: `\`${cleanDesc}${robloxUser.description.trim().length > 180 ? '...' : ''}\``,
          inline: false,
        });
      }
    }

    // Seçilen diğer oyunların kullanıcı adlarını ekle
    for (const gId of selectedGames) {
      if (gId === 'roblox') continue;
      const g = gamesConfig.getGameById(gId);
      if (!g) continue;
      staffFields.push({
        name: `${g.emoji} ${g.name.tr} Kullanıcı Adı`,
        value: `\`${usernamesMap[gId]}\``,
        inline: true,
      });
    }

    staffFields.push(
      { name: '🧵 Özel Kayıt Odası', value: `<#${thread.id}>`, inline: true },
      { name: '🌐 Başvuru Kaynağı', value: source === 'site' ? '`Web Sitesi Formu`' : '`Discord Paneli`', inline: true }
    );

    const staffEmbed = new EmbedBuilder()
      .setTitle('📋 Yeni Kayıt Başvurusu' + (source === 'site' ? ' (Web Sitesi)' : ''))
      .setColor(config.COLORS.PENDING)
      .addFields(staffFields)
      .setFooter({ text: `${config.BRAND_NAME} • Yetkili Onay Sistemi` })
      .setTimestamp();

    if (thumbnailUrl) {
      staffEmbed.setThumbnail(thumbnailUrl);
    }

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
    games: selectedGames,
    gameUsernames: usernamesMap,
    robloxId: robloxUser ? robloxUser.id : null,
    robloxUsername: robloxUser ? robloxUser.name : null,
    robloxDisplayName: robloxUser ? robloxUser.displayName : null,
    robloxProfileUrl: robloxUser ? robloxUser.profileUrl : null,
    robloxCreatedAt: robloxUser ? robloxUser.createdAt : null,
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
    games: selectedGames,
    gameUsernames: usernamesMap,
    robloxUser: robloxUser
      ? {
          id: robloxUser.id,
          name: robloxUser.name,
          displayName: robloxUser.displayName,
          profileUrl: `https://www.roblox.com/users/${robloxUser.id}/profile`,
          avatarUrl: robloxUser.avatarUrl,
          createdAt: robloxUser.createdAt,
        }
      : null,
  };
}

module.exports = {
  createRegistrationApplication,
};
