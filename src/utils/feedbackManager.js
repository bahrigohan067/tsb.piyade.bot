const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config');
const database = require('./database');

const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_10M = 3;
const MAX_FEEDBACK_24H = 10;

let startupChannelChecked = false;

/**
 * FEEDBACK_CHANNEL_ID ortam değişkenini temizleyerek döndürür.
 */
function getFeedbackChannelId() {
  const raw =
    process.env.FEEDBACK_CHANNEL_ID !== undefined
      ? process.env.FEEDBACK_CHANNEL_ID
      : config.FEEDBACK_CHANNEL_ID || '';
  return String(raw).trim().replace(/^['"]+|['"]+$/g, '');
}

/**
 * Kontrol karakterlerini ve sıfır genişlikli/görünmez karakter yığınlarını temizler,
 * 3'ten fazla ardışık boş satırı 2'ye indirir ve trim sonrası uzunluğu doğrular.
 */
function sanitizeFeedbackMessage(raw) {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_SHORT',
      error: 'Geri bildirim mesajı en az 3 karakter olmalıdır.',
    };
  }

  if (typeof raw !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'TOO_SHORT',
      error: 'Geri bildirim mesajı metin formatında olmalıdır.',
    };
  }

  let cleaned = raw
    // Satır sonlarını normalize et
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    // Sekmeleri tek boşluğa çevir
    .replace(/\t/g, ' ')
    // Kontrol karakterlerini (\n hariç) kaldır
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
    // Görünmez, sıfır genişlikli ve dolgu karakterlerini kaldır
    .replace(
      /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]/g,
      ''
    )
    // Birden fazla ardışık ZWJ (\u200D) karakterini teke indir
    .replace(/\u200D{2,}/g, '\u200D')
    // Emoji birleşimi dışında tek başına duran ZWJ karakterlerini kaldır
    .replace(/(?<!\p{Extended_Pictographic})\u200D|\u200D(?!\p{Extended_Pictographic})/gu, '')
    // Kalan biçimlendirme karakterlerini (\u200D hariç) temizle
    .replace(/(?!\u200D)\p{Cf}/gu, '')
    // Yalnızca boşluk içeren satırları gerçek boş satıra dönüştür
    .replace(/^[ \u00A0\u2000-\u200A\u205F\u3000]+$/gm, '')
    // Ardışık 3'ten fazla boş satırı 2 boş satıra (\n\n\n) indir
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  if (cleaned.length < 3) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_SHORT',
      error: 'Geri bildirim mesajı en az 3 karakter olmalıdır.',
    };
  }

  if (cleaned.length > 1000) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_LONG',
      error: 'Geri bildirim mesajı en fazla 1000 karakter olabilir.',
    };
  }

  return { ok: true, value: cleaned };
}

/**
 * Sayfa yolunu doğrular: yalnızca "/" ile başlayan, max 80 karakter, [A-Za-z0-9-_\/] içeren yol.
 * Geçersizse "/" döndürür.
 */
function sanitizeFeedbackPage(raw) {
  if (typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.length > 80 ||
    trimmed.includes('//') ||
    !/^\/[A-Za-z0-9\-_\/]*$/.test(trimmed)
  ) {
    return '/';
  }
  return trimmed;
}

/**
 * Dil kodunu doğrular: "tr" veya "en", değilse "tr".
 */
function sanitizeFeedbackLang(raw) {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'tr';
}

/**
 * Tekrar kontrolü için büyük/küçük harf ve boşluk farkını ortadan kaldırır.
 */
function normalizeForDuplicate(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/\u0307/g, '')
    .replace(/\s+/g, '');
}

/**
 * Kullanıcı başına hız sınırlarını denetler (10 dk max 3, 24 sa max 10).
 */
function checkUserFeedbackRateLimit(userId, now = Date.now()) {
  const list = database.getFeedbackList();
  const userEntries24h = list
    .filter((item) => item.userId === String(userId) && now - (item.createdAt || 0) < TWENTY_FOUR_HOURS_MS)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const userEntries10m = userEntries24h.filter(
    (item) => now - (item.createdAt || 0) < TEN_MINUTES_MS
  );

  let retryAfter10m = 0;
  if (userEntries10m.length >= MAX_FEEDBACK_10M) {
    const oldestRelevant = userEntries10m[userEntries10m.length - MAX_FEEDBACK_10M];
    retryAfter10m = Math.max(
      1,
      Math.ceil(((oldestRelevant.createdAt || now) + TEN_MINUTES_MS - now) / 1000)
    );
  }

  let retryAfter24h = 0;
  if (userEntries24h.length >= MAX_FEEDBACK_24H) {
    const oldestRelevant = userEntries24h[userEntries24h.length - MAX_FEEDBACK_24H];
    retryAfter24h = Math.max(
      1,
      Math.ceil(((oldestRelevant.createdAt || now) + TWENTY_FOUR_HOURS_MS - now) / 1000)
    );
  }

  const retryAfterSec = Math.max(retryAfter10m, retryAfter24h);
  if (retryAfterSec > 0) {
    return { limited: true, retryAfterSec };
  }

  return { limited: false, retryAfterSec: 0 };
}

