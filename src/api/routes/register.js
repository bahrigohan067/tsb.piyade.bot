const express = require('express');
const router = express.Router();
const config = require('../../../config');
const gamesConfig = require('../../../games.config');
const database = require('../../utils/database');
const { createRegistrationApplication } = require('../../services/registrationService');
const { parseGenderInput } = require('../../utils/i18n');

/**
 * GET /api/register/status/:id
 * Kullanıcının kayıt başvuru durumunu döndürür (approved | pending | rejected | unregistered)
 */
async function getApplicationStatus(req, res) {
  const { id } = req.params;

  if (!id || !/^\d{1,21}$/.test(String(id))) {
    return res.status(400).json({ error: 'Geçersiz Discord ID formatı.' });
  }

  try {
    const member = req.guild ? await req.guild.members.fetch(id).catch(() => null) : null;
    const isRegisteredRole = config.isRegisteredMember(member);
    const regRecord = database.getRegistrationByDiscordId(id);

    if (isRegisteredRole || regRecord) {
      return res.json({
        userId: id,
        inGuild: Boolean(member),
        status: 'approved',
        message: 'Kayıt onaylandı ve üyelik aktif.',
        registration: regRecord || {
          registered: true,
          discordId: id,
        },
      });
    }

    const activeApp = database.getActiveApplication(id);
    if (activeApp) {
      return res.json({
        userId: id,
        inGuild: Boolean(member),
        status: 'pending',
        message: 'Kayıt başvurunuz yetkili onayında bekliyor.',
        application: {
          threadId: activeApp.threadId || null,
          robloxUsername: activeApp.robloxUsername || null,
          games: activeApp.games || [],
          gameUsernames: activeApp.gameUsernames || {},
          realName: activeApp.realName || null,
          gender: activeApp.gender || null,
          createdAt: activeApp.createdAt || null,
        },
      });
    }

    const rejected = database.getRejectedApplication(id);
    if (rejected) {
      return res.json({
        userId: id,
        inGuild: Boolean(member),
        status: 'rejected',
        message: 'Son kayıt başvurunuz yetkili tarafından reddedildi.',
        rejected: {
          reason: rejected.reason || 'Belirtilmedi',
          rejectedAt: rejected.rejectedAt || null,
          rejectedBy: rejected.rejectedBy || null,
        },
      });
    }

    return res.json({
      userId: id,
      inGuild: Boolean(member),
      status: 'unregistered',
      message: 'Kayıt başvurusu bulunmuyor.',
    });
  } catch (err) {
    return res.status(500).json({
      error: `Kayıt durumu sorgulanırken hata oluştu: ${err.message}`,
    });
  }
}

router.get('/status/:id', getApplicationStatus);
router.get('/:id', getApplicationStatus);

/**
 * POST /api/register
 * Site kayıt formu (gerçek ad/takma ad, cinsiyet, seçilen oyunlar + kullanıcı adları veya robloxInput).
 */
router.post('/', async (req, res) => {
  const { realName, gender, robloxInput, games, gameUsernames, lang } = req.body;
  const discordId = req.body.discordId || req.headers['x-actor-id'];
  const reqLang = lang === 'en' ? 'en' : 'tr';
  const isEn = reqLang === 'en';

  // 1. Girdi Doğrulama
  if (!discordId || !/^\d{1,21}$/.test(String(discordId))) {
    return res.status(400).json({
      error: isEn
        ? 'Invalid or missing Discord ID (require "discordId" in body or "X-Actor-Id" header).'
        : 'Geçersiz veya eksik Discord ID ("discordId" gövde alanı veya "X-Actor-Id" başlığı gereklidir).',
      code: 'INVALID_DISCORD_ID',
    });
  }

  if (!realName || typeof realName !== 'string' || realName.trim().length < 2 || realName.trim().length > 32) {
    return res.status(400).json({
      error: isEn
        ? 'Invalid real name (must be between 2 and 32 characters).'
        : 'Geçersiz ad / takma ad (en az 2, en fazla 32 karakter olmalıdır).',
      code: 'INVALID_REAL_NAME',
    });
  }

  const parsedGender = parseGenderInput(gender);
  const formattedGender = parsedGender.tr;

  let normalizedGames = gamesConfig.normalizeGameList(Array.isArray(games) ? games : []);
  const cleanUsernames =
    gameUsernames && typeof gameUsernames === 'object' ? { ...gameUsernames } : {};

  if (normalizedGames.length === 0) {
    if (!robloxInput || typeof robloxInput !== 'string' || robloxInput.trim().length < 1) {
      return res.status(400).json({
        error: isEn
          ? 'Please select at least 1 game or provide Roblox info.'
          : 'En az 1 oyun seçilmeli veya Roblox kullanıcı bilgisi girilmelidir.',
        code: 'INVALID_ROBLOX_INPUT',
      });
    }
    normalizedGames = ['roblox'];
    cleanUsernames.roblox = robloxInput.trim();
  }

  try {
    const member = await req.guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return res.status(404).json({
        error: isEn
          ? 'Specified Discord user was not found on the server. Please join the server first.'
          : 'Belirtilen Discord kullanıcısı sunucuda bulunamadı. Lütfen önce sunucuya katıldığınızdan emin olun.',
        code: 'MEMBER_NOT_FOUND',
      });
    }

    const result = await createRegistrationApplication({
      guild: req.guild,
      member,
      user: member.user,
      realName: realName.trim(),
      gender: formattedGender,
      games: normalizedGames,
      gameUsernames: cleanUsernames,
      robloxInput: cleanUsernames.roblox || (robloxInput ? String(robloxInput).trim() : null),
      source: 'site',
      lang: reqLang,
    });

    if (!result.success) {
      return res.status(400).json({
        error: result.message,
        code: result.code,
      });
    }

    return res.json({
      success: true,
      message: result.message,
      threadId: result.threadId,
      threadUrl: result.threadUrl,
      games: result.games,
      gameUsernames: result.gameUsernames,
      robloxUser: result.robloxUser,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Kayıt başvurusu oluşturulurken hata meydana geldi: ${err.message}`,
    });
  }
});

module.exports = router;
