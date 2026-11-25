const { Events } = require('discord.js');
const activityTracker = require('../utils/activityTracker');
const statsRoutes = require('../api/routes/stats');
const directoryRoutes = require('../api/routes/directory');

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    const memberId = member?.id || member?.user?.id || null;
    activityTracker.handleMemberRemove(member);
    if (typeof statsRoutes.clearMemberLookupCache === 'function') {
      statsRoutes.clearMemberLookupCache(memberId);
    }
    if (typeof statsRoutes.clearSummaryCache === 'function') {
      statsRoutes.clearSummaryCache();
    }
    if (typeof statsRoutes.clearTopGamesCache === 'function') {
      statsRoutes.clearTopGamesCache();
    }
    if (typeof directoryRoutes.clearDirectoryMemberCache === 'function') {
      directoryRoutes.clearDirectoryMemberCache(memberId);
    }
  },
};
