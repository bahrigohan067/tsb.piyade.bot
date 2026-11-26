const express = require('express');
const router = express.Router();
const database = require('../../utils/database');
const robloxService = require('../../services/roblox');
const { ACTOR_TYPES, requireActor, requireActorTypes } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  sanitizeTextInput,
  containsMention,
  containsDiscordInvite,
  containsUrl,
  isValidRobloxProfileUrl,
} = require('../../utils/inputSanitizer');

const ROBLOX_ID_REGEX = /^\d{1,20}$/;
const SITE_OWNER_REF_REGEX = /^m_[A-Za-z0-9_-]{1,64}$/;
const MAX_AVATAR_IDS = 100;

// Roblox sorgu ucu için aktör başına hız sınırı:
// - discord ve site-guest: dakikada en çok 10 istek
// - site-service: dakikada en çok 120 istek
const robloxLookupRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: (req) => (req.actorType === ACTOR_TYPES.SITE_SERVICE ? 120 : 10),
  code: 'RATE_LIMITED',
  message: 'Çok fazla Roblox sorgusu gönderdiniz. Lütfen bir dakika bekleyin.',
  keyGenerator: (req) =>
    `${req.actorType || ACTOR_TYPES.DISCORD}:${req.actorId || req.headers['x-actor-id'] || req.ip || 'anonymous'}`,
});

// Yalnızca site-service uçları (avatars, site-claims) için dakikada en çok 120 istek
const robloxServiceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  code: 'RATE_LIMITED',
  message: 'Çok fazla servis isteği gönderildi. Lütfen kısa süre sonra tekrar deneyin.',
  keyGenerator: (req) =>
    `${req.actorType || ACTOR_TYPES.SITE_SERVICE}:${req.actorId || req.headers['x-actor-id'] || req.ip || 'anonymous'}`,
});

function resetRobloxRateLimiters() {
  if (typeof robloxLookupRateLimiter.reset === 'function') robloxLookupRateLimiter.reset();
  if (typeof robloxServiceRateLimiter.reset === 'function') robloxServiceRateLimiter.reset();
}

/**
 * GET /api/roblox/lookup?query=...(&ignoreOwnerRef=m_xxx)
 * Web kayıt formundaki anlık Roblox ön izleme ve çakışma kontrolü için kullanılır.
 * - discord, site-guest (10/dk) ve site-service (120/dk) aktörleri erişebilir.
 * - alreadyRegistered hem Discord kayıtlarını hem siteRobloxClaims sahiplenmelerini kapsar.
 * - ignoreOwnerRef yalnızca site-service aktöründe dikkate alınır (üye kendi hesabını yeniden doğrularken çakışmasın).
 * - Kimin adına kayıtlı olduğu ASLA sızdırılmaz.
 */
