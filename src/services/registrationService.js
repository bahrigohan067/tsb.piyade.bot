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
const { resolveLang, parseGenderInput } = require('../utils/i18n');
const {
  validateDisplayName,
  validateGameUsername,
  sanitizeInlineCode,
  escapeEmbedText,
} = require('../utils/inputSanitizer');

// Kullanıcı başına 10 dakikada en çok 5 form gönderimi hız sınırı
const REG_RATE_WINDOW_MS = 10 * 60 * 1000;
const REG_RATE_MAX_ATTEMPTS = 5;
const registrationAttempts = new Map();

/**
 * Kullanıcının kayıt formu gönderme hız sınırını kontrol eder.
 */
function checkRegistrationRateLimit(userId, now = Date.now()) {
  if (!userId) return { limited: false, retryAfterSec: 0, remaining: REG_RATE_MAX_ATTEMPTS };
  const uid = String(userId);
  const recent = (registrationAttempts.get(uid) || []).filter(
    (ts) => now - ts < REG_RATE_WINDOW_MS
  );
  registrationAttempts.set(uid, recent);

  if (recent.length >= REG_RATE_MAX_ATTEMPTS) {
    const oldest = recent[recent.length - REG_RATE_MAX_ATTEMPTS];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + REG_RATE_WINDOW_MS - now) / 1000));
    return { limited: true, retryAfterSec, remaining: 0 };
  }

  return {
    limited: false,
    retryAfterSec: 0,
    remaining: REG_RATE_MAX_ATTEMPTS - recent.length,
  };
}

/**
 * Bir kayıt form denemesini (başarılı veya başarısız) hız sınırı sayacına ekler.
 */
function recordRegistrationAttempt(userId, now = Date.now()) {
  if (!userId) return;
  const uid = String(userId);
  const recent = (registrationAttempts.get(uid) || []).filter(
    (ts) => now - ts < REG_RATE_WINDOW_MS
  );
  recent.push(now);
  registrationAttempts.set(uid, recent);
}

/**
 * Testler için kayıt hız sınırı sayaçlarını temizler.
 */
function clearRegistrationRateLimits() {
  registrationAttempts.clear();
}

/**
 * Onaylanan üye için Discord sunucu takma adını biçimlendirir (maksimum 32 karakter).
 * Not: Biçim değişikliği gerekirse yalnızca bu tek fonksiyon güncellenir.
 * Roblox seçildiyse: "<Ad> | <RobloxKullanıcıAdı>" (taşarsa Roblox adı korunur, Ad kısmı kesilir, "…" eklenmez).
 * Roblox seçilmediyse: "<Ad>".
 */
function formatApprovedNickname(displayName, robloxUsername = null) {
  const cleanName = String(displayName || '').trim();
  const cleanRoblox = robloxUsername ? String(robloxUsername).trim() : '';

  if (!cleanRoblox) {
    return cleanName.length > 32 ? cleanName.slice(0, 32).trim() : cleanName;
  }

  const separator = ' | ';
  const maxNameLen = 32 - separator.length - cleanRoblox.length;

  if (maxNameLen < 1) {
    return cleanRoblox.slice(0, 32);
  }

  const trimmedName =
    cleanName.length > maxNameLen ? cleanName.slice(0, maxNameLen).trim() : cleanName;

  if (!trimmedName) {
    return cleanRoblox.slice(0, 32);
  }

  return `${trimmedName}${separator}${cleanRoblox}`;
}

/**
 * Sayı değerini Türkçe binlik ayraçlı veya null ise "alınamadı" olarak döndürür.
 */
function formatNullableMetric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('tr-TR');
  }
  return 'alınamadı';
}

/**
 * Metni Discord embed alanı sınırına (1024 karakter) sığacak şekilde kısaltır.
 */
function clampFieldValue(text, max = 1024) {
  const str = String(text || '-');
  if (str.length <= max) return str;
  return `${str.slice(0, max - 3)}...`;
}