/**
 * Aynı kullanıcının son 10 dakikada aynı mesajı gönderip göndermediğini kontrol eder.
 */
function hasDuplicateFeedback(userId, cleanMessage, now = Date.now()) {
  const normalizedTarget = normalizeForDuplicate(cleanMessage);
  const list = database.getFeedbackList();

  return list.some(
    (item) =>
      item.userId === String(userId) &&
      now - (item.createdAt || 0) < TEN_MINUTES_MS &&
      normalizeForDuplicate(item.message) === normalizedTarget
  );
}

/**
 * Üyenin sunucudaki seviyesini çözümler (Kayıtsız / Üye / Yönetim).
 */
function resolveActorTierLabel(member, guild) {
  if (!member) return 'Kayıtsız';

  const hasRole = (roleId) => Boolean(roleId && member.roles?.cache?.has(roleId));
  const isOwner = Boolean(guild && guild.ownerId === member.id);
  const isAdmin = Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator));

  if (
    isOwner ||
    isAdmin ||
    hasRole(config.ROLES.DEVELOPER) ||
    hasRole(config.ROLES.TRYOUT_STAFF)
  ) {
    return 'Yönetim';
  }

  if (config.isRegisteredMember(member)) {
    return 'Üye';
  }

  return 'Kayıtsız';
}

/**
 * Discord embed içinde üç ters tırnağı ve @everyone / @here ifadelerini zararsızlaştırır.
 */
function escapeMessageForCodeBlock(text) {
  return String(text || '')
    .replace(/@(everyone|here)/gi, '@\u200B$1')
    .replace(/`{3,}/g, (match) => match.split('').join('\u200B'));
}

/**
 * Discord kanalına gönderilecek geri bildirim embed'ini oluşturur.
 */
function buildFeedbackEmbed({ id, userId, usernameSnapshot, message, page, lang, tierLabel, createdAt }) {
  const safeBody = escapeMessageForCodeBlock(message);
  const safeUsername = String(usernameSnapshot || userId).replace(/@(everyone|here)/gi, '@\u200B$1');

  return new EmbedBuilder()
    .setTitle(`💬 Yeni Geri Bildirim #${id}`)
    .setColor(config.COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${safeBody}\n\`\`\``)
    .addFields(
      {
        name: 'Gönderen',
        value: `<@${userId}> (${safeUsername})\nID: \`${userId}\``,
        inline: false,
      },
      {
        name: 'Sayfa',
        value: `\`${page}\``,
        inline: true,
      },
      {
        name: 'Dil',
        value: lang === 'en' ? 'English (`en`)' : 'Türkçe (`tr`)',
        inline: true,
      },
      {
        name: 'Seviye',
        value: tierLabel,
        inline: true,
      }
    )
    .setFooter({ text: 'Piyade Clan | TSB Web Sitesi' })
    .setTimestamp(createdAt);
}

/**
 * Bot açılışında FEEDBACK_CHANNEL_ID ve kanal erişimini bir kez kontrol edip uyarı loglar.
 */
async function checkFeedbackChannelOnStartup(guild) {
  if (startupChannelChecked) return;
  startupChannelChecked = true;

  const channelId = getFeedbackChannelId();
  if (!channelId) {
    console.warn(
      '[FEEDBACK UYARI] FEEDBACK_CHANNEL_ID tanımlı değil. Geri bildirimler yalnızca veritabanına kaydedilecek.'
    );
    return;
  }

  if (!guild || !guild.channels) {
    console.warn(
      `[FEEDBACK UYARI] Sunucu önbellekte bulunamadığı için FEEDBACK_CHANNEL_ID (${channelId}) doğrulanamadı.`
    );
    return;
  }

  try {
    const channel =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));

    if (!channel || typeof channel.send !== 'function') {
      console.warn(
        `[FEEDBACK UYARI] FEEDBACK_CHANNEL_ID (${channelId}) kanal bulunamadı veya mesaj gönderilemiyor.`
      );
    }
  } catch (err) {
    console.warn(`[FEEDBACK UYARI] Geri bildirim kanalı kontrol edilirken hata: ${err.message}`);
  }
}

