const express = require('express');
const router = express.Router();
const { createRegistrationApplication } = require('../../services/registrationService');

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
