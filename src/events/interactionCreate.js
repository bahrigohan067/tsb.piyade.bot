const {
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const gamesConfig = require('../../games.config');
const database = require('../utils/database');
const { handleColorButton, createEnglishColorGuideEmbed } = require('../utils/colorManager');
const {
  handleWarningButton,
  handleWarningUserSelected,
  handleVerbalWarnModalSubmit,
  handleOfficialWarnModalSubmit,
  handleProofButton,
  handleWarningLogEnglishButton,
} = require('../utils/warningManager');
const {
  createRegistrationApplication,
  formatApprovedNickname,
  checkRegistrationRateLimit,
  recordRegistrationAttempt,
} = require('../services/registrationService');
const {
  resolveLang,
  parseGenderInput,
  updateLocaleHintFromInteraction,
  healLegacyLanguageOnInteraction,
} = require('../utils/i18n');
const { sanitizeInlineCode, escapeEmbedText } = require('../utils/inputSanitizer');

// Eşzamanlı onay kilitleri (Aynı kullanıcıya çift tıklamayı engeller)
const approvalUserLocks = new Set();

// Hata sonrası "Tekrar dene" için girilen modal verilerini 10 dakika saklayan önbellek
const RETRY_DRAFT_TTL_MS = 10 * 60 * 1000;
const retryDraftCache = new Map();

/**
 * Tekrar dene taslağını bellek önbelleğine kaydeder (10 dakika TTL).
 */
function saveRetryDraft(userId, draft, now = Date.now()) {
  if (!userId) return;
  retryDraftCache.set(String(userId), {
    ...draft,
    expiresAt: now + RETRY_DRAFT_TTL_MS,
  });
}

/**
 * Süresi dolmamışsa kullanıcının tekrar dene taslağını döndürür; dolmuşsa silip null döner.
 */
function getRetryDraft(userId, now = Date.now()) {
  if (!userId) return null;
  const uid = String(userId);
  const entry = retryDraftCache.get(uid);
  if (!entry) return null;
  if (now > entry.expiresAt) {
    retryDraftCache.delete(uid);
    return null;
  }
  return entry;
}

/**
 * Kullanıcının tekrar dene taslağını temizler.
 */
function clearRetryDraft(userId) {
  if (!userId) return;
  retryDraftCache.delete(String(userId));
}

/**
 * Eski kayıt menüsü customId'lerini algılar (panelden yeniden başlatma uyarısı vermek için).
 */
function isLegacyRegistrationInteraction(customId) {
  if (!customId || typeof customId !== 'string') return false;
  const lower = customId.toLowerCase();
  if (
    lower === 'select_gender' ||
    lower === 'select_gender_en' ||
    lower === 'select_kayit_cinsiyet' ||
    lower.startsWith('select_gender_') ||
    lower.startsWith('modal_kayit_') ||
    lower.startsWith('btn_reg_type_') ||
    lower.startsWith('btn_clan_') ||
    lower.startsWith('modal_clan_')
  ) {
    return true;
  }
  return false;
}

/**
 * Kaldırılan eski sistemlerin (Tryout, Acil Yardım, Klan, VS) customId kontrolü
 */
function isLegacyInteraction(customId) {
  if (!customId || typeof customId !== 'string') return false;
  const legacyPatterns = [
    'tryout',
    'btn_tryout',
    'modal_tryout',
    'select_tryout',
    'help',
    'btn_help',
    'yardim',
    'btn_acil_yardim',
    'clan',
    'klan',
    'vs_',
    'btn_vs',
    'modal_vs',
    'select_vs',
  ];

  return legacyPatterns.some((pattern) => customId.toLowerCase().includes(pattern));
}

/**
 * Eskimiş veya geçersiz mask/menü mesajı döndürür.
 */
function getExpiredMenuPayload(lang = 'tr') {
  const isEn = lang === 'en';
  return {
    content: isEn
      ? '⚠️ This menu has expired, please press the button on the registration panel again.'
      : '⚠️ Bu menü eskidi, lütfen kayıt panelindeki butona tekrar bas.',
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

/**
 * Seçilen oyun mask'ına göre çoklu oyun seçim mesajını ve butonlarını üretir.
 */
function buildGameSelectionPayload(mask = 0, lang = 'tr', userId = null) {
  const isEn = lang === 'en';
  const enabledGames = gamesConfig.getEnabledGames();
  const validMask = gamesConfig.parseMask(mask, { allowZero: true }) ?? 0;

  const selectedText = gamesConfig.formatGamesFromMask(validMask, lang);
  const headerText = isEn
    ? `👋 Welcome${userId ? ` <@${userId}>` : ''}! Select the games you play 🎮 *(you can choose multiple, each once)*`
    : `👋 Hoş geldin${userId ? ` <@${userId}>` : ''}! Oynadığın oyunları seç 🎮 *(birden fazla seçebilirsin, her oyunu bir kez seçebilirsin)*`;

  const selectedLine =
    validMask > 0
      ? isEn
        ? `\n\n🎯 **Selected:** ${selectedText}`
        : `\n\n🎯 **Seçtiklerin:** ${selectedText}`
      : isEn
        ? `\n\n🎯 **Selected:** *None yet*`
        : `\n\n🎯 **Seçtiklerin:** *Henüz seçim yapılmadı*`;

  // 1. Satır: Oyun butonları (games.config.js sırasıyla, en çok 4 oyun)
  const gameRow = new ActionRowBuilder();
  for (const game of enabledGames) {
    const bit = gamesConfig.getGameBit(game.id);
    const isSelected = (validMask & bit) !== 0;
    const baseLabel = gamesConfig.getGameLabel(game, lang);
    const label = isSelected ? `✅ ${baseLabel}` : baseLabel;

    gameRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`reg_g:${game.id}:${validMask}:${lang}`)
        .setLabel(label.slice(0, 80))
        .setEmoji(game.emoji)
        .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(isSelected)
    );
  }

  // 2. Satır: Sıfırla + Devam
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reg_rs:${lang}`)
      .setLabel(isEn ? 'Reset' : 'Sıfırla')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reg_go:${validMask}:${lang}`)
      .setLabel(isEn ? 'Continue' : 'Devam')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(validMask === 0)
  );

  // 3. Satır: Dil değiştirme butonu (veritabanına kalıcı YAZMAZ, sadece mevcut akış için)
  const langRow = buildLanguageToggleRow('g', validMask, '-', lang);

  return {
    content: `${headerText}${selectedLine}`,
    components: [gameRow, controlRow, langRow],
    allowedMentions: { parse: [] },
  };
}

/**
 * Seçilen oyunlara göre cinsiyet seçim menüsü yükünü üretir (Adım 4).
 */