/**
 * Geri bildirimi doğrular, kaydeder ve Discord kanalına iletmeyi dener.
 */
async function submitFeedback({ guild, member, rawMessage, rawPage, rawLang }) {
  const actorId = String(member.id);
  const now = Date.now();

  // 1. Mesaj temizleme & doğrulama
  const msgCheck = sanitizeFeedbackMessage(rawMessage);
  if (!msgCheck.ok) {
    return msgCheck;
  }

  const cleanMessage = msgCheck.value;
  const cleanPage = sanitizeFeedbackPage(rawPage);
  const cleanLang = sanitizeFeedbackLang(rawLang);

  // 2. Kullanıcı bazlı hız sınırı kontrolü
  const rateCheck = checkUserFeedbackRateLimit(actorId, now);
  if (rateCheck.limited) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSec: rateCheck.retryAfterSec,
      error: `Çok sık geri bildirim gönderdiniz. Lütfen ${rateCheck.retryAfterSec} saniye sonra tekrar deneyin.`,
    };
  }

  // 3. Tekrar (duplicate) mesaj kontrolü
  if (hasDuplicateFeedback(actorId, cleanMessage, now)) {
    return {
      ok: false,
      status: 409,
      code: 'DUPLICATE',
      error: 'Aynı geri bildirim mesajını son 10 dakika içinde zaten gönderdiniz.',
    };
  }

  // 4. Kayıt oluştur ve veritabanına kaydet
  const id = database.generateFeedbackId();
  const usernameSnapshot =
    member.user?.username || member.displayName || actorId;
  const tierLabel = resolveActorTierLabel(member, guild);
  const feedbackChannelId = getFeedbackChannelId();

  const record = database.addFeedback({
    id,
    userId: actorId,
    usernameSnapshot,
    message: cleanMessage,
    page: cleanPage,
    lang: cleanLang,
    createdAt: now,
    status: 'new',
    channelId: feedbackChannelId || null,
    messageId: null,
  });

  // 5. Discord kanalına ilet
  if (!feedbackChannelId) {
    console.warn(
      `[FEEDBACK] Kanal gönderimi başarısız (id=${id}, userId=${actorId}, reason=FEEDBACK_CHANNEL_ID tanımsız)`
    );
    return {
      ok: true,
      id: record.id,
      delivered: false,
      reason: 'CHANNEL_UNAVAILABLE',
    };
  }

  try {
    const channel =
      guild.channels?.cache?.get(feedbackChannelId) ||
      (await guild.channels?.fetch?.(feedbackChannelId).catch(() => null));

    if (!channel || typeof channel.send !== 'function') {
      console.warn(
        `[FEEDBACK] Kanal gönderimi başarısız (id=${id}, userId=${actorId}, reason=Kanal bulunamadı veya mesaj gönderilemiyor)`
      );
      return {
        ok: true,
        id: record.id,
        delivered: false,
        reason: 'CHANNEL_UNAVAILABLE',
      };
    }

    const embed = buildFeedbackEmbed({
      id: record.id,
      userId: actorId,
      usernameSnapshot,
      message: cleanMessage,
      page: cleanPage,
      lang: cleanLang,
      tierLabel,
      createdAt: now,
    });

    const sentMsg = await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    database.updateFeedback(record.id, {
      channelId: channel.id || feedbackChannelId,
      messageId: sentMsg?.id || null,
    });

    console.log(`[FEEDBACK] Geri bildirim kaydedildi ve iletildi (id=${record.id}, userId=${actorId})`);

    return {
      ok: true,
      id: record.id,
      delivered: true,
    };
  } catch (err) {
    console.warn(
      `[FEEDBACK] Kanal gönderimi başarısız (id=${record.id}, userId=${actorId}, reason=${err.message})`
    );
    return {
      ok: true,
      id: record.id,
      delivered: false,
      reason: 'CHANNEL_UNAVAILABLE',
    };
  }
}

/**
 * Testler için açılış kontrol bayrağını sıfırlar.
 */
function resetStartupCheckForTest() {
  startupChannelChecked = false;
}

module.exports = {
  getFeedbackChannelId,
  sanitizeFeedbackMessage,
  sanitizeFeedbackPage,
  sanitizeFeedbackLang,
  normalizeForDuplicate,
  checkUserFeedbackRateLimit,
  hasDuplicateFeedback,
  resolveActorTierLabel,
  escapeMessageForCodeBlock,
  buildFeedbackEmbed,
  checkFeedbackChannelOnStartup,
  submitFeedback,
  resetStartupCheckForTest,
};
