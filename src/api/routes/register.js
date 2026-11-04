const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const { createRegistrationApplication } = require('../../services/registrationService');

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
    const isRegisteredRole = member && config.ROLES && member.roles.cache.has(config.ROLES.REGISTERED_CHECK);
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
 * Site kayıt formu (gerçek ad, cinsiyet, Roblox nick/ID/link).
 * Mevcut Roblox doğrulaması, çift başvuru koruması, thread açma ve yetkili onay kartı akışı aynen çalışır.
 */
router.post('/', async (req, res) => {
  const { realName, gender, robloxInput } = req.body;
  const discordId = req.body.discordId || req.headers['x-actor-id'];

  // 1. Girdi Doğrulama
  if (!discordId || !/^\d{1,21}$/.test(String(discordId))) {
    return res.status(400).json({
      error: 'Geçersiz veya eksik Discord ID ("discordId" gövde alanı veya "X-Actor-Id" başlığı gereklidir).',
    });
  }

  if (!realName || typeof realName !== 'string' || realName.trim().length < 2 || realName.trim().length > 32) {
    return res.status(400).json({
      error: 'Geçersiz gerçek ad (en az 2, en fazla 32 karakter olmalıdır).',
    });
  }

  const cleanGender = String(gender || '').trim();
  const isFemale =
    cleanGender.toLowerCase().includes('kız') ||
    cleanGender.toLowerCase().includes('kiz') ||
    cleanGender.toLowerCase().includes('kadın');
  const formattedGender = isFemale ? '👩 Kız' : '👨 Erkek';

  if (!robloxInput || typeof robloxInput !== 'string' || robloxInput.trim().length < 1) {
    return res.status(400).json({
      error: 'Geçersiz Roblox bilgisi (Kullanıcı adı, ID veya Profil Linki girilmelidir).',
    });
  }

  try {
    const member = await req.guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return res.status(404).json({
        error: 'Belirtilen Discord kullanıcısı sunucuda bulunamadı. Lütfen önce sunucuya katıldığınızdan emin olun.',
      });
    }

    const result = await createRegistrationApplication({
      guild: req.guild,
      member,
      user: member.user,
      realName: realName.trim(),
      gender: formattedGender,
      robloxInput: robloxInput.trim(),
      source: 'site',
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
      robloxUser: result.robloxUser,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Kayıt başvurusu oluşturulurken hata meydana geldi: ${err.message}`,
    });
  }
});

module.exports = router;
