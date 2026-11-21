const { Events } = require('discord.js');
const activityTracker = require('../utils/activityTracker');

module.exports = {
  name: Events.PresenceUpdate,
  execute(oldPresence, newPresence) {
    activityTracker.handlePresenceUpdate(oldPresence, newPresence);
  },
};
