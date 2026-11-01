const express = require('express');
const router = express.Router();
const database = require('../../utils/database');

/**
 * GET /api/vs/top10
 * VS Kapışma Top 10 sıralama verilerini döndürür.
 */
router.get('/top10', async (req, res) => {
  try {
    const rawTop10 = database.getTop10();

    const top10 = await Promise.all(
      rawTop10.map(async (entry, index) => {
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

        const points = Math.max(0, (entry.wins || 0) * 25 - (entry.losses || 0) * 15);

        return {
          rank: index + 1,
          userId: entry.userId,
          userTag,
          displayName,
          avatarUrl,
          kills: entry.kills,
          wins: entry.wins,
          losses: entry.losses,
          points,
          lastUpdated: entry.lastUpdated,
        };
      })
    );

    return res.json({
      total: top10.length,
      top10,
    });
  } catch (err) {
    return res.status(500).json({ error: `VS Top 10 sıralaması alınırken hata oluştu: ${err.message}` });
  }
});

module.exports = router;