/**
 * Onayda verilecek rolleri belirler; config'te veya sunucuda eksik olanları ⚠️ ile işaretler.
 */
function resolveExpectedRolesInfo({ guild, genderInfo, selectedGames }) {
  const lines = [];

  const checkAndFormatRole = (roleId, fallbackLabel) => {
    if (!roleId) {
      lines.push(`⚠️ **${fallbackLabel}**: Yapılandırmada rol ID'si eksik`);
      return;
    }
    const existsInGuild = Boolean(guild?.roles?.cache?.has?.(roleId));
    if (!existsInGuild) {
      lines.push(`⚠️ **${fallbackLabel}** (\`${roleId}\`): Sunucuda bulunamadı`);
      return;
    }
    lines.push(`✅ <@&${roleId}>`);
  };

  // Genel roller
  const approvedList = Array.isArray(config.ROLES.APPROVED_ROLES) ? config.ROLES.APPROVED_ROLES : [];
  if (approvedList.length === 0) {
    lines.push('⚠️ **Genel Üye Rolleri**: Yapılandırmada eksik');
  } else {
    approvedList.forEach((roleId, idx) => {
      const label = idx === 0 ? 'Hesabı Onaylı' : 'Cengaver';
      checkAndFormatRole(roleId, label);
    });
  }

  // Cinsiyet rolü
  const genderRoleId = genderInfo.isFemale ? config.ROLES.FEMALE : config.ROLES.MALE;
  checkAndFormatRole(genderRoleId, genderInfo.isFemale ? 'Kız' : 'Erkek');

  // Seçilen oyunların rolleri (games.config.js sırasıyla)
  for (const gameEntry of selectedGames) {
    const gameCfg = gamesConfig.getGameById(gameEntry.id);
    if (!gameCfg) continue;
    const roleLabel = gamesConfig.getGameLabel(gameCfg, 'tr');
    checkAndFormatRole(gameCfg.roleId, `${gameCfg.emoji} ${roleLabel}`);
  }

  return lines.join('\n');
}

/**
 * Yetkili onay kanalına gönderilecek kapsamlı Türkçe başvuru kartını üretir.
 */
