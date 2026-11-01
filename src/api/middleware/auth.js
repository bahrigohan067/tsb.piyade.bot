const { PermissionFlagsBits } = require('discord.js');
const config = require('../../../config');

/**
 * 1. Bearer Token Kimlik Doğrulama Middleware
 * Tüm endpoint'ler "Authorization: Bearer API_SECRET" ister.
 */
function apiKeyAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const expectedSecret = config.API_SECRET;

  if (!expectedSecret) {
    console.warn('[API AUTH UYARI] config.API_SECRET / process.env.API_SECRET tanımlanmamış!');
    return res.status(500).json({
      error: 'Sunucu yapılandırma hatası: API_SECRET tanımlı değil.',
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] !== expectedSecret) {
    return res.status(401).json({
      error: 'Yetkisiz erişim: Geçersiz veya eksik Bearer token (API_SECRET).',
    });
  }

  next();
}

/**
 * 2. Actor (İşlemi Yapan Kullanıcı) Doğrulama Middleware
 * Site, işlemi yapan kullanıcının Discord ID'sini "X-Actor-Id" ile gönderir.
 */
async function requireActor(req, res, next) {
  const actorId = req.headers['x-actor-id'];

  if (!actorId) {
    return res.status(400).json({
      error: 'Eksik başlık: Bu işlem için "X-Actor-Id" (işlemi yapan yetkili/üye Discord ID) zorunludur.',
    });
  }

  if (!req.guild) {
    return res.status(503).json({
      error: 'Discord sunucusu henüz hazır değil veya önbelleğe alınamadı.',
    });
  }

  try {
    const member = await req.guild.members.fetch(actorId).catch(() => null);
    if (!member) {
      return res.status(404).json({
        error: `Belirtilen aktör (X-Actor-Id: ${actorId}) Discord sunucusunda bulunamadı.`,
      });
    }

    req.actorMember = member;
    req.actorUser = member.user;
    next();
  } catch (err) {
    return res.status(500).json({
      error: `Aktör bilgisi doğrulanırken hata oluştu: ${err.message}`,
    });
  }
}

/**
 * 3. Yönetim Yetkisi Kontrolü (Developer veya Yönetmenlik)
 * Yönetim endpoint'leri sadece Yönetmenlik (1559614111128490044) veya Developer (1561777507223601353) içindir.
 */
async function requireManagement(req, res, next) {
  // Önce aktörü doğrula
  requireActor(req, res, () => {
    const member = req.actorMember;
    const isOwner = req.guild.ownerId === member.id;
    const isDeveloper = isOwner || member.roles.cache.has(config.ROLES.DEVELOPER);
    const isYonetmenlik =
      member.roles.cache.has(config.ROLES.TRYOUT_STAFF) || // 1559614111128490044
      member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isDeveloper && !isYonetmenlik) {
      return res.status(403).json({
        error: 'Erişim engellendi: Bu yönetim işlemine sadece Yönetmenlik veya Developer yetkisine sahip kullanıcılar erişebilir.',
        actorLevel: 'member',
      });
    }

    req.isDeveloper = isDeveloper;
    req.isYonetmenlik = isYonetmenlik;
    req.actorLevel = isDeveloper ? 'developer' : 'yonetmenlik';
    next();
  });
}

/**
 * Üyenin yetki kademesini (developer / yonetmenlik / member) hesaplar
 */
function getMemberLevel(member, guild) {
  if (!member) return 'member';
  const isOwner = guild && guild.ownerId === member.id;
  if (isOwner || member.roles.cache.has(config.ROLES.DEVELOPER)) {
    return 'developer';
  }
  if (
    member.roles.cache.has(config.ROLES.TRYOUT_STAFF) || // 1559614111128490044
    member.permissions?.has(PermissionFlagsBits.Administrator)
  ) {
    return 'yonetmenlik';
  }
  return 'member';
}

module.exports = {
  apiKeyAuth,
  requireActor,
  requireManagement,
  getMemberLevel,
};
