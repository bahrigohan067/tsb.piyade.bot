/**
 * Kayıt Formu ve Kullanıcı Girdisi Temizleme / Güvenlik Yardımcıları
 */

const profanityFilter = require('./profanityFilter');

const MEANINGLESS_VALUES = new Set([
  'yok',
  'yoktur',
  'none',
  'null',
  'undefined',
  'na',
  'n/a',
  'nil',
  'nothing',
  'bilmiyorum',
  'bilinmiyor',
  'oynamiyorum',
  'oynamıyorum',
  'no',
  '-',
  '--',
  '---',
  '.',
  '..',
  '...',
  '?',
  '??',
  '???',
]);

/**
 * Kontrol ve görünmez/sıfır genişlikli karakterleri temizler, boşlukları teke indirir.
 */
function sanitizeTextInput(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(
      /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]/g,
      ''
    )
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Geçerli Roblox profil bağlantısı formatını tanır.
 */
function isValidRobloxProfileUrl(text) {
  return /^(?:https?:\/\/)?(?:www\.|web\.)?roblox\.com\/users\/\d+(?:\/profile)?\/?$/i.test(
    String(text || '').trim()
  );
}

/**
 * Metin içinde @everyone, @here, kullanıcı/rol/kanal etiketi var mı kontrol eder.
 */
function containsMention(text) {
  const s = String(text || '');
  return /@(everyone|here)\b/i.test(s) || /<@[!&]?\d+>/.test(s) || /<#\d+>/.test(s);
}

/**
 * Discord sunucu davet bağlantısı içeriyor mu kontrol eder.
 */
function containsDiscordInvite(text) {
  const s = String(text || '');
  return /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/\S*/i.test(s);
}

/**
 * Herhangi bir web bağlantısı içeriyor mu kontrol eder.
 */
function containsUrl(text) {
  const s = String(text || '');
  return (
    /(?:https?:\/\/|www\.)\S+/i.test(s) ||
    /\b[a-z0-9-]+\.(?:com|net|org|gg|io|me|xyz|tv|co|tr|ru|de|uk)(?:\/\S*)?\b/i.test(s)
  );
}

/**
 * Boş veya "yok", "none", "-" gibi anlamsız değerleri tespit eder.
 */
function isMeaninglessInput(text) {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return true;
  if (MEANINGLESS_VALUES.has(clean)) return true;
  // En az 1 harf veya rakam içermeli
  if (!/[a-zA-Z0-9\u00C0-\u024F]/.test(clean)) return true;
  return false;
}

/**
 * Tek bir metin alanını tüm güvenlik ve uzunluk kurallarına göre doğrular.
 */
function validateTextField({
  value,
  labelTr,
  labelEn,
  min = 2,
  max = 32,
  regex = null,
  regexHintTr = null,
  regexHintEn = null,
  allowRobloxUrl = false,
  checkProfanity = true,
}) {
  const cleaned = sanitizeTextInput(value);

  if (!cleaned) {
    return {
      ok: false,
      code: 'EMPTY',
      value: '',
      error: {
        tr: `**${labelTr}** alanı boş bırakılamaz.`,
        en: `The **${labelEn}** field cannot be empty.`,
      },
    };
  }

  if (containsMention(cleaned)) {
    return {
      ok: false,
      code: 'MENTION_FORBIDDEN',
      value: cleaned,
      error: {
        tr: `**${labelTr}** alanında etiket (@everyone, @here veya kullanıcı/kanal etiketi) kullanılamaz.`,
        en: `Mentions (@everyone, @here, or user/channel tags) are not allowed in **${labelEn}**.`,
      },
    };
  }

  if (containsDiscordInvite(cleaned)) {
    return {
      ok: false,
      code: 'INVITE_FORBIDDEN',
      value: cleaned,
      error: {
        tr: `**${labelTr}** alanında Discord davet bağlantısı paylaşılamaz.`,
        en: `Discord invite links are not allowed in **${labelEn}**.`,
      },
    };
  }

  if (containsUrl(cleaned)) {
    if (!(allowRobloxUrl && isValidRobloxProfileUrl(cleaned))) {
      return {
        ok: false,
        code: 'URL_FORBIDDEN',
        value: cleaned,
        error: {
          tr: allowRobloxUrl
            ? `**${labelTr}** alanında yalnızca geçerli bir Roblox profil linki veya kullanıcı adı/ID girebilirsiniz.`
            : `**${labelTr}** alanında link (URL) paylaşılamaz.`,
          en: allowRobloxUrl
            ? `In **${labelEn}**, only a valid Roblox profile URL, username, or ID is accepted.`
            : `Links (URLs) are not allowed in **${labelEn}**.`,
        },
      };
    }
  }

  if (isMeaninglessInput(cleaned)) {
    return {
      ok: false,
      code: 'MEANINGLESS',
      value: cleaned,
      error: {
        tr: `**${labelTr}** alanına geçerli ve anlamlı bir değer yazmalısınız (örneğin "yok", "none", "-" kabul edilmez).`,
        en: `Please enter a valid, meaningful value for **${labelEn}** ("none", "-", etc. are not allowed).`,
      },
    };
  }

  if (cleaned.length < min || cleaned.length > max) {
    return {
      ok: false,
      code: cleaned.length < min ? 'TOO_SHORT' : 'TOO_LONG',
      value: cleaned,
      error: {
        tr: `**${labelTr}** ${min}-${max} karakter arasında olmalıdır (girilen: ${cleaned.length}).`,
        en: `**${labelEn}** must be between ${min} and ${max} characters (entered: ${cleaned.length}).`,
      },
    };
  }

  if (regex && !regex.test(cleaned)) {
    return {
      ok: false,
      code: 'REGEX_MISMATCH',
      value: cleaned,
      error: {
        tr: regexHintTr || `**${labelTr}** geçerli formatta değil.`,
        en: regexHintEn || `**${labelEn}** is not in a valid format.`,
      },
    };
  }

  if (checkProfanity && profanityFilter.detectLocal(cleaned)) {
    return {
      ok: false,
      code: 'PROFANITY',
      value: cleaned,
      error: {
        tr: `**${labelTr}** alanında uygunsuz ifade tespit edildi.`,
        en: `Inappropriate language was detected in **${labelEn}**.`,
      },
    };
  }

  return {
    ok: true,
    value: cleaned,
  };
}