function buildStaffApprovalEmbed({
  guild,
  member,
  user,
  displayName,
  genderInfo,
  langCode,
  source,
  games,
  robloxUser,
  duplicateGameNotices = [],
  thread,
}) {
  const isWeb = source === 'web' || source === 'site';
  const createdUnix = user?.createdTimestamp ? Math.floor(user.createdTimestamp / 1000) : Math.floor(Date.now() / 1000);
  const joinedUnix = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

  const gameLines = games.map((entry) => {
    const cfg = gamesConfig.getGameById(entry.id);
    const emoji = cfg?.emoji || '🎮';
    const gameName = cfg ? gamesConfig.getGameLabel(cfg, 'tr') : entry.id;
    return `${emoji} **${gameName}** ➜ \`${sanitizeInlineCode(entry.username, 64)}\``;
  });

  if (duplicateGameNotices.length > 0) {
    gameLines.push('');
    for (const notice of duplicateGameNotices) {
      gameLines.push(notice);
    }
  }

  const rolesInfoValue = resolveExpectedRolesInfo({
    guild,
    genderInfo,
    selectedGames: games,
  });

  const safeTag = sanitizeInlineCode(user?.tag || user?.username || user?.id, 64);
  const safeName = escapeEmbedText(displayName, 64) || '-';

  const embed = new EmbedBuilder()
    .setTitle(`📋 Yeni Kayıt Başvurusu${isWeb ? ' (Web Sitesi)' : ''}`)
    .setColor(config.COLORS.PENDING)
    .addFields(
      {
        name: '👤 Discord',
        value: clampFieldValue(
          `<@${user.id}> (\`${safeTag}\`)\n` +
          `🆔 ID: \`${user.id}\`\n` +
          `📅 Hesap: <t:${createdUnix}:R> (<t:${createdUnix}:D>)` +
          (joinedUnix ? `\n📥 Katılım: <t:${joinedUnix}:R>` : '')
        ),
        inline: false,
      },
      {
        name: '🏷️ Ad / Takma ad',
        value: clampFieldValue(safeName),
        inline: true,
      },
      {
        name: '⚧ Cinsiyet',
        value: genderInfo.tr,
        inline: true,
      },
      {
        name: '🌐 Dil',
        value: langCode === 'en' ? '🇬🇧 English' : '🇹🇷 Türkçe',
        inline: true,
      },
      {
        name: '🎮 Seçilen Oyunlar ve Kullanıcı Adları',
        value: clampFieldValue(gameLines.join('\n') || 'Belirtilmedi'),
        inline: false,
      },
      {
        name: '🎭 Verilecek Roller',
        value: clampFieldValue(rolesInfoValue),
        inline: false,
      }
    );

  // Roblox seçilmişse detaylı doğrulama bloğu ekle
  if (robloxUser) {
    if (robloxUser.avatarUrl) {
      embed.setThumbnail(robloxUser.avatarUrl);
    }

    const robloxCreatedUnix = robloxUser.createdAt ? Math.floor(Date.parse(robloxUser.createdAt) / 1000) : null;
    const ageDays =
      typeof robloxUser.accountAgeDays === 'number'
        ? robloxUser.accountAgeDays
        : robloxUser.createdAt
          ? Math.floor(Math.max(0, Date.now() - Date.parse(robloxUser.createdAt)) / (24 * 60 * 60 * 1000))
          : null;
    const isNewAcc =
      typeof robloxUser.isNewAccount === 'boolean'
        ? robloxUser.isNewAccount
        : ageDays !== null && ageDays < 30;

    const ageStr =
      robloxCreatedUnix && Number.isFinite(robloxCreatedUnix) && ageDays !== null
        ? `<t:${robloxCreatedUnix}:D> (${ageDays} gün)`
        : 'alınamadı';

    const verifiedBadgeStr =
      robloxUser.hasVerifiedBadge === true
        ? '✅ Var'
        : robloxUser.hasVerifiedBadge === false
          ? 'Yok'
          : 'alınamadı';

    let aboutDisplay = 'alınamadı';
    if (robloxUser.about !== undefined && robloxUser.about !== null) {
      const cleanedAbout = escapeEmbedText(robloxUser.about, 200);
      aboutDisplay = cleanedAbout || '*(Açıklama yok)*';
    }

    const flags = [];
    if (isNewAcc) flags.push('⚠️ Yeni hesap (<30 gün)');

    const robloxBlockLines = [
      `• **Kullanıcı Adı:** \`${sanitizeInlineCode(robloxUser.name, 48)}\``,
      `• **Görünen Ad:** \`${sanitizeInlineCode(robloxUser.displayName || robloxUser.name, 48)}\``,
      `• **Kullanıcı ID:** \`${robloxUser.id}\``,
      `• **Profil Linki:** [Roblox Profili](https://www.roblox.com/users/${robloxUser.id}/profile)`,
      `• **Doğrulanmış Rozet:** ${verifiedBadgeStr}`,
      `• **Hesap Yaşı / Kuruluş:** ${ageStr}`,
      `• **Arkadaş / Takipçi / Takip:** ${formatNullableMetric(robloxUser.friendsCount)} / ${formatNullableMetric(robloxUser.followersCount)} / ${formatNullableMetric(robloxUser.followingsCount)}`,
      `• **Açıklama (About):** ${aboutDisplay}`,
    ];

    if (flags.length > 0) {
      robloxBlockLines.push(`• **Bayraklar:** ${flags.join(' • ')}`);
    }

    embed.addFields({
      name: '🧱 Roblox Doğrulama: ✅ Hesap bulundu',
      value: clampFieldValue(robloxBlockLines.join('\n')),
      inline: false,
    });
  } else if (typeof user?.displayAvatarURL === 'function') {
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  }

  embed.addFields(
    { name: '🧵 Özel Kayıt Odası', value: thread ? `<#${thread.id}>` : '`Yok`', inline: true },
    { name: '🌐 Başvuru Kaynağı', value: isWeb ? '`Web Sitesi`' : '`Discord Paneli`', inline: true }
  );

  embed.setFooter({ text: `${config.BRAND_NAME} • Yetkili Onay Sistemi` }).setTimestamp();

  // Embed toplam uzunluk (6000) güvenlik kontrolü
  const json = embed.toJSON();
  let totalLen = (json.title || '').length + (json.description || '').length + (json.footer?.text || '').length;
  for (const f of json.fields || []) {
    totalLen += (f.name || '').length + (f.value || '').length;
  }
  if (totalLen > 5900 && Array.isArray(embed.data.fields)) {
    const rbField = embed.data.fields.find((f) => f.name.includes('Roblox Doğrulama'));
    if (rbField && rbField.value.length > 500) {
      rbField.value = clampFieldValue(rbField.value, 500);
    }
  }

  return embed;
}

