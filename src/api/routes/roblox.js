const express = require('express');
const router = express.Router();
const database = require('../../utils/database');
const robloxService = require('../../services/roblox');
const { requireActor } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  sanitizeTextInput,
  containsMention,
  containsDiscordInvite,
  containsUrl,
  isValidRobloxProfileUrl,
} = require('../../utils/inputSanitizer');

// Roblox sorgu ucu için aktör (X-Actor-Id) başına dakikada en çok 10 istek sınırı
const robloxLookupRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Çok fazla Roblox sorgusu gönderdiniz. Lütfen bir dakika bekleyin.',
});

/**
 * GET /api/roblox/lookup?query=...
 * Web kayıt formundaki anlık Roblox ön izleme ve çakışma kontrolü için kullanılır.
 * Geçerli X-Actor-Id (sunucu üyesi) zorunludur ve dakikada 10 istekle sınırlandırılır.
 * Çoklu hesap kontrolünde yalnızca alreadyRegistered boolean döner; diğer üyenin kimliği sızdırılmaz.
 */
router.get('/lookup', requireActor, robloxLookupRateLimiter, async (req, res) => {
  const rawQuery = typeof req.query?.query === 'string' ? req.query.query : '';
  const cleanQuery = sanitizeTextInput(rawQuery);

  if (!cleanQuery || cleanQuery.length > 100) {
    return res.status(400).json({
      error: 'Geçerli bir Roblox kullanıcı adı, ID veya profil linki giriniz (1-100 karakter).',
    });
  }

  if (/^@+$/.test(cleanQuery)) {
    return res.status(400).json({
      error: 'Lütfen @ işaretinden sonra geçerli bir Roblox kullanıcı adı giriniz.',
    });
  }

  if (containsMention(cleanQuery) || containsDiscordInvite(cleanQuery)) {
    return res.status(400).json({
      error: 'Sorgu içinde Discord etiketi veya davet bağlantısı kullanılamaz.',
    });
  }

  if (containsUrl(cleanQuery) && !isValidRobloxProfileUrl(cleanQuery)) {
    return res.status(400).json({
      error: 'Yalnızca geçerli Roblox profil linki (roblox.com/users/<ID>/profile) veya kullanıcı adı girilebilir.',
    });
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
    const existingReg = database.getRegistrationByRobloxId(rbUser.id);
    const alreadyRegistered = Boolean(existingReg);

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
    console.error('[API ROBLOX LOOKUP ERROR]:', err);
    return res.json({
      status: 'TEMPORARY_ERROR',
      alreadyRegistered: false,
    });
  }
});

module.exports = router;
