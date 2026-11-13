const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const { createRegistrationApplication } = require('../../services/registrationService');
const { parseGenderInput } = require('../../utils/i18n');
const clanMatcher = require('../../utils/clanMatcher');

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
      const regType = regRecord?.registrationType || (member?.roles?.cache?.has(config.ROLES?.OTHER_CLAN) ? 'other' : 'own');
      return res.json({
        userId: id,
        inGuild: Boolean(member),
        status: 'approved',
        message: 'Kayıt onaylandı ve üyelik aktif.',
        registrationType: regType,
        clanName: regRecord?.clanName || null,
        registration: regRecord || {
          registered: true,
          discordId: id,
          registrationType: regType,
          clanName: null,
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
        registrationType: activeApp.registrationType || 'own',
        clanName: activeApp.clanTypedName || null,
        application: {
          threadId: activeApp.threadId || null,
          robloxUsername: activeApp.robloxUsername || null,
          realName: activeApp.realName || null,
          gender: activeApp.gender || null,
          registrationType: activeApp.registrationType || 'own',
          clanName: activeApp.clanTypedName || null,
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
 * Site kayıt formu (gerçek ad, cinsiyet, Roblox nick/ID/link, kayıt türü ve klan adı).
 */
router.post('/', async (req, res) => {
  const { realName, gender, robloxInput, registrationType, clanName, lang } = req.body;
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
        : 'Geçersiz gerçek ad (en az 2, en fazla 32 karakter olmalıdır).',
      code: 'INVALID_REAL_NAME',
    });
  }

  const parsedGender = parseGenderInput(gender);
  const formattedGender = parsedGender.tr;

  if (!robloxInput || typeof robloxInput !== 'string' || robloxInput.trim().length < 1) {
    return res.status(400).json({
      error: isEn
        ? 'Invalid Roblox info (Username, User ID, or Profile link required).'
        : 'Geçersiz Roblox bilgisi (Kullanıcı adı, ID veya Profil Linki girilmelidir).',
      code: 'INVALID_ROBLOX_INPUT',
    });
  }

  // registrationType: 'own' | 'other' (default 'own')
  const regType = registrationType === 'other' ? 'other' : 'own';

  if (regType === 'other') {
    if (!clanName || typeof clanName !== 'string' || !clanName.trim()) {
      return res.status(400).json({
        error: isEn
          ? 'Clan name is required for Other Clan registration.'
          : 'Başka klan kaydı için klan adı zorunludur.',
        code: 'CLAN_REQUIRED',
      });
    }

    const sanitized = clanMatcher.sanitizeClanName(clanName);
    if (!sanitized.valid) {
      return res.status(400).json({
        error: isEn
          ? (sanitized.error === 'CLAN_BLOCKED'
              ? 'The clan name you entered contains disallowed content (mentions, invite links, or inappropriate language).'
              : 'Invalid clan name! Must be between 2 and 32 characters and contain valid letters.')
          : (sanitized.error === 'CLAN_BLOCKED'
              ? 'Girdiğiniz klan adı uygunsuz içerik (etiket, link veya küfür) içerdiği için reddedildi.'
              : 'Geçersiz klan adı! Klan adı 2-32 karakter olmalı ve harf içermelidir.'),
        code: sanitized.error,
      });
    }
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
      robloxInput: robloxInput.trim(),
      registrationType: regType,
      clanName: regType === 'other' ? clanName.trim() : null,
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
      registrationType: regType,
      robloxUser: result.robloxUser,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Kayıt başvurusu oluşturulurken hata meydana geldi: ${err.message}`,
    });
  }
});

module.exports = router;