/**
 * Kayıt Başvurusunu Oluşturan Çekirdek Servis (Discord & Web API ortak)
 * İmza: { guild, member, user, lang, source ('discord'|'web'), name, gender, games }
 * Not: Geriye dönük uyumluluk için realName / robloxInput da desteklenir.
 */
async function createRegistrationApplication({
  guild,
  member,
  user,
  name,
  realName,
  gender,
  games,
  robloxInput,
  source = 'discord',
  lang = null,
}) {
  const targetUser = user || member?.user;
  if (!guild || !member || !targetUser) {
    return {
      success: false,
      httpStatus: 400,
      code: 'INVALID_MEMBER',
      message: 'Geçersiz sunucu veya üye bilgisi.',
    };
  }

  const userLang = resolveLang(member, lang);
  const isEn = userLang === 'en';

  const genderInfo = parseGenderInput(gender);
  const normalizedGender = genderInfo.tr;

  // 1. Zaten Kayıtlı mı?
  if (config.isRegisteredMember(member)) {
    const errorBilingual = {
      tr: 'Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.',
      en: 'You are already registered on our server! You cannot submit another application.',
    };
    return {
      success: false,
      httpStatus: 400,
      code: 'ALREADY_REGISTERED',
      message: isEn ? errorBilingual.en : errorBilingual.tr,
      errorBilingual,
    };
  }

  // 2. Aktif Başvuru Kontrolü
  const activeApp = database.getActiveApplication(targetUser.id);
  if (activeApp && activeApp.threadId) {
    const existingThread = await guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (existingThread) {
      const errorBilingual = {
        tr: `Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
        en: `You already have an active registration application! Please check your registration thread: <#${activeApp.threadId}>`,
      };
      return {
        success: false,
        httpStatus: 400,
        code: 'ACTIVE_APPLICATION',
        message: isEn ? errorBilingual.en : errorBilingual.tr,
        errorBilingual,
        threadId: activeApp.threadId,
      };
    } else {
      database.removeActiveApplication(targetUser.id);
    }
  }

  // 3. Ad / Takma Ad Doğrulaması
  const rawName = name !== undefined ? name : realName;
  const nameCheck = validateDisplayName(rawName);
  if (!nameCheck.ok) {
    return {
      success: false,
      httpStatus: 400,
      code: 'NAME_INVALID',
      canRetry: true,
      message: isEn ? nameCheck.error.en : nameCheck.error.tr,
      errorBilingual: nameCheck.error,
    };
  }
  const cleanDisplayName = nameCheck.value;

  // 4. Seçilen Oyunların Hazırlanması ve Doğrulanması (Geriye dönük robloxInput desteğiyle)
  let rawGamesList = Array.isArray(games) ? games : [];
  if (rawGamesList.length === 0 && robloxInput) {
    rawGamesList = [{ id: 'roblox', username: robloxInput }];
  }

  if (!Array.isArray(rawGamesList) || rawGamesList.length === 0) {
    const errorBilingual = {
      tr: 'Kayıt olmak için lütfen en az bir oyun seçiniz.',
      en: 'Please select at least one game to register.',
    };
    return {
      success: false,
      httpStatus: 400,
      code: 'NO_GAME_SELECTED',
      message: isEn ? errorBilingual.en : errorBilingual.tr,
      errorBilingual,
    };
  }

  // Gelen oyunları tekrarsız ve games.config.js sırasıyla normalize et
  const inputMap = new Map();
  for (const item of rawGamesList) {
    if (!item || typeof item !== 'object') continue;
    const gid = String(item.id || '').trim().toLowerCase();
    const gameCfg = gamesConfig.getGameById(gid);
    if (!gameCfg || gameCfg.enabled === false) {
      const errorBilingual = {
        tr: `Desteklenmeyen veya kapalı oyun: ${gid || 'bilinmiyor'}`,
        en: `Unsupported or disabled game: ${gid || 'unknown'}`,
      };
      return {
        success: false,
        httpStatus: 400,
        code: 'GAME_USERNAME_INVALID',
        details: { game: gid || 'unknown' },
        canRetry: true,
        message: isEn ? errorBilingual.en : errorBilingual.tr,
        errorBilingual,
      };
    }
    inputMap.set(gid, item);
  }

  const orderedGames = [];
  for (const cfg of gamesConfig.getEnabledGames()) {
    const provided = inputMap.get(cfg.id);
    if (!provided) continue;

    const userCheck = validateGameUsername(cfg, provided.username);
    if (!userCheck.ok) {
      return {
        success: false,
        httpStatus: 400,
        code: 'GAME_USERNAME_INVALID',
        details: { game: cfg.id },
        canRetry: true,
        message: isEn ? userCheck.error.en : userCheck.error.tr,
        errorBilingual: userCheck.error,
      };
    }

    orderedGames.push({
      id: cfg.id,
      username: userCheck.value,
      roblox: provided.roblox || null,
      verifier: cfg.verifier || null,
    });
  }

  if (orderedGames.length === 0) {
    const errorBilingual = {
      tr: 'Lütfen desteklenen en az bir oyun seçiniz.',
      en: 'Please select at least one supported game.',
    };
    return {
      success: false,
      httpStatus: 400,
      code: 'NO_GAME_SELECTED',
      message: isEn ? errorBilingual.en : errorBilingual.tr,
      errorBilingual,
    };
  }

  // 5. Oyun Doğrulamaları (Roblox API) + Diğer Oyunlar İçin Bilgi Amaçlı Çakışma Tespiti
  let resolvedRobloxUser = null;
  const finalizedGames = [];
  const duplicateGameNotices = [];

  for (const gameItem of orderedGames) {
    if (gameItem.verifier === 'roblox') {
      let rbUser = gameItem.roblox;

      if (!rbUser) {
        const robloxResult = await robloxService.resolveUser(gameItem.username);
        if (!robloxResult.success) {
          if (robloxResult.error === 'NOT_FOUND') {
            console.log(
              `[KAYIT ROBLOX NOT_FOUND] Kullanıcı: ${targetUser.tag || targetUser.id}, Girdi: "${gameItem.username}"`
            );
            const errorBilingual = {
              tr: "Başvurun reddedildi: Roblox'ta bu kullanıcı adıyla bir hesap bulunamadı. Lütfen görünen adını (Display Name) değil asıl @kullanıcı adını yazarak tekrar dene.",
              en: 'Application rejected: No Roblox account was found with that username. Please enter your actual @username — not your Display Name — and try again.',
            };
            return {
              success: false,
              httpStatus: 400,
              code: 'ROBLOX_NOT_FOUND',
              canRetry: true,
              message: isEn ? errorBilingual.en : errorBilingual.tr,
              errorBilingual,
            };
          }

          if (robloxResult.error === 'BANNED') {
            const errorBilingual = {
              tr: 'Başvurun reddedildi: Bu Roblox hesabı Roblox platformunda kalıcı olarak yasaklanmıştır (Banned)!',
              en: 'Application rejected: This Roblox account is permanently banned/terminated on Roblox!',
            };
            return {
              success: false,
              httpStatus: 400,
              code: 'ROBLOX_BANNED',
              canRetry: false,
              message: isEn ? errorBilingual.en : errorBilingual.tr,
              errorBilingual,
            };
          }

          // Geçici API/zaman aşımı/limit hatası: kullanıcı yok sanma, reddetme
          const errorBilingual = {
            tr: 'Roblox şu an doğrulanamıyor, birkaç dakika sonra tekrar dene.',
            en: 'Roblox cannot be verified right now. Please try again in a few minutes.',
          };
          return {
            success: false,
            httpStatus: 503,
            code: 'ROBLOX_LOOKUP_FAILED',
            canRetry: true,
            message: isEn ? errorBilingual.en : errorBilingual.tr,
            errorBilingual,
          };
        }

        rbUser = robloxResult.user;
      }

      // Çoklu hesap koruması
      const existingReg = database.getRegistrationByRobloxId(rbUser.id);
      if (existingReg && String(existingReg.discordId) !== String(targetUser.id)) {
        const errorBilingual = {
          tr: `Bu Roblox hesabı ([${rbUser.name}](https://www.roblox.com/users/${rbUser.id}/profile)) sunucumuzda başka bir Discord kullanıcısına (<@${existingReg.discordId}>) zaten kayıtlıdır!`,
          en: `This Roblox account ([${rbUser.name}](https://www.roblox.com/users/${rbUser.id}/profile)) is already registered to another Discord user (<@${existingReg.discordId}>)!`,
        };
        return {
          success: false,
          httpStatus: 409,
          code: 'ROBLOX_ALREADY_REGISTERED',
          canRetry: true,
          message: isEn ? errorBilingual.en : errorBilingual.tr,
          errorBilingual,
        };
      }

      resolvedRobloxUser = rbUser;
      finalizedGames.push({
        id: gameItem.id,
        username: rbUser.name || gameItem.username,
        verified: true,
        robloxId: String(rbUser.id),
        robloxProfileUrl: `https://www.roblox.com/users/${rbUser.id}/profile`,
      });
    } else {
      // Doğrulanmayan oyunlar (CS2, Zula, Minecraft): temizlenmiş haliyle kaydet ve bilgi amaçlı çakışma kontrolü yap
      finalizedGames.push({
        id: gameItem.id,
        username: gameItem.username,
        verified: false,
      });

      const dupMatches = database.findRegistrationsByGameUsername(gameItem.id, gameItem.username, {
        excludeDiscordId: targetUser.id,
      });
      if (dupMatches.length > 0) {
        const cfg = gamesConfig.getGameById(gameItem.id);
        const labelTr = cfg ? gamesConfig.getGameLabel(cfg, 'tr') : gameItem.id;
        const mentions = dupMatches.slice(0, 3).map((m) => `<@${m.discordId}>`).join(', ');
        duplicateGameNotices.push(
          `ℹ️ **${labelTr}:** Bu kullanıcı adı başka bir üyede de kayıtlı: ${mentions}`
        );
      }
    }
  }

  // 6. Özel Kayıt Odası (Thread) Oluşturma
  const registerChannel =
    guild.channels.cache.get(config.CHANNELS.REGISTER) ||
    (await guild.channels.fetch(config.CHANNELS.REGISTER).catch(() => null));

  if (!registerChannel) {
    return {
      success: false,
      httpStatus: 500,
      code: 'CHANNEL_NOT_FOUND',
      message: isEn ? 'Registration channel not found!' : 'Kayıt kanalı bulunamadı!',
    };
  }

  let thread;
  try {
    thread = await registerChannel.threads.create({
      name: `🟡・${targetUser.username}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `Özel Kayıt Odası - ${cleanDisplayName} (${targetUser.tag}) [${source}]`,
    });
  } catch (err) {
    try {
      thread = await registerChannel.threads.create({
        name: `🟡・${targetUser.username}`,
        autoArchiveDuration: 1440,
        type: ChannelType.PublicThread,
        reason: `Özel Kayıt Odası - ${cleanDisplayName} (${targetUser.tag}) [${source}]`,
      });
    } catch (createErr) {
      console.error('[THREAD ERROR] Kayıt odası oluşturulamadı:', createErr);
      return {
        success: false,
        httpStatus: 500,
        code: 'THREAD_CREATE_ERROR',
        message: isEn
          ? 'An error occurred while creating your private registration thread. Please contact staff.'
          : 'Özel kayıt odası oluşturulurken bir hata meydana geldi. Lütfen yetkililer ile iletişime geçiniz.',
      };
    }
  }

  await thread.members.add(targetUser.id).catch(() => {});

  const threadGamesList = finalizedGames
    .map((g) => {
      const cfg = gamesConfig.getGameById(g.id);
      const emoji = cfg?.emoji || '🎮';
      const label = cfg ? gamesConfig.getGameLabel(cfg, userLang) : g.id;
      return `> ${emoji} **${label}** ➜ \`${sanitizeInlineCode(g.username, 64)}\``;
    })
    .join('\n');

  const isWebSource = source === 'web' || source === 'site';

  const threadInfoEmbed = new EmbedBuilder()
    .setTitle(isEn ? '🟡 Application Under Review...' : '🟡 Başvuru İnceleniyor...')
    .setColor(config.COLORS.PENDING)
    .setDescription(
      isEn
        ? `👋 Welcome <@${targetUser.id}>!\n\n` +
          `📋 **Submitted Details:**\n` +
          `• **Name:** ${escapeEmbedText(cleanDisplayName, 64)}\n` +
          `• **Selected Games:**\n${threadGamesList}\n\n` +
          (isWebSource ? `• Application source: **Website Registration Form** 🌐\n` : '') +
          `• Your application has been forwarded to our staff approval channel.\n` +
          `• Once approved by staff, your member & game roles will be assigned automatically and this thread will be closed.\n` +
          `• If rejected, the reason will be sent here and via Direct Message (DM).\n\n` +
          `⏳ *Please wait patiently for a staff member to review your application.*`
        : `👋 Hoş geldin <@${targetUser.id}>!\n\n` +
          `📋 **Başvuru Bilgilerin:**\n` +
          `• **Ad / Takma Ad:** ${escapeEmbedText(cleanDisplayName, 64)}\n` +
          `• **Seçilen Oyunlar:**\n${threadGamesList}\n\n` +
          (isWebSource ? `• Başvuru kaynağı: **Web Sitesi Kayıt Formu** 🌐\n` : '') +
          `• Başvurun yetkili onay kanalına iletildi.\n` +
          `• Yetkililerimiz onayladığında üye ve oyun rollerin otomatik olarak verilecek ve bu oda silinecektir.\n` +
          `• Başvurun reddedilirse, red sebebi bu odadan ve DM üzerinden bildirilecektir.\n\n` +
          `⏳ *Lütfen yetkili kararını sabırla bekleyiniz.*`
    )
    .setFooter({
      text: isEn
        ? `${config.BRAND_NAME} • Registration System${isWebSource ? ' • Web Registration' : ''}`
        : `${config.BRAND_NAME} • Kayıt Sistemi${isWebSource ? ' • Web Kayıt' : ''}`,
    })
    .setTimestamp();

  await thread
    .send({
      content: `<@${targetUser.id}>`,
      embeds: [threadInfoEmbed],
      allowedMentions: { parse: [], users: [targetUser.id] },
    })
    .catch(() => {});

  // 7. Yetkili Onay Kartı Gönderme
  const staffChannel =
    guild.channels.cache.get(config.CHANNELS.STAFF_APPROVAL) ||
    (await guild.channels.fetch(config.CHANNELS.STAFF_APPROVAL).catch(() => null));
  let staffMessage = null;

  if (staffChannel) {
    const staffEmbed = buildStaffApprovalEmbed({
      guild,
      member,
      user: targetUser,
      displayName: cleanDisplayName,
      genderInfo,
      langCode: userLang,
      source,
      games: finalizedGames,
      robloxUser: resolvedRobloxUser,
      duplicateGameNotices,
      thread,
    });

    const buttons = [
      new ButtonBuilder()
        .setCustomId(`btn_approve_${targetUser.id}`)
        .setLabel('✅ ONAYLA')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`btn_reject_${targetUser.id}`)
        .setLabel('✖️ REDDET')
        .setStyle(ButtonStyle.Danger),
    ];

    if (resolvedRobloxUser && /^\d+$/.test(String(resolvedRobloxUser.id))) {
      buttons.push(
        new ButtonBuilder()
          .setLabel('🧱 Roblox Profili')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/users/${resolvedRobloxUser.id}/profile`)
      );
    }

    const buttonsRow = new ActionRowBuilder().addComponents(buttons);

    staffMessage = await staffChannel
      .send({
        content: config.ROLES.STAFF ? `<@&${config.ROLES.STAFF}>` : undefined,
        embeds: [staffEmbed],
        components: [buttonsRow],
        allowedMentions: {
          parse: [],
          roles: config.ROLES.STAFF ? [config.ROLES.STAFF] : [],
        },
      })
      .catch(() => null);
  }

  // 8. Aktif Başvuruyu Veritabanına Kaydet
  const storedGames = finalizedGames.map((g) => ({
    id: g.id,
    username: g.username,
    verified: Boolean(g.verified),
    ...(g.robloxId ? { robloxId: g.robloxId } : {}),
    ...(g.robloxProfileUrl ? { robloxProfileUrl: g.robloxProfileUrl } : {}),
  }));

  database.setActiveApplication(targetUser.id, {
    threadId: thread.id,
    displayName: cleanDisplayName,
    realName: cleanDisplayName,
    gender: normalizedGender,
    lang: userLang,
    games: storedGames,
    robloxId: resolvedRobloxUser ? String(resolvedRobloxUser.id) : null,
    robloxUsername: resolvedRobloxUser ? resolvedRobloxUser.name : null,
    robloxDisplayName: resolvedRobloxUser ? resolvedRobloxUser.displayName : null,
    staffMessageId: staffMessage ? staffMessage.id : null,
    staffChannelId: staffChannel ? staffChannel.id : null,
    source: isWebSource ? 'web' : 'discord',
  });

  return {
    success: true,
    message: isEn
      ? 'Your registration application has been submitted! Your private registration thread has been created.'
      : 'Başvurunuz başarıyla alındı! Size özel kayıt odası açıldı.',
    threadId: thread.id,
    threadUrl: thread.url,
    games: storedGames,
    robloxUser: resolvedRobloxUser
      ? {
          id: resolvedRobloxUser.id,
          name: resolvedRobloxUser.name,
          displayName: resolvedRobloxUser.displayName,
          profileUrl: `https://www.roblox.com/users/${resolvedRobloxUser.id}/profile`,
          avatarUrl: resolvedRobloxUser.avatarUrl,
        }
      : null,
  };
}

module.exports = {
  createRegistrationApplication,
  buildStaffApprovalEmbed,
  resolveExpectedRolesInfo,
  formatApprovedNickname,
  checkRegistrationRateLimit,
  recordRegistrationAttempt,
  clearRegistrationRateLimits,
  REG_RATE_WINDOW_MS,
  REG_RATE_MAX_ATTEMPTS,
};