function buildGenderSelectPayload(mask, lang = 'tr') {
  const isEn = lang === 'en';
  const validMask = gamesConfig.parseMask(mask, { allowZero: false }) ?? mask;
  const selectedText = gamesConfig.formatGamesFromMask(validMask, lang);

  const genderSelect = new StringSelectMenuBuilder()
    .setCustomId(`reg_gender:${validMask}:${lang}`)
    .setPlaceholder(isEn ? 'Select your gender...' : 'Cinsiyetini seç...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Male' : 'Erkek')
        .setEmoji('👦')
        .setValue('m')
        .setDescription(isEn ? 'Continue as Male member' : 'Erkek üye olarak devam et'),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Female' : 'Kız')
        .setEmoji('👧')
        .setValue('f')
        .setDescription(isEn ? 'Continue as Female member' : 'Kız üye olarak devam et')
    );

  const row = new ActionRowBuilder().addComponents(genderSelect);
  const langRow = buildLanguageToggleRow('s', validMask, '-', lang);

  return {
    content: isEn
      ? `🎮 **Selected Games:** ${selectedText}\n\n⚧ Now select your **Gender** from the menu below to open the registration survey:`
      : `🎮 **Seçilen Oyunlar:** ${selectedText}\n\n⚧ Kayıt anketini açmak için şimdi aşağıdan **Cinsiyetini** seç:`,
    components: [row, langRow],
    allowedMentions: { parse: [] },
  };
}

/**
 * Seçilen oyun mask'ı, cinsiyet ve dil koduna göre kayıt anket modalını üretir (Adım 5).
 * Toplam alan sayısı = 1 (Ad) + seçilen oyun sayısı (en çok 5).
 */
function buildRegistrationModal({ mask, genderCode, lang = 'tr', prefill = null }) {
  const isEn = lang === 'en';
  const cleanGender = genderCode === 'f' ? 'f' : 'm';
  const selectedGames = gamesConfig.getGamesFromMask(mask);

  const rawTitle = isEn
    ? `${config.BRAND_NAME} | Registration Survey`
    : `${config.BRAND_NAME} | Kayıt Anketi`;

  const modal = new ModalBuilder()
    .setCustomId(`reg_form:${mask}:${cleanGender}:${lang}`)
    .setTitle(rawTitle.slice(0, 45));

  const nameInput = new TextInputBuilder()
    .setCustomId('f_name')
    .setLabel((isEn ? 'May we know your name?' : 'Adını öğrenebilir miyiz?').slice(0, 45))
    .setPlaceholder(
      (isEn
        ? 'You can use a nickname if you prefer.'
        : 'İsmini yazmak istemiyorsan takma ad koyabilirsin.'
      ).slice(0, 100)
    )
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(32)
    .setRequired(true);

  if (prefill?.name && typeof prefill.name === 'string') {
    const val = prefill.name.trim().slice(0, 32);
    if (val.length >= 2) {
      nameInput.setValue(val);
    }
  }

  const rows = [new ActionRowBuilder().addComponents(nameInput)];

  for (const game of selectedGames) {
    const minLen = game.validate?.min ?? (game.verifier === 'roblox' ? 3 : 2);
    const maxLen = game.validate?.max ?? (game.verifier === 'roblox' ? 100 : 32);

    const label = (game.usernameLabel?.[lang] || game.usernameLabel?.tr || game.id).slice(0, 45);
    const placeholder = (
      game.usernamePlaceholder?.[lang] ||
      game.usernamePlaceholder?.tr ||
      ''
    ).slice(0, 100);

    const gameInput = new TextInputBuilder()
      .setCustomId(`f_${game.id}`)
      .setLabel(label)
      .setPlaceholder(placeholder)
      .setStyle(TextInputStyle.Short)
      .setMinLength(minLen)
      .setMaxLength(maxLen)
      .setRequired(true);

    const prefillGameVal = prefill?.games?.[game.id];
    if (prefillGameVal && typeof prefillGameVal === 'string') {
      const sliced = prefillGameVal.trim().slice(0, maxLen);
      if (sliced.length >= minLen) {
        gameInput.setValue(sliced);
      }
    }

    rows.push(new ActionRowBuilder().addComponents(gameInput));
  }

  modal.addComponents(rows);
  return modal;
}

/**
 * Kayıt akışı içinde veritabanına yazmadan anlık dil değiştiren butonu oluşturur.
 * Format: reg_lang:<adım>:<mask>:<m|f|->:<yeniDil> (customId <= 100 karakter)
 */
function buildLanguageToggleButton(step, mask = 0, genderCode = '-', currentLang = 'tr') {
  const targetLang = currentLang === 'en' ? 'tr' : 'en';
  const safeStep = String(step || 'g').slice(0, 8);
  const safeMask = Number.isInteger(Number(mask)) && Number(mask) >= 0 ? Number(mask) : 0;
  const safeGender = genderCode === 'm' || genderCode === 'f' ? genderCode : '-';

  return new ButtonBuilder()
    .setCustomId(`reg_lang:${safeStep}:${safeMask}:${safeGender}:${targetLang}`)
    .setLabel(currentLang === 'en' ? '🇹🇷 Türkçe' : '🇬🇧 English')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Dil değiştirme butonunu tek satırlık ActionRow olarak döndürür.
 */
function buildLanguageToggleRow(step, mask = 0, genderCode = '-', currentLang = 'tr') {
  return new ActionRowBuilder().addComponents(
    buildLanguageToggleButton(step, mask, genderCode, currentLang)
  );
}

/**
 * Tekrar dene + dil değiştirme butonlarını TEK satırda (<= 5 buton) döndürür.
 */
function buildRetryRow(mask, genderCode, lang = 'tr', { canRetry = true } = {}) {
  const isEn = lang === 'en';
  const row = new ActionRowBuilder();

  if (canRetry) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`reg_retry:${mask}:${genderCode}:${lang}`)
        .setLabel(isEn ? 'Try again' : 'Tekrar dene')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary)
    );
  }

  row.addComponents(buildLanguageToggleButton('r', mask, genderCode, lang));
  return row;
}

/**
 * Kayıt ön kontrol ve hız sınırı hatalarını dil değiştirme butonuyla üretir.
 */
