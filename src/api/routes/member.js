const express = require('express');
const router = express.Router();
const config = require('../../../config');
const database = require('../../utils/database');
const { getMemberLevel } = require('../middleware/auth');
const { getLevelRoleById } = require('../../utils/tryoutManager');

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

    return res.json({
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: member.user.displayAvatarURL({ dynamic: true }),
      level,
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

    // 2. Tryout Seviyesi
    const tryout = database.getTryoutStats(id);
    let tryoutRole = null;
    if (tryout && tryout.roleId) {
      tryoutRole = getLevelRoleById(tryout.roleId);
    }

    // 3. VS İstatistikleri & Puan
    const vsStats = database.getVsStats(id);
    const vsPoints = Math.max(0, (vsStats.wins || 0) * 25 - (vsStats.losses || 0) * 15);

    // 4. Ceza & Uyarı Bilgileri
    const warnStats = database.getUserWarningStats(id);

    // 5. Yetki Seviyesi
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
        registered: Boolean(reg),
        realName: reg?.realName || null,
        gender: reg?.gender || null,
        robloxUsername: reg?.robloxUsername || null,
        robloxId: reg?.robloxId || null,
        robloxDisplayName: reg?.robloxDisplayName || null,
        robloxProfileUrl: reg?.robloxId ? `https://www.roblox.com/users/${reg.robloxId}/profile` : null,
        registeredAt: reg?.registeredAt || null,
      },
      tryout: {
        level: tryout?.level || 0,
        roleId: tryout?.roleId || null,
        roleName: tryoutRole?.name || null,
        canonical: tryoutRole?.canonical || null,
        formCount: tryout?.formCount || 0,
        lastUpdated: tryout?.lastUpdated || null,
      },
      vs: {
        kills: vsStats.kills || 0,
        wins: vsStats.wins || 0,
        losses: vsStats.losses || 0,
        points: vsPoints,
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

module.exports = router;
