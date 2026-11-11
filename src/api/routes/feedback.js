const express = require('express');
const router = express.Router();
const { submitFeedback } = require('../../utils/feedbackManager');

/**
 * POST /api/feedback
 * Web sitesinden gelen geri bildirimi doğrular, veritabanına kaydeder ve Discord kanalına iletir.
 * Gönderen kimliği yalnızca X-Actor-Id başlığından alınır.
 */
router.post('/', async (req, res) => {
  const rawActorHeader = req.headers['x-actor-id'];
  const actorId = String(
    Array.isArray(rawActorHeader) ? rawActorHeader[0] : rawActorHeader || ''
  ).trim();

  if (!actorId || !/^\d{1,21}$/.test(actorId)) {
    return res.status(403).json({
      code: 'NOT_IN_GUILD',
      error: 'Geçerli bir X-Actor-Id başlığı bulunamadı veya kullanıcı sunucu üyesi değil.',
    });
  }

  if (!req.guild || !req.guild.members) {
    return res.status(503).json({
      error: 'Discord sunucusu henüz hazır değil.',
    });
  }

  try {
    const member = await req.guild.members.fetch(actorId).catch(() => null);
    if (!member) {
      return res.status(403).json({
        code: 'NOT_IN_GUILD',
        error: 'Geri bildirim göndermek için Discord sunucusunun üyesi olmalısınız.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await submitFeedback({
      guild: req.guild,
      member,
      rawMessage: body.message,
      rawPage: body.page,
      rawLang: body.lang,
    });

    if (!result.ok) {
      if (result.status === 429) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        return res.status(429).json({
          code: result.code,
          retryAfterSec: result.retryAfterSec,
          error: result.error,
        });
      }

      return res.status(result.status).json({
        code: result.code,
        error: result.error,
      });
    }

    const responseBody = {
      success: true,
      id: result.id,
      delivered: result.delivered,
    };
    if (!result.delivered && result.reason) {
      responseBody.reason = result.reason;
    }

    return res.status(200).json(responseBody);
  } catch (err) {
    return res.status(500).json({
      error: `Geri bildirim işlenirken beklenmeyen hata oluştu: ${err.message}`,
    });
  }
});

module.exports = router;