function buildPrecheckErrorPayload(stepCode, lang = 'tr', extra = {}) {
  const isEn = lang === 'en';
  let content = '';

  if (stepCode === 'p0') {
    content = isEn
      ? '❌ You are already registered on our server! You cannot submit another application.'
      : '❌ Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.';
  } else if (stepCode === 'p1') {
    const threadPart = extra.threadId
      ? `<#${extra.threadId}>`
      : isEn
        ? 'your registration channel'
        : 'kayıt odanızı';
    content = isEn
      ? `⚠️ You already have an active registration application! Please check your registration thread: ${threadPart}`
      : `⚠️ Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: ${threadPart}`;
  } else if (stepCode === 'p3') {
    const sec = Number.isFinite(Number(extra.retryAfterSec)) ? Math.max(1, Number(extra.retryAfterSec)) : 1;
    content = isEn
      ? `⏳ You have submitted too many forms recently. Please wait **${sec} seconds** and try again.`
      : `⏳ Son 10 dakikada çok fazla kayıt formu gönderdin. Lütfen **${sec} saniye** bekleyip tekrar dene.`;
  } else {
    const sec = Number.isFinite(Number(extra.retryAfterSec)) ? Math.max(1, Number(extra.retryAfterSec)) : 1;
    content = isEn
      ? `⏳ You have submitted too many registration attempts recently. Please try again in **${sec} seconds**.`
      : `⏳ Çok sık kayıt başvurusu denemesi yaptın. Lütfen **${sec} saniye** sonra tekrar dene.`;
  }

  return {
    content,
    components: [buildLanguageToggleRow(stepCode, 0, '-', lang)],
    allowedMentions: { parse: [] },
  };
}

/**
 * Modal gönderim hatası veya doğrulama hatası yükünü Tekrar Dene + Dil Değiştir butonlarıyla üretir.
 */
function buildModalErrorPayload({ mask, genderCode, lang = 'tr', message = '', canRetry = true }) {
  const cleanMsg = String(message || '').trim();
  const prefix = cleanMsg.startsWith('⚠️') || cleanMsg.startsWith('❌') ? '' : '❌ ';

  return {
    content: `${prefix}${cleanMsg}`,
    components: [buildRetryRow(mask, genderCode, lang, { canRetry })],
    allowedMentions: { parse: [] },
  };
}

/**
 * Kayıt yetkilisi yetkisi kontrolü (Onayla & Reddet butonları için).
 */
function hasRegistrationStaffPermission(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const staffRoleIds = [
    config.ROLES.STAFF,
    config.ROLES.STAFF_GENERAL,
    config.ROLES.TRYOUT_STAFF,
    config.ROLES.DEVELOPER,
    config.ROLES.FOUNDER,
    config.ROLES.COMMUNITY_OFFICIAL,
  ].filter(Boolean);
  return staffRoleIds.some((rId) => member.roles?.cache?.has?.(rId));
}