/**
 * Ad / Takma ad alanını doğrular (2-32 karakter, anlamsız ve zararlı içerik reddi).
 */
function validateDisplayName(rawName) {
  return validateTextField({
    value: rawName,
    labelTr: 'Ad / Takma ad',
    labelEn: 'Name / Nickname',
    min: 2,
    max: 32,
    allowRobloxUrl: false,
    checkProfanity: true,
  });
}

/**
 * Oyun yapılandırmasına göre oyun kullanıcı adını doğrular.
 */
function validateGameUsername(gameConfig, rawUsername) {
  if (!gameConfig) {
    return {
      ok: false,
      code: 'UNKNOWN_GAME',
      value: '',
      error: {
        tr: 'Geçersiz oyun seçimi.',
        en: 'Invalid game selection.',
      },
    };
  }

  const isRoblox = gameConfig.verifier === 'roblox';
  const min = gameConfig.validate?.min ?? (isRoblox ? 3 : 2);
  const max = gameConfig.validate?.max ?? (isRoblox ? 100 : 32);
  const regex = gameConfig.validate?.regex || null;
  const labelTr = gameConfig.buttonLabel?.tr || gameConfig.name?.tr || gameConfig.id;
  const labelEn = gameConfig.buttonLabel?.en || gameConfig.name?.en || gameConfig.id;

  return validateTextField({
    value: rawUsername,
    labelTr: `${labelTr} kullanıcı adı`,
    labelEn: `${labelEn} username`,
    min,
    max,
    regex,
    regexHintTr:
      gameConfig.id === 'minecraft'
        ? `**${labelTr} kullanıcı adı** 3-16 karakter olmalı ve yalnızca İngilizce harf, rakam veya alt çizgi (_) içermelidir.`
        : null,
    regexHintEn:
      gameConfig.id === 'minecraft'
        ? `**${labelEn} username** must be 3-16 characters and contain only letters, numbers, or underscores (_).`
        : null,
    allowRobloxUrl: isRoblox,
    checkProfanity: true,
  });
}

/**
 * @everyone / @here ve Discord mention sözdizimini zararsızlaştırır.
 */
function neutralizeMentions(text) {
  return String(text || '')
    .replace(/@(everyone|here)/gi, '@\u200B$1')
    .replace(/<@/g, '<\u200B@')
    .replace(/<#/g, '<\u200B#');
}

/**
 * Tek satırlı inline kod bloğu (`...`) içinde güvenle gösterilecek metin üretir.
 */
function sanitizeInlineCode(text, maxLen = 100) {
  const cleaned = neutralizeMentions(sanitizeTextInput(String(text || '')))
    .replace(/`/g, "'");
  if (!cleaned) return '-';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

/**
 * Embed içinde düz metin olarak gösterilecek kullanıcı metinlerini markdown enjeksiyonuna karşı kaçışlar.
 */
function escapeEmbedText(text, maxLen = 200) {
  const cleaned = neutralizeMentions(sanitizeTextInput(String(text || '')))
    .replace(/https?:\/\//gi, '[link] ')
    .replace(/discord\.gg\/\S*/gi, '[davet]')
    .replace(/([\\*_~`>|[\]])/g, '\\$1');
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

module.exports = {
  sanitizeTextInput,
  isValidRobloxProfileUrl,
  containsMention,
  containsDiscordInvite,
  containsUrl,
  isMeaninglessInput,
  validateTextField,
  validateDisplayName,
  validateGameUsername,
  neutralizeMentions,
  sanitizeInlineCode,
  escapeEmbedText,
};