router.get('/lookup', requireActor, robloxLookupRateLimiter, async (req, res) => {
  const rawQuery = typeof req.query?.query === 'string' ? req.query.query : '';
  const cleanQuery = sanitizeTextInput(rawQuery);

  if (!cleanQuery || cleanQuery.length > 100) {
    return res.status(400).json({
      error: 'Geçerli bir Roblox kullanıcı adı, ID veya profil linki giriniz (1-100 karakter).',
      code: 'INVALID_QUERY',
    });
  }

  if (/^@+$/.test(cleanQuery)) {
    return res.status(400).json({
      error: 'Lütfen @ işaretinden sonra geçerli bir Roblox kullanıcı adı giriniz.',
      code: 'INVALID_QUERY',
    });
  }

  if (containsMention(cleanQuery) || containsDiscordInvite(cleanQuery)) {
    return res.status(400).json({
      error: 'Sorgu içinde Discord etiketi veya davet bağlantısı kullanılamaz.',
      code: 'MENTION_FORBIDDEN',
    });
  }

  if (containsUrl(cleanQuery) && !isValidRobloxProfileUrl(cleanQuery)) {
    return res.status(400).json({
      error: 'Yalnızca geçerli Roblox profil linki (roblox.com/users/<ID>/profile) veya kullanıcı adı girilebilir.',
      code: 'URL_FORBIDDEN',
    });
  }

  // ignoreOwnerRef yalnızca site-service aktörü için geçerlidir
  let ignoreOwnerRef = null;
  if (req.actorType === ACTOR_TYPES.SITE_SERVICE && req.query?.ignoreOwnerRef !== undefined && req.query.ignoreOwnerRef !== '') {
    if (typeof req.query.ignoreOwnerRef !== 'string' || !SITE_OWNER_REF_REGEX.test(req.query.ignoreOwnerRef.trim())) {
      return res.status(400).json({
        error: 'Geçersiz ignoreOwnerRef biçimi ("m_" ile başlamalıdır).',
        code: 'INVALID_OWNER_REF',
      });
    }
    ignoreOwnerRef = req.query.ignoreOwnerRef.trim();
  }

  try {
    const result = await robloxService.resolveUser(cleanQuery);

    if (!result || !result.success) {
      const errCode = result?.error || 'API_ERROR';

      if (errCode === 'NOT_FOUND') {
        return res.json({
          status: 'NOT_FOUND',
          alreadyRegistered: false,
        });
      }

      if (errCode === 'BANNED') {
        return res.json({
          status: 'BANNED',
          alreadyRegistered: false,
        });
      }

      // RATE_LIMITED, CONNECTION_ERROR, API_ERROR vb. geçici hatalar NOT_FOUND sanılmamalıdır
      return res.json({
        status: 'TEMPORARY_ERROR',
        alreadyRegistered: false,
      });
    }

    const rbUser = result.user;
    const takenInfo = database.isRobloxIdTaken(rbUser.id, { ignoreOwnerRef });
    const alreadyRegistered = Boolean(takenInfo.taken);

    return res.json({
      status: 'FOUND',
      user: {
        id: String(rbUser.id),
        name: rbUser.name,
        displayName: rbUser.displayName || rbUser.name,
        profileUrl: rbUser.profileUrl || `https://www.roblox.com/users/${rbUser.id}/profile`,
        avatarUrl: rbUser.avatarUrl || null,
      },
      alreadyRegistered,
    });
  } catch (err) {
    console.error('[API ROBLOX LOOKUP ERROR]:', err?.message || 'Bilinmeyen hata');
    return res.json({
      status: 'TEMPORARY_ERROR',
      alreadyRegistered: false,
    });
  }
});

/**
 * POST /api/roblox/avatars
 * Gövde: { ids: [en çok 100 robloxId] } -> { [id]: url | null }
 * Yalnızca site-service aktörü erişebilir; mevcut 6 saat önbellekli ve rbxcdn.com doğrulamalı
 * getAvatarHeadshots servisini kullanır.
 */
router.post('/avatars', requireActorTypes([ACTOR_TYPES.SITE_SERVICE]), robloxServiceRateLimiter, async (req, res) => {
  const rawIds = req.body?.ids;
  if (!Array.isArray(rawIds)) {
    return res.status(400).json({
      error: 'İstek gövdesinde "ids" alanı bir Roblox ID dizisi olmalıdır.',
      code: 'INVALID_IDS',
    });
  }

  if (rawIds.length > MAX_AVATAR_IDS) {
    return res.status(400).json({
      error: `Tek seferde en çok ${MAX_AVATAR_IDS} Roblox ID sorgulanabilir.`,
      code: 'TOO_MANY_IDS',
    });
  }

  const orderedIds = [];
  const seen = new Set();
  for (const item of rawIds) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      return res.status(400).json({
        error: 'Her Roblox ID yalnızca rakamlardan oluşmalıdır.',
        code: 'INVALID_ID_FORMAT',
      });
    }
    const cleanId = String(item).trim();
    if (!ROBLOX_ID_REGEX.test(cleanId)) {
      return res.status(400).json({
        error: 'Geçersiz Roblox ID formatı.',
        code: 'INVALID_ID_FORMAT',
      });
    }
    if (!seen.has(cleanId)) {
      seen.add(cleanId);
      orderedIds.push(cleanId);
    }
  }

  if (orderedIds.length === 0) {
    return res.json({});
  }

  try {
    const avatarMap = await robloxService.getAvatarHeadshots(orderedIds);
    const responseObj = {};
    for (const id of orderedIds) {
      responseObj[id] = avatarMap instanceof Map ? avatarMap.get(id) ?? null : null;
    }
    return res.json(responseObj);
  } catch {
    const fallbackObj = {};
    for (const id of orderedIds) {
      fallbackObj[id] = null;
    }
    return res.json(fallbackObj);
  }
});