module.exports = {
  name: Events.InteractionCreate,
  buildGameSelectionPayload,
  buildGenderSelectPayload,
  buildRegistrationModal,
  buildLanguageToggleButton,
  buildLanguageToggleRow,
  buildRetryRow,
  buildPrecheckErrorPayload,
  buildModalErrorPayload,
  saveRetryDraft,
  getRetryDraft,
  clearRetryDraft,
  isLegacyRegistrationInteraction,
  isLegacyInteraction,
  hasRegistrationStaffPermission,
  handleApprove,
  handleRejectButton,
  handleRejectModalSubmit,
  handleRegistrationModalSubmit,
  RETRY_DRAFT_TTL_MS,

  async execute(interaction) {
    try {
      // Kullanıcının Discord istemci dilini arka planda hatırla ve eski (legacy) Türkçe kayıtları iyileştir
      updateLocaleHintFromInteraction(interaction);
      await healLegacyLanguageOnInteraction(interaction);

      // 0. AUTOCOMPLETE ETKİLEŞİMLERİ
      if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command && typeof command.autocomplete === 'function') {
          await command.autocomplete(interaction);
        }
        return;
      }

      // 1. SLASH KOMUTLAR
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      // 2A. ESKİ KAYIT MENÜLERİ YAKALAYICISI (Panel butonuna tekrar basma yönlendirmesi)
      if (interaction.customId && isLegacyRegistrationInteraction(interaction.customId)) {
        const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
        return interaction.reply(getExpiredMenuPayload(isEn ? 'en' : 'tr')).catch(() => {});
      }

      // 2B. KALDIRILAN ESKİ SİSTEMLERİN ETKİLEŞİM YAKALAYICISI
      if (interaction.customId && isLegacyInteraction(interaction.customId)) {
        const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
        return interaction
          .reply({
            content: isEn
              ? '⚠️ This feature has been removed. / Bu özellik kaldırıldı.'
              : '⚠️ Bu özellik kaldırıldı. / This feature has been removed.',
            ephemeral: true,
          })
          .catch(() => {});
      }

      // 3. BUTON ETKİLEŞİMLERİ
      if (interaction.isButton()) {
        // [A1] Kayıt Paneli Butonları: "✅ Kayıt Ol (Türkçe)" ve "🇬🇧 Register (English)"
        if (interaction.customId === 'btn_kayit_ol' || interaction.customId === 'btn_kayit_ol_en') {
          const isEnClick = interaction.customId === 'btn_kayit_ol_en';
          // Dil seçimi YALNIZCA bu kayıt akışı içindir; kalıcı veritabanına ve role YAZILMAZ.
          const lang = isEnClick ? 'en' : resolveLang(interaction);

          // Ön kontrol 1: Zaten kayıtlı mı?
          if (config.isRegisteredMember(interaction.member)) {
            return interaction.reply({
              ...buildPrecheckErrorPayload('p0', lang),
              ephemeral: true,
            });
          }

          // Ön kontrol 2: Aktif başvurusu var mı?
          const activeApp = database.getActiveApplication(interaction.user.id);
          if (activeApp && activeApp.threadId) {
            const existingThread = await interaction.guild.channels
              .fetch(activeApp.threadId)
              .catch(() => null);
            if (existingThread) {
              return interaction.reply({
                ...buildPrecheckErrorPayload('p1', lang, { threadId: activeApp.threadId }),
                ephemeral: true,
              });
            }
            database.removeActiveApplication(interaction.user.id);
          }

          // Ön kontrol 3: Kayıt hız sınırı kontrolü (10 dakikada max 5 form gönderimi)
          const rateCheck = checkRegistrationRateLimit(interaction.user.id);
          if (rateCheck.limited) {
            return interaction.reply({
              ...buildPrecheckErrorPayload('p2', lang, { retryAfterSec: rateCheck.retryAfterSec }),
              ephemeral: true,
            });
          }

          const payload = buildGameSelectionPayload(0, lang, interaction.user.id);
          return interaction.reply({
            ...payload,
            ephemeral: true,
          });
        }

        // [A6] Akış İçi Dil Değiştirme Butonu: reg_lang:<adım>:<mask>:<m|f|->:<yeniDil>
        if (interaction.customId.startsWith('reg_lang:')) {
          const parts = interaction.customId.split(':');
          const step = parts[1];
          const rawMask = parts[2];
          const rawGender = parts[3];
          const targetLang = parts[4] === 'en' ? 'en' : parts[4] === 'tr' ? 'tr' : null;

          if (parts.length !== 5 || !step || !targetLang) {
            return interaction.reply(getExpiredMenuPayload(resolveLang(interaction)));
          }

          if (step === 'g') {
            const mask = gamesConfig.parseMask(rawMask, { allowZero: true });
            if (mask === null) {
              return interaction.reply(getExpiredMenuPayload(targetLang));
            }
            return interaction.update(buildGameSelectionPayload(mask, targetLang, interaction.user.id));
          }

          if (step === 's') {
            const mask = gamesConfig.parseMask(rawMask, { allowZero: false });
            if (mask === null) {
              return interaction.reply(getExpiredMenuPayload(targetLang));
            }
            return interaction.update(buildGenderSelectPayload(mask, targetLang));
          }

          if (step === 'r') {
            const mask = gamesConfig.parseMask(rawMask, { allowZero: false });
            const genderCode = rawGender === 'm' || rawGender === 'f' ? rawGender : null;
            if (mask === null || !genderCode) {
              return interaction.reply(getExpiredMenuPayload(targetLang));
            }

            const draft = getRetryDraft(interaction.user.id);
            const matchingDraft = draft && draft.mask === mask ? draft : null;
            if (matchingDraft) {
              // Bellekteki taslağın dilini güncelle; veritabanına ASLA yazma
              saveRetryDraft(interaction.user.id, {
                ...matchingDraft,
                lang: targetLang,
              });
              const translatedMsg =
                matchingDraft.errorBilingual?.[targetLang] ||
                matchingDraft.errorMessage ||
                (targetLang === 'en'
                  ? 'Please review your details and try again.'
                  : 'Lütfen bilgilerini kontrol edip tekrar dene.');
              return interaction.update(
                buildModalErrorPayload({
                  mask,
                  genderCode,
                  lang: targetLang,
                  message: translatedMsg,
                  canRetry: matchingDraft.canRetry !== false,
                })
              );
            }

            return interaction.update(
              buildModalErrorPayload({
                mask,
                genderCode,
                lang: targetLang,
                message:
                  targetLang === 'en'
                    ? 'Your previous details may have expired; you can press Try again to re-enter them.'
                    : 'Önceki hata detayı süresi dolmuş olabilir; Tekrar dene butonuna basarak yeniden gönderebilirsin.',
                canRetry: true,
              })
            );
          }

          if (step === 'p0' || step === 'p1' || step === 'p2' || step === 'p3') {
            const extra = {};
            if (step === 'p1') {
              const activeApp = database.getActiveApplication(interaction.user.id);
              extra.threadId = activeApp?.threadId || null;
            } else if (step === 'p2' || step === 'p3') {
              const rateCheck = checkRegistrationRateLimit(interaction.user.id);
              extra.retryAfterSec = rateCheck.retryAfterSec || 1;
            }
            return interaction.update(buildPrecheckErrorPayload(step, targetLang, extra));
          }

          return interaction.reply(getExpiredMenuPayload(targetLang));
        }

        // [A2] Oyun Seçim Butonları: reg_g:<oyunId>:<mask>:<dil>
        if (interaction.customId.startsWith('reg_g:')) {
          const parts = interaction.customId.split(':');
          const gameId = parts[1];
          const mask = gamesConfig.parseMask(parts[2], { allowZero: true });
          const lang = parts[3] === 'en' ? 'en' : parts[3] === 'tr' ? 'tr' : null;
          const gameCfg = gamesConfig.getGameById(gameId);
          const gameBit = gameCfg ? gamesConfig.getGameBit(gameCfg.id) : 0;

          if (parts.length !== 4 || mask === null || !lang || !gameCfg || gameCfg.enabled === false || gameBit === 0) {
            return interaction.reply(getExpiredMenuPayload(resolveLang(interaction)));
          }

          const newMask = mask | gameBit;
          if (gamesConfig.parseMask(newMask, { allowZero: false }) === null) {
            return interaction.reply(getExpiredMenuPayload(lang));
          }

          const payload = buildGameSelectionPayload(newMask, lang, interaction.user.id);
          return interaction.update(payload);
        }

        // [A3] Sıfırla Butonu: reg_rs:<dil>
        if (interaction.customId.startsWith('reg_rs:')) {
          const parts = interaction.customId.split(':');
          const lang = parts[1] === 'en' ? 'en' : parts[1] === 'tr' ? 'tr' : resolveLang(interaction);
          const payload = buildGameSelectionPayload(0, lang, interaction.user.id);
          return interaction.update(payload);
        }

        // [A4] Devam Butonu: reg_go:<mask>:<dil>
        if (interaction.customId.startsWith('reg_go:')) {
          const parts = interaction.customId.split(':');
          const mask = gamesConfig.parseMask(parts[1], { allowZero: true });
          const lang = parts[2] === 'en' ? 'en' : parts[2] === 'tr' ? 'tr' : null;

          if (parts.length !== 3 || mask === null || !lang) {
            return interaction.reply(getExpiredMenuPayload(resolveLang(interaction)));
          }

          if (mask === 0) {
            return interaction.reply({
              content:
                lang === 'en'
                  ? '⚠️ Please select at least one game before continuing.'
                  : '⚠️ Lütfen devam etmeden önce en az bir oyun seç.',
              ephemeral: true,
            });
          }

          const payload = buildGenderSelectPayload(mask, lang);
          return interaction.update(payload);
        }

        // [A5] Tekrar Dene Butonu: reg_retry:<mask>:<m|f>:<dil>
        if (interaction.customId.startsWith('reg_retry:')) {
          const parts = interaction.customId.split(':');
          const mask = gamesConfig.parseMask(parts[1], { allowZero: false });
          const genderCode = parts[2] === 'm' || parts[2] === 'f' ? parts[2] : null;
          const lang = parts[3] === 'en' ? 'en' : parts[3] === 'tr' ? 'tr' : null;

          if (parts.length !== 4 || mask === null || !genderCode || !lang) {
            return interaction.reply(getExpiredMenuPayload(resolveLang(interaction)));
          }

          const draft = getRetryDraft(interaction.user.id);
          const matchingDraft = draft && draft.mask === mask ? draft : null;

          const modal = buildRegistrationModal({
            mask,
            genderCode,
            lang,
            prefill: matchingDraft,
          });
          return interaction.showModal(modal);
        }

        // [B] İSİM RENGİ İNGİLİZCE REHBER BUTONU (Kalıcı dil yazmaz)
        if (interaction.customId === 'btn_color_en_info') {
          return interaction.reply({
            embeds: [createEnglishColorGuideEmbed()],
            ephemeral: true,
          });
        }

        // [C] YETKİLİ KART BUTONU: ✅ ONAYLA
        if (interaction.customId.startsWith('btn_approve_')) {
          const applicantId = interaction.customId.replace('btn_approve_', '');
          return handleApprove(interaction, applicantId);
        }

        // [D] YETKİLİ KART BUTONU: ✖️ REDDET
        if (interaction.customId.startsWith('btn_reject_')) {
          const applicantId = interaction.customId.replace('btn_reject_', '');
          return handleRejectButton(interaction, applicantId);
        }

        // [E] İSİM RENGİ SEÇİM BUTONLARI (btn_color_...)
        if (interaction.customId.startsWith('btn_color_')) {
          const roleId = interaction.customId.replace('btn_color_', '');
          return handleColorButton(interaction, roleId);
        }

        // [F] UYARI SİSTEMİ: SÖZLÜ UYARI & RESMİ UYARI BUTONLARI
        if (interaction.customId === 'btn_warn_verbal') {
          return handleWarningButton(interaction, 'verbal');
        }
        if (interaction.customId === 'btn_warn_official') {
          return handleWarningButton(interaction, 'official');
        }

        // [G] UYARI SİSTEMİ: KANIT GÖRSELİ YÜKLE / PAS GEÇ BUTONLARI
        if (interaction.customId.startsWith('btn_warn_proof_upload_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_upload_', '');
          return handleProofButton(interaction, 'upload', warnId);
        }
        if (interaction.customId.startsWith('btn_warn_proof_skip_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_skip_', '');
          return handleProofButton(interaction, 'skip', warnId);
        }

        // [H] UYARI LOG KANALINDAKİ "🇬🇧 English" ÇEVİRİ BUTONU
        if (interaction.customId.startsWith('btn_warn_log_en_')) {
          const warnId = interaction.customId.replace('btn_warn_log_en_', '');
          return handleWarningLogEnglishButton(interaction, warnId);
        }
      }

      // 4. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
      if (interaction.isStringSelectMenu()) {
        // Yeni cinsiyet seçim menüsü: reg_gender:<mask>:<dil>
        if (interaction.customId.startsWith('reg_gender:')) {
          const parts = interaction.customId.split(':');
          const mask = gamesConfig.parseMask(parts[1], { allowZero: false });
          const lang = parts[2] === 'en' ? 'en' : parts[2] === 'tr' ? 'tr' : null;

          if (parts.length !== 3 || mask === null || !lang) {
            return interaction.reply(getExpiredMenuPayload(resolveLang(interaction)));
          }

          const rawVal = interaction.values?.[0] || 'm';
          const parsedGender = parseGenderInput(rawVal);
          const genderCode = parsedGender.isFemale ? 'f' : 'm';

          const modal = buildRegistrationModal({
            mask,
            genderCode,
            lang,
            prefill: null,
          });
          return interaction.showModal(modal);
        }
      }

      // 5. USER SELECT MENU (UYARI KULLANICI SEÇİMİ)
      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'select_warn_verbal_user') {
          return handleWarningUserSelected(interaction, 'verbal');
        }

        if (interaction.customId === 'select_warn_official_user') {
          return handleWarningUserSelected(interaction, 'official');
        }
      }

      // 6. MODAL GÖNDERİMLERİ (MODAL SUBMIT)
      if (interaction.isModalSubmit()) {
        // [A] Çoklu Oyun Kayıt Anketi: reg_form:<mask>:<m|f>:<dil>
        if (interaction.customId.startsWith('reg_form:')) {
          return handleRegistrationModalSubmit(interaction);
        }

        // [B] Yetkili Red Sebebi Formu Gönderimi
        if (interaction.customId.startsWith('modal_reject_staff_')) {
          const applicantId = interaction.customId.replace('modal_reject_staff_', '');
          return handleRejectModalSubmit(interaction, applicantId);
        }

        // [C] Sözlü Uyarı Formu Gönderimi
        if (interaction.customId.startsWith('modal_warn_verbal_')) {
          const targetUserId = interaction.customId.replace('modal_warn_verbal_', '');
          return handleVerbalWarnModalSubmit(interaction, targetUserId);
        }

        // [D] Resmi Uyarı (Madde No) Formu Gönderimi
        if (interaction.customId.startsWith('modal_warn_official_')) {
          const targetUserId = interaction.customId.replace('modal_warn_official_', '');
          return handleOfficialWarnModalSubmit(interaction, targetUserId);
        }
      }
    } catch (err) {
      console.error('[INTERACTION ERROR] Beklenmeyen hata:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: '❌ Bir hata meydana geldi! Lütfen yetkililere danışın.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  },
};

