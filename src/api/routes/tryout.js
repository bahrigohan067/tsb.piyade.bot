const express = require('express');
const router = express.Router();
const database = require('../../utils/database');
const { getLevelRoleById } = require('../../utils/tryoutManager');

/**
 * GET /api/tryout/leaderboard
 * Tryout sıralama tablosu verilerini döndürür.
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const rawLeaderboard = database.getTryoutLeaderboard();

    const leaderboard = await Promise.all(
      rawLeaderboard.map(async (entry, index) => {
        let userTag = entry.userId;
        let displayName = entry.userId;
        let avatarUrl = null;

        if (req.guild) {
          const member =
            req.guild.members.cache.get(entry.userId) ||
            (await req.guild.members.fetch(entry.userId).catch(() => null));
          if (member) {
            userTag = member.user.tag || member.user.username;
            displayName = member.displayName;
            avatarUrl = member.user.displayAvatarURL({ dynamic: true });
          }
        }

        const roleObj = getLevelRoleById(entry.roleId);

        return {
          rank: index + 1,
          userId: entry.userId,
          userTag,
          displayName,
          avatarUrl,
          level: entry.level,
          roleId: entry.roleId,
          roleName: roleObj ? roleObj.name : `Seviye ${entry.level}`,
          canonical: roleObj ? roleObj.canonical : null,
          formCount: entry.formCount,
          lastUpdated: entry.lastUpdated,
        };
      })
    );

    return res.json({
      total: leaderboard.length,
      leaderboard,
    });
  } catch (err) {
    return res.status(500).json({ error: `Tryout sıralaması alınırken hata oluştu: ${err.message}` });
  }
});

module.exports = router;
