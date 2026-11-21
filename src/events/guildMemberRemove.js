const { Events } = require('discord.js');
const activityTracker = require('../utils/activityTracker');

module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    activityTracker.handleMemberRemove(member);
  },
};
