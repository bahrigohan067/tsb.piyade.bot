const express = require('express');
const router = express.Router();
const { getHelpStatus, triggerHelpCall } = require('../../utils/helpManager');
const { requireActor } = require('../middleware/auth');

/**
 * GET /api/help/status
 * Aktif üye sayısı ve (isteğe bağlı aktör için) çağrı cooldown durumunu döndürür.
 */
router.get('/status', async (req, res) => {
  try {
    const actorId = req.headers['x-actor-id'] || req.query.userId || null;
    const status = await getHelpStatus(req.guild, actorId);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: `Yardım durumu sorgulanırken hata oluştu: ${err.message}` });
  }
});

/**
 * POST /api/help/call
 * Acil takviye çağrısı oluşturur (5 dk cooldown, Roblox profilli kart, toplu DM).
 */
router.post('/call', requireActor, async (req, res) => {
  try {
    const result = await triggerHelpCall({
      guild: req.guild,
      member: req.actorMember,
      user: req.actorUser,
      source: 'site',
    });

    if (!result.success) {
      if (result.cooldown) {
        return res.status(429).json({
          error: result.message,
          cooldown: true,
          remainingSeconds: result.remainingSeconds,
          readyAt: result.readyAt,
        });
      }
      return res.status(400).json({ error: result.message });
    }

    return res.json({
      success: true,
      message: result.message,
      dmCount: result.dmCount,
      alertMessageUrl: result.alertMessageUrl,
      robloxProfileUrl: result.robloxProfileUrl,
      readyAt: result.readyAt,
    });
  } catch (err) {
    return res.status(500).json({ error: `Acil yardım çağrısı başlatılırken hata oluştu: ${err.message}` });
  }
});

module.exports = router;