// =========================================================================
// KAYIT SİSTEMİ FONKSİYONLARI
// =========================================================================

/**
 * Kullanıcı kayıt anketini (reg_form:<mask>:<m|f>:<dil>) gönderdiğinde çalışır.
 */
async function handleRegistrationModalSubmit(interaction) {
  const parts = String(interaction.customId || '').split(':');
  const mask = gamesConfig.parseMask(parts[1], { allowZero: false });
  const genderCode = parts[2] === 'm' || parts[2] === 'f' ? parts[2] : null;
  const lang = parts[3] === 'en' ? 'en' : parts[3] === 'tr' ? 'tr' : resolveLang(interaction);
  const isEn = lang === 'en';

  if (parts.length !== 4 || mask === null || !genderCode) {
    return interaction.reply(getExpiredMenuPayload(lang));
  }

  // Roblox API yavaş olabileceğinden 3 sn sınırı için önce deferReply yap
  await interaction.deferReply({ ephemeral: true });

  // Hız sınırı kontrolü (kullanıcı başına 10 dakikada max 5 form gönderimi, başarısızlar dahil)
  const rateCheck = checkRegistrationRateLimit(interaction.user.id);
  if (rateCheck.limited) {
    return interaction.editReply(
      buildPrecheckErrorPayload('p3', lang, { retryAfterSec: rateCheck.retryAfterSec })
    );
  }
  recordRegistrationAttempt(interaction.user.id);

  // Modal alanlarını oku
  const rawName = interaction.fields.getTextInputValue('f_name') || '';
  const selectedGames = gamesConfig.getGamesFromMask(mask);

  const gamesDraftMap = {};
  const gamesInput = [];

  for (const game of selectedGames) {
    let val = '';
    try {
      val = interaction.fields.getTextInputValue(`f_${game.id}`) || '';
    } catch (e) {}
    gamesDraftMap[game.id] = val;
    gamesInput.push({
      id: game.id,
      username: val,
    });
  }

  // Hata durumunda "Tekrar dene" butonunun modalı doldurabilmesi için 10 dk bellekte tut
  saveRetryDraft(interaction.user.id, {
    mask,
    genderCode,
    lang,
    name: rawName,
    games: gamesDraftMap,
  });

  const result = await createRegistrationApplication({
    guild: interaction.guild,
    member: interaction.member,
    user: interaction.user,
    lang,
    source: 'discord',
    name: rawName,
    gender: genderCode === 'f' ? 'female' : 'male',
    games: gamesInput,
  });

  if (!result.success) {
    saveRetryDraft(interaction.user.id, {
      mask,
      genderCode,
      lang,
      name: rawName,
      games: gamesDraftMap,
      canRetry: Boolean(result.canRetry),
      errorMessage: result.message,
      errorBilingual: result.errorBilingual || { tr: result.message, en: result.message },
    });
    return interaction.editReply(
      buildModalErrorPayload({
        mask,
        genderCode,
        lang,
        message: result.message,
        canRetry: Boolean(result.canRetry),
      })
    );
  }

  clearRetryDraft(interaction.user.id);

  return interaction.editReply({
    content: isEn
      ? `✅ Your registration application has been submitted! You can follow your application in your private thread: <#${result.threadId}>`
      : `✅ Başvurunuz başarıyla alındı! Size özel oluşturulan kayıt odasını takip edebilirsiniz: <#${result.threadId}>`,
    components: [],
    allowedMentions: { parse: [] },
  });
}

