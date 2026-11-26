const { PermissionFlagsBits } = require('discord.js');
const config = require('../../../config');

// Desteklenen aktör türleri ve kimlik biçimleri
const ACTOR_TYPES = Object.freeze({
  DISCORD: 'discord',
  SITE_GUEST: 'site-guest',
  SITE_SERVICE: 'site-service',
});
const VALID_ACTOR_TYPE_SET = new Set(Object.values(ACTOR_TYPES));
const SITE_GUEST_ID_REGEX = /^g_[0-9a-fA-F]{32}$/;
const SITE_SERVICE_ACTOR_ID = 'site';

/**
 * site-guest ve site-service aktör türlerinin erişebileceği uç nokta izin listesi.
 * Yol (/api öneği soyulmuş req.path) ve HTTP yöntemi üzerinden sıkı beyaz liste uygular.
 */
function isRouteAllowedForActor(actorType, method, reqPath) {
  const m = String(method || 'GET').toUpperCase();
  const rawPath = String(reqPath || '/');
  const normPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  if (actorType === ACTOR_TYPES.SITE_GUEST) {
    return (
      (m === 'GET' && normPath === '/games') ||
      (m === 'GET' && normPath === '/roblox/lookup')
    );
  }

  if (actorType === ACTOR_TYPES.SITE_SERVICE) {
    if (m === 'GET' && (normPath === '/games' || normPath === '/roblox/lookup' || normPath === '/directory')) {
      return true;
    }
    if (m === 'POST' && (normPath === '/roblox/avatars' || normPath === '/directory/lookup')) {
      return true;
    }
    if ((m === 'PUT' || m === 'DELETE') && /^\/roblox\/site-claims\/[^/]+$/.test(normPath)) {
      return true;
    }
    return false;
  }

  return actorType === ACTOR_TYPES.DISCORD;
}

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
      code: 'CONFIG_ERROR',
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] !== expectedSecret) {
    return res.status(401).json({
      error: 'Yetkisiz erişim: Geçersiz veya eksik Bearer token (API_SECRET).',
      code: 'UNAUTHORIZED',
    });
  }

  next();
}

/**
 * 1.5. Aktör Türü Politikası Middleware (X-Actor-Type)
 * - Başlık yoksa veya 'discord' ise mevcut Discord aktör davranışı aynen korunur.
 * - 'site-guest': X-Actor-Id "g_" + 32 hex olmalı; yalnızca GET /api/games ve GET /api/roblox/lookup izinlidir.
 * - 'site-service': X-Actor-Id === "site" olmalı; yalnızca izinli servis uçlarına erişir.
 * İzin dışı her uçta 403 { code: 'ACTOR_NOT_ALLOWED' } döner.
 */
function enforceActorPolicy(req, res, next) {
  const rawType = req.headers['x-actor-type'];
  const actorType =
    typeof rawType === 'string' && rawType.trim() !== ''
      ? rawType.trim().toLowerCase()
      : ACTOR_TYPES.DISCORD;

  if (!VALID_ACTOR_TYPE_SET.has(actorType)) {
    return res.status(400).json({
      error: 'Geçersiz "X-Actor-Type" başlığı (discord, site-guest veya site-service olmalıdır).',
      code: 'INVALID_ACTOR_TYPE',
    });
  }

  req.actorType = actorType;

  // Varsayılan 'discord' türünde mevcut davranışa dokunma
  if (actorType === ACTOR_TYPES.DISCORD) {
    return next();
  }

  const rawActorId = req.headers['x-actor-id'];
  const actorId = typeof rawActorId === 'string' ? rawActorId.trim() : '';

  if (!actorId) {
    return res.status(400).json({
      error: 'Eksik başlık: Bu aktör türü için "X-Actor-Id" zorunludur.',
      code: 'MISSING_ACTOR_ID',
    });
  }

  if (actorType === ACTOR_TYPES.SITE_GUEST) {
    if (!SITE_GUEST_ID_REGEX.test(actorId)) {
      return res.status(400).json({
        error: 'Geçersiz başlık: site-guest için "X-Actor-Id" "g_" + 32 hex biçiminde olmalıdır.',
        code: 'INVALID_ACTOR_ID',
      });
    }
    req.actorId = actorId;
  } else if (actorType === ACTOR_TYPES.SITE_SERVICE) {
    if (actorId !== SITE_SERVICE_ACTOR_ID) {
      return res.status(400).json({
        error: 'Geçersiz başlık: site-service için "X-Actor-Id" değeri "site" olmalıdır.',
        code: 'INVALID_ACTOR_ID',
      });
    }
    req.actorId = SITE_SERVICE_ACTOR_ID;
  }

  if (!isRouteAllowedForActor(actorType, req.method, req.path)) {
    return res.status(403).json({
      error: 'Bu aktör türü bu uç noktaya erişemez.',
      code: 'ACTOR_NOT_ALLOWED',
    });
  }

  return next();
}

/**
 * Yalnızca belirli aktör türlerine açık uç noktalar için rota seviyesi koruma.
 * Örn: requireActorTypes(['site-service']) -> discord ve site-guest için 403 ACTOR_NOT_ALLOWED.
 */
