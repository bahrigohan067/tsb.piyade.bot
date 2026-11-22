const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const { getMemberLevel } = require('../middleware/auth');
const { computeUserActivitySummary } = require('../../commands/aktivitem');

/**
 * GET /api/member/:id/roles
 * Üyenin sunucudaki rollerini ve hesaplanan yetki seviyesini döndürür.
 */
router.get('/:id/roles', async (req, res) => {
  const { id } = req.params;

  if (!id || !/^\d{1,21}$/.test(id)) {
    return res.status(400).json({ error: 'Geçersiz Discord ID formatı.' });
  }

  try {
    const member = await req.guild.members.fetch(id).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Kullanıcı Discord sunucusunda bulunamadı.' });
    }

    const roles = member.roles.cache
      .filter((r) => r.id !== req.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        isHoisted: r.hoist,
      }));

    const level = getMemberLevel(member, req.guild);
    const highestRolePosition = member.roles?.highest?.position || 0;

    const reg = database.getRegistrationByDiscordId(id);
    const isRegMember = config.isRegisteredMember(member) || Boolean(reg);

    return res.json({
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: member.user.displayAvatarURL({ dynamic: true }),
      level,
      registered: isRegMember,
      highestRolePosition,
      roles,
    });
  } catch (err) {
    return res.status(500).json({ error: `Roller alınırken hata oluştu: ${err.message}` });
  }
});

/**
 * GET /api/member/:id/profile
 * Gerçek ad, Roblox nick/ID/link, Tryout seviyesi, VS puan/kill ve Ceza puanını döndürür.
 */
router.get('/:id/profile', async (req, res) => {
  const { id } = req.params;

  if (!id || !/^\d{1,21}$/.test(id)) {
    return res.status(400).json({ error: 'Geçersiz Discord ID formatı.' });
  }

  try {
    const member = await req.guild.members.fetch(id).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Kullanıcı Discord sunucusunda bulunamadı.' });
    }

    // 1. Kayıt Bilgileri
    const reg = database.getRegistrationByDiscordId(id);

    // 2. Ceza & Uyarı Bilgileri
    const warnStats = database.getUserWarningStats(id);

    // 3. Yetki Seviyesi
    const level = getMemberLevel(member, req.guild);

    return res.json({
      discord: {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarUrl: member.user.displayAvatarURL({ dynamic: true }),
        joinedAt: member.joinedTimestamp,
        createdAt: member.user.createdTimestamp,
        level,
      },
      registration: {
        registered: Boolean(reg) || config.isRegisteredMember(member),
        displayName: reg?.displayName || reg?.realName || null,
        realName: reg?.realName || null,
        gender: reg?.gender || null,
        games: Array.isArray(reg?.games) ? reg.games : [],
        robloxUsername: reg?.robloxUsername || null,
        robloxId: reg?.robloxId || null,
        robloxDisplayName: reg?.robloxDisplayName || null,
        robloxProfileUrl: reg?.robloxId ? `https://www.roblox.com/users/${reg.robloxId}/profile` : null,
        registeredAt: reg?.registeredAt || null,
      },
      warnings: {
        points: warnStats.points || 0,
        tier: warnStats.tier || 0,
        staffWarnings: warnStats.staffWarnings || 0,
        totalWarnings: warnStats.totalWarnings || 0,
        suspendedUntil: warnStats.suspendedUntil || null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: `Profil bilgileri alınırken hata oluştu: ${err.message}` });
  }
});

/**
 * GET /api/member/:id/activity?lang=tr|en
 * Üyenin bu ayki oyun etkinliği özetini (/aktivitem ile birebir aynı hesaplamayla) döndürür.
 */
router.get('/:id/activity', async (req, res) => {
  const { id } = req.params;

  if (!id || !/^\d{1,21}$/.test(id)) {
    return res.status(400).json({ error: 'Geçersiz Discord ID formatı.' });
  }

  try {
    const member = await req.guild.members.fetch(id).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Kullanıcı Discord sunucusunda bulunamadı.' });
    }

    const lang = req.query.lang === 'en' ? 'en' : 'tr';
    const summary = computeUserActivitySummary({
      userId: member.id,
      lang,
    });

    return res.json({
      userId: summary.userId,
      month: summary.month,
      tracking: summary.tracking,
      games: summary.games.map((g) => ({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        family: g.family,
        seconds: g.seconds,
        percent: g.percent,
        formattedDuration: g.formattedDuration,
      })),
      totalSeconds: summary.totalSeconds,
      live: summary.live,
      nextResetAt: summary.nextResetAt,
      nextResetUnix: summary.nextResetUnix,
    });
  } catch (err) {
    return res.status(500).json({ error: `Etkinlik bilgileri alınırken hata oluştu: ${err.message}` });
  }
});

module.exports = router;