/**
 * PUT /api/roblox/site-claims/:robloxId
 * Gövde: { ownerRef: "m_..." }
 * Yalnızca site-service aktörü erişebilir.
 * - Discord kaydında veya başka bir ownerRef'te varsa 409 { code: 'ROBLOX_ALREADY_REGISTERED' } (kimin olduğu ASLA dönülmez).
 * - Aynı ownerRef için idempotent başarılı döner.
 */
router.put(
  '/site-claims/:robloxId',
  requireActorTypes([ACTOR_TYPES.SITE_SERVICE]),
  robloxServiceRateLimiter,
  (req, res) => {
    const robloxId = String(req.params?.robloxId || '').trim();
    if (!ROBLOX_ID_REGEX.test(robloxId)) {
      return res.status(400).json({
        error: 'Geçersiz Roblox ID formatı.',
        code: 'INVALID_ROBLOX_ID',
      });
    }

    const rawOwnerRef = req.body?.ownerRef;
    const ownerRef = typeof rawOwnerRef === 'string' ? rawOwnerRef.trim() : '';
    if (!SITE_OWNER_REF_REGEX.test(ownerRef)) {
      return res.status(400).json({
        error: 'Geçersiz veya eksik ownerRef ("m_" ile başlayan site üye kimliği olmalıdır).',
        code: 'INVALID_OWNER_REF',
      });
    }

    const claimResult = database.claimSiteRobloxId(robloxId, ownerRef);
    if (!claimResult.ok) {
      return res.status(409).json({
        error: 'Bu Roblox hesabı zaten başka bir üyeye kayıtlıdır.',
        code: 'ROBLOX_ALREADY_REGISTERED',
      });
    }

    return res.json({
      ok: true,
      robloxId: claimResult.claim.robloxId,
      ownerRef: claimResult.claim.ownerRef,
      at: claimResult.claim.at,
      idempotent: Boolean(claimResult.idempotent),
    });
  }
);

/**
 * DELETE /api/roblox/site-claims/:robloxId
 * Gövde (veya sorgu): { ownerRef: "m_..." }
 * Yalnızca site-service aktörü erişebilir.
 * - ownerRef eşleşirse sahiplenmeyi siler, eşleşmezse 403 { code: 'CLAIM_OWNER_MISMATCH' } döner (kimlik sızdırılmaz).
 */
router.delete(
  '/site-claims/:robloxId',
  requireActorTypes([ACTOR_TYPES.SITE_SERVICE]),
  robloxServiceRateLimiter,
  (req, res) => {
    const robloxId = String(req.params?.robloxId || '').trim();
    if (!ROBLOX_ID_REGEX.test(robloxId)) {
      return res.status(400).json({
        error: 'Geçersiz Roblox ID formatı.',
        code: 'INVALID_ROBLOX_ID',
      });
    }

    const rawOwnerRef = req.body?.ownerRef !== undefined ? req.body.ownerRef : req.query?.ownerRef;
    const ownerRef = typeof rawOwnerRef === 'string' ? rawOwnerRef.trim() : '';
    if (!SITE_OWNER_REF_REGEX.test(ownerRef)) {
      return res.status(400).json({
        error: 'Geçersiz veya eksik ownerRef ("m_" ile başlayan site üye kimliği olmalıdır).',
        code: 'INVALID_OWNER_REF',
      });
    }

    const releaseResult = database.releaseSiteRobloxClaim(robloxId, ownerRef);
    if (!releaseResult.ok) {
      return res.status(403).json({
        error: 'Bu Roblox sahiplenmesini silme yetkiniz yok.',
        code: 'CLAIM_OWNER_MISMATCH',
      });
    }

    return res.json({
      ok: true,
      deleted: Boolean(releaseResult.deleted),
      robloxId,
    });
  }
);

module.exports = router;
module.exports.resetRobloxRateLimiters = resetRobloxRateLimiters;