function requireActorTypes(allowedTypes) {
  const allowedSet = new Set(Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes]);
  return function actorTypeGuard(req, res, next) {
    const currentType = req.actorType || ACTOR_TYPES.DISCORD;
    if (!allowedSet.has(currentType)) {
      return res.status(403).json({
        error: 'Bu aktör türü bu uç noktaya erişemez.',
        code: 'ACTOR_NOT_ALLOWED',
      });
    }
    return next();
  };
}

/**
 * 2. Actor (İşlemi Yapan Kullanıcı) Doğrulama Middleware
 * - 'site-guest' ve 'site-service' enforceActorPolicy tarafından zaten doğrulandığı için Discord sunucu sorgusu yapmaz.
 * - 'discord' (varsayılan) için mevcut Discord üye doğrulaması aynen çalışır.
 */
async function requireActor(req, res, next) {
  const currentType = req.actorType || ACTOR_TYPES.DISCORD;
  if (currentType === ACTOR_TYPES.SITE_GUEST || currentType === ACTOR_TYPES.SITE_SERVICE) {
    if (!req.actorId) {
      return res.status(400).json({
        error: 'Eksik başlık: Bu işlem için "X-Actor-Id" zorunludur.',
        code: 'MISSING_ACTOR_ID',
      });
    }
    return next();
  }

  const rawActorId = req.headers['x-actor-id'];
  const actorId = typeof rawActorId === 'string' ? rawActorId.trim() : '';

  if (!actorId) {
    return res.status(400).json({
      error: 'Eksik başlık: Bu işlem için "X-Actor-Id" (işlemi yapan yetkili/üye Discord ID) zorunludur.',
      code: 'MISSING_ACTOR_ID',
    });
  }

  if (!/^\d{1,21}$/.test(actorId)) {
    return res.status(400).json({
      error: 'Geçersiz başlık: "X-Actor-Id" geçerli bir Discord ID olmalıdır.',
      code: 'INVALID_ACTOR_ID',
    });
  }

  if (!req.guild) {
    return res.status(503).json({
      error: 'Discord sunucusu henüz hazır değil veya önbelleğe alınamadı.',
      code: 'GUILD_UNAVAILABLE',
    });
  }

  try {
    const member = await req.guild.members.fetch(actorId).catch(() => null);
    if (!member) {
      return res.status(404).json({
        error: 'Belirtilen aktör (X-Actor-Id) Discord sunucusunda bulunamadı.',
        code: 'ACTOR_NOT_FOUND',
      });
    }

    req.actorId = actorId;
    req.actorMember = member;
    req.actorUser = member.user;
    next();
  } catch (err) {
    return res.status(500).json({
      error: 'Aktör bilgisi doğrulanırken sunucu hatası oluştu.',
      code: 'ACTOR_FETCH_FAILED',
    });
  }
}

/**
 * 3. Yönetim Yetkisi Kontrolü (Developer veya Yönetmenlik)
 * Yönetim endpoint'leri sadece Yönetmenlik (1559614111128490044) veya Developer (1561777507223601353) içindir.
 */
async function requireManagement(req, res, next) {
  if ((req.actorType || ACTOR_TYPES.DISCORD) !== ACTOR_TYPES.DISCORD) {
    return res.status(403).json({
      error: 'Bu aktör türü yönetim uç noktalarına erişemez.',
      code: 'ACTOR_NOT_ALLOWED',
    });
  }

  // Önce aktörü doğrula
  requireActor(req, res, () => {
    const member = req.actorMember;
    const isOwner = req.guild.ownerId === member.id;
    const isDeveloper =
      isOwner ||
      member.roles.cache.has(config.ROLES.DEVELOPER) ||
      (config.ROLES.FOUNDER && member.roles.cache.has(config.ROLES.FOUNDER)) ||
      (config.ROLES.COMMUNITY_OFFICIAL && member.roles.cache.has(config.ROLES.COMMUNITY_OFFICIAL));
    const isYonetmenlik =
      (config.ROLES.STAFF_GENERAL && member.roles.cache.has(config.ROLES.STAFF_GENERAL)) ||
      member.roles.cache.has(config.ROLES.TRYOUT_STAFF) || // 1559614111128490044
      member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isDeveloper && !isYonetmenlik) {
      return res.status(403).json({
        error: 'Erişim engellendi: Bu yönetim işlemine sadece Yönetmenlik veya Developer yetkisine sahip kullanıcılar erişebilir.',
        code: 'FORBIDDEN',
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
  if (
    isOwner ||
    member.roles.cache.has(config.ROLES.DEVELOPER) ||
    (config.ROLES.FOUNDER && member.roles.cache.has(config.ROLES.FOUNDER)) ||
    (config.ROLES.COMMUNITY_OFFICIAL && member.roles.cache.has(config.ROLES.COMMUNITY_OFFICIAL))
  ) {
    return 'developer';
  }
  if (
    (config.ROLES.STAFF_GENERAL && member.roles.cache.has(config.ROLES.STAFF_GENERAL)) ||
    member.roles.cache.has(config.ROLES.TRYOUT_STAFF) || // 1559614111128490044
    member.permissions?.has(PermissionFlagsBits.Administrator)
  ) {
    return 'yonetmenlik';
  }
  return 'member';
}

module.exports = {
  ACTOR_TYPES,
  SITE_GUEST_ID_REGEX,
  SITE_SERVICE_ACTOR_ID,
  isRouteAllowedForActor,
  apiKeyAuth,
  enforceActorPolicy,
  requireActorTypes,
  requireActor,
  requireManagement,
  getMemberLevel,
};
