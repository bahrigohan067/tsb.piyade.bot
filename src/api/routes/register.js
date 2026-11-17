const express = require('express');
const router = express.Router();
const config = require('../../../config');
const gamesConfig = require('../../../games.config');
const database = require('../../utils/database');
const {
  createRegistrationApplication,
  checkRegistrationRateLimit,
  recordRegistrationAttempt,
} = require('../../services/registrationService');
const { parseGenderInput } = require('../../utils/i18n');
const { validateDisplayName, validateGameUsername } = require('../../utils/inputSanitizer');

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
        registration: regRecord
          ? {
              ...regRecord,
              displayName: regRecord.displayName || regRecord.realName || null,
              games: Array.isArray(regRecord.games) ? regRecord.games : [],
            }
          : {
              registered: true,
              discordId: id,
              displayName: null,
              games: [],
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
          displayName: activeApp.displayName || activeApp.realName || null,
          realName: activeApp.realName || null,
          gender: activeApp.gender || null,
          games: Array.isArray(activeApp.games) ? activeApp.games : [],
          robloxUsername: activeApp.robloxUsername || null,
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
 * Site kayıt formu.
 * Yeni gövde: { name, gender ('male'|'female'), games: [{ id, username }], lang, discordId? }
 * Geriye dönük uyumlu eski gövde: { realName, robloxInput, gender, lang, discordId? }
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const discordId = body.discordId || req.headers['x-actor-id'];
  const reqLang = body.lang === 'en' ? 'en' : 'tr';
  const isEn = reqLang === 'en';

  // 1. Discord ID Kontrolü
  if (!discordId || !/^\d{1,21}$/.test(String(discordId))) {
    return res.status(400).json({
      error: isEn
        ? 'Invalid or missing Discord ID (require "discordId" in body or "X-Actor-Id" header).'
        : 'Geçersiz veya eksik Discord ID ("discordId" gövde alanı veya "X-Actor-Id" başlığı gereklidir).',
      code: 'INVALID_DISCORD_ID',
    });
  }

  // 2. Geriye Dönük Uyumlu Alan Eşleme (name / realName ve games / robloxInput)
  const rawName = body.name !== undefined ? body.name : body.realName;
  let rawGames = [];
  if (Array.isArray(body.games)) {
    rawGames = body.games;
  } else if (body.robloxInput !== undefined && body.robloxInput !== null && String(body.robloxInput).trim() !== '') {
    rawGames = [{ id: 'roblox', username: body.robloxInput }];
  }

  // 3. Ad / Takma Ad Doğrulama
  const nameCheck = validateDisplayName(rawName);
  if (!nameCheck.ok) {
    return res.status(400).json({
      error: isEn ? nameCheck.error.en : nameCheck.error.tr,
      code: 'NAME_INVALID',
    });
  }

  // 4. Oyun Seçimi ve Oyun Kullanıcı Adı Doğrulama
  if (rawGames.length === 0) {
    return res.status(400).json({
      error: isEn
        ? 'Please select at least one game to register.'
        : 'Kayıt olmak için lütfen en az bir oyun seçiniz.',
      code: 'NO_GAME_SELECTED',
    });
  }

  const cleanGames = [];
  const seenIds = new Set();
  for (const item of rawGames) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({
        error: isEn ? 'Invalid game entry format.' : 'Geçersiz oyun veri formatı.',
        code: 'GAME_USERNAME_INVALID',
        details: { game: 'unknown' },
      });
    }

    const gid = String(item.id || '').trim().toLowerCase();
    const gameCfg = gamesConfig.getGameById(gid);
    if (!gameCfg || gameCfg.enabled === false) {
      return res.status(400).json({
        error: isEn ? `Unsupported game: ${gid || 'unknown'}` : `Desteklenmeyen oyun: ${gid || 'bilinmiyor'}`,
        code: 'GAME_USERNAME_INVALID',
        details: { game: gid || 'unknown' },
      });
    }

    if (seenIds.has(gameCfg.id)) continue;
    seenIds.add(gameCfg.id);

    const userCheck = validateGameUsername(gameCfg, item.username);
    if (!userCheck.ok) {
      return res.status(400).json({
        error: isEn ? userCheck.error.en : userCheck.error.tr,
        code: 'GAME_USERNAME_INVALID',
        details: { game: gameCfg.id },
      });
    }

    cleanGames.push({
      id: gameCfg.id,
      username: userCheck.value,
    });
  }

  const parsedGender = parseGenderInput(body.gender);
  const formattedGender = parsedGender.tr;

  try {
    const member = req.guild ? await req.guild.members.fetch(discordId).catch(() => null) : null;
    if (!member) {
      return res.status(404).json({
        error: isEn
          ? 'Specified Discord user was not found on the server. Please join the server first.'
          : 'Belirtilen Discord kullanıcısı sunucuda bulunamadı. Lütfen önce sunucuya katıldığınızdan emin olun.',
        code: 'MEMBER_NOT_FOUND',
      });
    }

    const rateCheck = checkRegistrationRateLimit(member.id);
    if (rateCheck.limited) {
      return res.status(429).json({
        error: isEn
          ? `Too many registration attempts. Please try again in ${rateCheck.retryAfterSec} seconds.`
          : `Çok fazla kayıt denemesi yaptınız. Lütfen ${rateCheck.retryAfterSec} saniye sonra tekrar deneyin.`,
        code: 'RATE_LIMITED',
        retryAfterSec: rateCheck.retryAfterSec,
      });
    }
    recordRegistrationAttempt(member.id);

    const result = await createRegistrationApplication({
      guild: req.guild,
      member,
      user: member.user,
      name: nameCheck.value,
      gender: formattedGender,
      games: cleanGames,
      source: 'web',
      lang: reqLang,
    });

    if (!result.success) {
      return res.status(result.httpStatus || 400).json({
        error: result.message,
        code: result.code,
        ...(result.details ? { details: result.details } : {}),
      });
    }

    return res.json({
      success: true,
      message: result.message,
      threadId: result.threadId,
      threadUrl: result.threadUrl,
      robloxUser: result.robloxUser,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Kayıt başvurusu oluşturulurken hata meydana geldi: ${err.message}`,
    });
  }
});

module.exports = router;
