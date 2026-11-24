const { Events } = require('discord.js');
const activityTracker = require('../utils/activityTracker');
const statsRoutes = require('../api/routes/stats');

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    activityTracker.handleMemberRemove(member);
    if (typeof statsRoutes.clearMemberLookupCache === 'function') {
      statsRoutes.clearMemberLookupCache(member?.id || member?.user?.id || null);
    }
    if (typeof statsRoutes.clearSummaryCache === 'function') {
      statsRoutes.clearSummaryCache();
    }
    if (typeof statsRoutes.clearTopGamesCache === 'function') {
      statsRoutes.clearTopGamesCache();
    }
  },
};