/**
 * Yetkili ✅ ONAYLA butonuna bastığında çalışan fonksiyon.
 */
async function handleApprove(interaction, applicantId) {
  if (!hasRegistrationStaffPermission(interaction.member)) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece Kayıt Yetkilileri yapabilir!',
      ephemeral: true,
    });
  }

  if (approvalUserLocks.has(applicantId)) {
    return interaction.reply({
      content: '⚠️ Bu başvuru için onay işlemi zaten yürütülüyor, lütfen bekleyin.',
      ephemeral: true,
    });
  }

  approvalUserLocks.add(applicantId);

  try {
    await interaction.deferReply({ ephemeral: true });

    const activeApp = database.getActiveApplication(applicantId);
    if (!activeApp) {
      return interaction.editReply({
        content: '⚠️ Bu başvuru zaten sonuçlanmış veya bulunamadı!',
      });
    }

    const applicantMember = await interaction.guild.members.fetch(applicantId).catch(() => null);
    if (!applicantMember) {
      return interaction.editReply({
        content: '❌ Başvuru sahibi kullanıcı sunucuda bulunamadı!',
      });
    }

    const isApplicantEn =
      resolveLang(applicantMember || applicantId, activeApp?.lang || null) === 'en';

    const displayName = activeApp.displayName || activeApp.realName || applicantMember.user.username;
    const appGames =
      Array.isArray(activeApp.games) && activeApp.games.length > 0
        ? activeApp.games
        : activeApp.robloxUsername
          ? [
              {
                id: 'roblox',
                username: activeApp.robloxUsername,
                verified: Boolean(activeApp.robloxId),
                robloxId: activeApp.robloxId || null,
                robloxProfileUrl: activeApp.robloxId
                  ? `https://www.roblox.com/users/${activeApp.robloxId}/profile`
                  : null,
              },
            ]
          : [];

    const assignedRoleLabelsTr = [];
    const assignedRoleLabelsEn = [];
    const nonBlockingWarnings = [];

    // 1. Genel Onay Rollerini Ver (APPROVED_ROLES: Hesabı Onaylı + Cengaver)
    // Hata durumunda başvuru AKTİF kalır, tekrar basınca kaldığı yerden güvenle devam eder (idempotent).
    for (const roleId of config.ROLES.APPROVED_ROLES || []) {
      if (!roleId) continue;
      const guildRole = interaction.guild.roles.cache.get(roleId);
      if (!guildRole) {
        nonBlockingWarnings.push(`⚠️ Genel rol (\`${roleId}\`) sunucuda bulunamadı.`);
        continue;
      }
      try {
        if (!applicantMember.roles.cache.has(roleId)) {
          await applicantMember.roles.add(
            roleId,
            `Kayıt Onaylandı (Yetkili: ${interaction.user.tag})`
          );
        }
        assignedRoleLabelsTr.push(`<@&${roleId}> (${guildRole.name})`);
        assignedRoleLabelsEn.push(`<@&${roleId}> (${guildRole.name})`);
      } catch (roleErr) {
        console.error(`[ROL EKLEME HATASI] Rol (${roleId}) verilemedi:`, roleErr);
        return interaction.editReply({
          content: `❌ <@&${roleId}> rolü verilirken hata oluştu: ${roleErr.message}. Lütfen botun yetki ve rol sırasını kontrol ediniz. Başvuru aktif tutuldu, düzelttikten sonra tekrar Onayla butonuna basabilirsiniz.`,
        });
      }
    }

    // 2. Cinsiyet Rolünü Ver (Idempotent)
    const { isFemale } = parseGenderInput(activeApp?.gender);
    const genderRoleId = isFemale ? config.ROLES.FEMALE : config.ROLES.MALE;
    if (genderRoleId && interaction.guild.roles.cache.has(genderRoleId)) {
      const genderRole = interaction.guild.roles.cache.get(genderRoleId);
      try {
        if (!applicantMember.roles.cache.has(genderRoleId)) {
          await applicantMember.roles.add(
            genderRoleId,
            `Cinsiyet Rolü: ${isFemale ? 'Kız' : 'Erkek'} (Yetkili: ${interaction.user.tag})`
          );
        }
        assignedRoleLabelsTr.push(`<@&${genderRoleId}> (${genderRole.name})`);
        assignedRoleLabelsEn.push(`<@&${genderRoleId}> (${genderRole.name})`);
      } catch (gErr) {
        console.warn('[CİNSİYET ROLÜ HATASI]:', gErr.message);
        nonBlockingWarnings.push(`⚠️ Cinsiyet rolü verilemedi: ${gErr.message}`);
      }
    } else if (genderRoleId) {
      nonBlockingWarnings.push(`⚠️ Cinsiyet rolü (\`${genderRoleId}\`) sunucuda bulunamadı.`);
    }

    // 3. Seçilen Oyun Rollerini Ver (Eksik veya bulunamayan oyun rolünde onay DURMAZ, uyarır)
    for (const gameItem of appGames) {
      const gameCfg = gamesConfig.getGameById(gameItem.id);
      if (!gameCfg) continue;
      const gameLabelTr = gamesConfig.getGameLabel(gameCfg, 'tr');
      const roleId = gameCfg.roleId;

      if (!roleId) {
        nonBlockingWarnings.push(`⚠️ ${gameCfg.emoji} **${gameLabelTr}** rol ID'si config'te eksik.`);
        continue;
      }

      const gameRole = interaction.guild.roles.cache.get(roleId);
      if (!gameRole) {
        nonBlockingWarnings.push(
          `⚠️ ${gameCfg.emoji} **${gameLabelTr}** rolü (\`${roleId}\`) sunucuda bulunamadı.`
        );
        continue;
      }

      try {
        if (!applicantMember.roles.cache.has(roleId)) {
          await applicantMember.roles.add(
            roleId,
            `Oyun Rolü: ${gameLabelTr} (Yetkili: ${interaction.user.tag})`
          );
        }
        assignedRoleLabelsTr.push(`<@&${roleId}> (${gameRole.name})`);
        assignedRoleLabelsEn.push(`<@&${roleId}> (${gameRole.name})`);
      } catch (gRoleErr) {
        console.warn(`[OYUN ROLÜ HATASI] (${gameLabelTr}):`, gRoleErr.message);
        nonBlockingWarnings.push(
          `⚠️ ${gameCfg.emoji} **${gameLabelTr}** rolü verilemedi: ${gRoleErr.message}`
        );
      }
    }

    // 4. Kayıtsız Rolünü Al
    if (config.ROLES.UNREGISTERED && applicantMember.roles.cache.has(config.ROLES.UNREGISTERED)) {
      await applicantMember.roles
        .remove(config.ROLES.UNREGISTERED, 'Kayıt tamamlandı.')
        .catch(() => {});
    }

    // 5. Takma Adı Güncelle (Roblox seçildiyse "<Ad> | <Roblox>", seçilmediyse "<Ad>")
    const robloxEntry = appGames.find((g) => g.id === 'roblox');
    const robloxNick = robloxEntry?.username || activeApp.robloxUsername || null;

    if (displayName) {
      const newNick = formatApprovedNickname(displayName, robloxNick);
      try {
        if (applicantMember.nickname !== newNick) {
          await applicantMember.setNickname(newNick, 'Kayıt onaylandı - Otomatik isim güncelleme');
        }
      } catch (nickErr) {
        console.warn(`[NICKNAME GÜNCELLEME HATASI] (${applicantMember.user.tag}):`, nickErr.message);
        nonBlockingWarnings.push(
          `⚠️ Takma ad yetki/hiyerarşi nedeniyle güncellenemedi (${nickErr.message}).`
        );
      }
    }

    // 6. Veritabanına Kaydı Kaydet (Yeni alanlar + geriye dönük eski alanlar birlikte)
    const approvedAt = Date.now();
    database.addRegistration({
      discordId: applicantId,
      displayName,
      realName: displayName,
      gender: activeApp.gender || null,
      lang: isApplicantEn ? 'en' : 'tr',
      games: appGames,
      robloxId: robloxEntry?.robloxId || activeApp.robloxId || null,
      robloxUsername: robloxNick,
      robloxDisplayName: activeApp.robloxDisplayName || null,
      approvedBy: interaction.user.id,
      approvedAt,
    });

    // Aktif başvurudan kaldır
    database.removeActiveApplication(applicantId);
    database.clearRejectedApplication(applicantId);

    // 7. Yetkili Kartını Yeşile Çevir ve Güncelle
    if (interaction.message) {
      try {
        const oldEmbed = interaction.message.embeds[0];
        if (oldEmbed) {
          const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(config.COLORS.SUCCESS)
            .setTitle('✅ Kayıt Başvurusu Onaylandı')
            .addFields({
              name: '👮 Onaylayan Yetkili',
              value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
              inline: false,
            });

          await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [],
          });
        }
      } catch (msgEditErr) {
        console.warn('[STAFF CARD EDIT ERROR]:', msgEditErr.message);
      }
    }

    // 8. Kullanıcıya DM Gönder (TR/EN) - DM kapalıysa hata vermez
    const gamesDmList = appGames
      .map((g) => {
        const cfg = gamesConfig.getGameById(g.id);
        const emoji = cfg?.emoji || '🎮';
        const label = cfg ? gamesConfig.getGameLabel(cfg, isApplicantEn ? 'en' : 'tr') : g.id;
        return `• ${emoji} **${label}:** \`${sanitizeInlineCode(g.username, 64)}\``;
      })
      .join('\n');

    const rolesDmText = (isApplicantEn ? assignedRoleLabelsEn : assignedRoleLabelsTr).join(', ');

    try {
      await applicantMember.user.send({
        content: isApplicantEn
          ? `🎉 Congratulations! Your registration in **${config.BRAND_NAME}** has been **approved** by <@${interaction.user.id}>.\n\n` +
            (rolesDmText ? `🎭 **Assigned Roles:** ${rolesDmText}\n\n` : '') +
            (gamesDmList ? `🎮 **Your Registered Games:**\n${gamesDmList}\n\n` : '') +
            `💡 Type \`/profile\` to show your games to everyone 🎮`
          : `🎉 Tebrikler! **${config.BRAND_NAME}** sunucusundaki kayıt başvurun <@${interaction.user.id}> tarafından **onaylandı**.\n\n` +
            (rolesDmText ? `🎭 **Verilen Roller:** ${rolesDmText}\n\n` : '') +
            (gamesDmList ? `🎮 **Kayıtlı Oyunların:**\n${gamesDmList}\n\n` : '') +
            `💡 \`/profilim\` yazarak oyunlarını herkese gösterebilirsin 🎮`,
        allowedMentions: { parse: [] },
      });
    } catch (dmErr) {}

    // 9. Özel Kayıt Odasını Sil
    if (activeApp.threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
        if (thread) {
          await thread.delete('Kayıt işlemi tamamlandı - Özel oda silindi.');
        }
      } catch (threadErr) {
        console.warn(`[THREAD SİLME HATASI] (${activeApp.threadId}):`, threadErr.message);
      }
    }

    let replyMsg = `✅ <@${applicantId}> kullanıcısının kaydı başarıyla onaylandı, üye ve oyun rolleri verildi, ismi güncellendi ve kayıt odası silindi!`;
    if (nonBlockingWarnings.length > 0) {
      replyMsg += `\n\n**Uyarılar:**\n${nonBlockingWarnings.join('\n')}`;
    }

    return interaction.editReply({
      content: replyMsg,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[ONAY HATASI] Onaylama sırasında hata:', err);
    return interaction.editReply({
      content: `❌ Kayıt onaylanırken bir hata oluştu: ${err.message}`,
    });
  } finally {
    approvalUserLocks.delete(applicantId);
  }
}

/**
 * Yetkili ✖️ REDDET butonuna bastığında sebep girmesi için Modal açar.
 */
async function handleRejectButton(interaction, applicantId) {
  if (!hasRegistrationStaffPermission(interaction.member)) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece Kayıt Yetkilileri yapabilir!',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_reject_staff_${applicantId}`)
    .setTitle('Başvuruyu Reddet');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reject_reason')
    .setLabel('Reddetme Sebebi')
    .setPlaceholder('Örn: Hatalı oyun kullanıcı adı, kural ihlali, uygunsuz isim vb.')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(3)
    .setMaxLength(500)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

/**
 * Yetkili Reddetme Modalını onayladığında çalışan fonksiyon.
 */
async function handleRejectModalSubmit(interaction, applicantId) {
  await interaction.deferReply({ ephemeral: true });

  const rejectReason = interaction.fields.getTextInputValue('reject_reason').trim();
  const safeReason = escapeEmbedText(rejectReason, 480);
  const activeApp = database.getActiveApplication(applicantId);
  const applicantMember = await interaction.guild.members.fetch(applicantId).catch(() => null);

  database.removeActiveApplication(applicantId);
  database.setRejectedApplication(applicantId, {
    reason: rejectReason,
    rejectedBy: interaction.user.id,
    robloxUsername: activeApp ? activeApp.robloxUsername : null,
    games: activeApp ? activeApp.games : [],
  });

  // 1. Yetkili Kartını Kırmızıya Çevir ve Sebebi Ekle
  try {
    if (activeApp && activeApp.staffChannelId && activeApp.staffMessageId) {
      const staffChannel = await interaction.guild.channels
        .fetch(activeApp.staffChannelId)
        .catch(() => null);
      if (staffChannel) {
        const staffMsg = await staffChannel.messages
          .fetch(activeApp.staffMessageId)
          .catch(() => null);
        if (staffMsg && staffMsg.embeds.length > 0) {
          const updatedEmbed = EmbedBuilder.from(staffMsg.embeds[0])
            .setColor(config.COLORS.DANGER)
            .setTitle('✖️ Kayıt Başvurusu Reddedildi')
            .addFields(
              {
                name: '👮 Reddeden Yetkili',
                value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
                inline: true,
              },
              {
                name: '📄 Red Sebebi',
                value: `>>> ${safeReason}`,
                inline: false,
              }
            );

          await staffMsg.edit({
            embeds: [updatedEmbed],
            components: [],
          });
        }
      }
    }
  } catch (cardErr) {
    console.error('[RED KART GÜNCELLEME HATASI]:', cardErr.message);
  }

  // 2. Özel Kayıt Odasına Bilgilendirme Gönder ve 5 Dakika Sonra Sil
  const isApplicantEn =
    resolveLang(applicantMember || applicantId, activeApp?.lang || null) === 'en';

  const appGames = Array.isArray(activeApp?.games) ? activeApp.games : [];
  const gamesText =
    appGames.length > 0
      ? appGames
          .map((g) => {
            const cfg = gamesConfig.getGameById(g.id);
            const label = cfg ? gamesConfig.getGameLabel(cfg, isApplicantEn ? 'en' : 'tr') : g.id;
            return `${cfg?.emoji || '🎮'} ${label}: \`${sanitizeInlineCode(g.username, 64)}\``;
          })
          .join(' • ')
      : '';

  if (activeApp && activeApp.threadId) {
    const threadRef = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (threadRef) {
      const rejectedThreadEmbed = new EmbedBuilder()
        .setTitle(
          isApplicantEn ? '✖️ Registration Application Rejected' : '✖️ Kayıt Başvurunuz Reddedildi'
        )
        .setColor(config.COLORS.DANGER)
        .setDescription(
          isApplicantEn
            ? `❌ <@${applicantId}>, your registration application was **REJECTED** by staff member <@${interaction.user.id}>.\n\n` +
              (gamesText ? `**Submitted Games:** ${gamesText}\n` : '') +
              `**Reason:**\n> ${safeReason}\n\n` +
              `⚠️ **Notice:** This private thread will be automatically deleted in **5 minutes**.\n` +
              `Please fix the issue above and submit a new application from the registration panel.`
            : `❌ <@${applicantId}>, kayıt başvurunuz yetkili <@${interaction.user.id}> tarafından **REDDEDİLDİ**.\n\n` +
              (gamesText ? `**Gönderilen Oyunlar:** ${gamesText}\n` : '') +
              `**Red Sebebi:**\n> ${safeReason}\n\n` +
              `⚠️ **Dikkat:** Bu özel oda **5 dakika** içinde otomatik olarak silinecektir.\n` +
              `Hatalarınızı düzelterek kayıt kanalındaki panelden tekrar başvurabilirsiniz.`
        )
        .setTimestamp();

      await threadRef.send({
        content: `<@${applicantId}>`,
        embeds: [rejectedThreadEmbed],
        allowedMentions: { parse: [], users: [applicantId] },
      });

      await threadRef.setName(isApplicantEn ? '✖️・rejected' : '✖️・reddedildi').catch(() => {});

      setTimeout(async () => {
        try {
          const t = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
          if (t) {
            await t.delete('Kayıt başvurusu reddedildi (5 dakika süre doldu)');
          }
        } catch (e) {}
      }, 5 * 60 * 1000);
    }
  }

  // 3. Kullanıcıya DM Gönder
  if (applicantMember) {
    try {
      await applicantMember.user.send({
        content: isApplicantEn
          ? `✖️ Your registration application in **${config.BRAND_NAME}** was rejected.\n\n` +
            (gamesText ? `**Submitted Games:** ${gamesText}\n` : '') +
            `**Reviewed By:** <@${interaction.user.id}>\n` +
            `**Reason:**\n> ${safeReason}\n\n` +
            `Please correct your information and re-apply using the registration panel.`
          : `✖️ **${config.BRAND_NAME}** sunucusundaki kayıt başvurunuz reddedildi.\n\n` +
            (gamesText ? `**Gönderilen Oyunlar:** ${gamesText}\n` : '') +
            `**Reddeden Yetkili:** <@${interaction.user.id}>\n` +
            `**Red Sebebi:**\n> ${safeReason}\n\n` +
            `Eksik veya hatalı bilgilerinizi düzelterek kayıt kanalındaki panelden tekrar başvurabilirsiniz.`,
        allowedMentions: { parse: [] },
      });
    } catch (dmErr) {}
  }

  return interaction.editReply({
    content: `✖️ <@${applicantId}> kullanıcısının başvurusu reddedildi ve kullanıcı bilgilendirildi. Oda 5 dakika içinde silinecek.`,
    allowedMentions: { parse: [] },
  });
}
