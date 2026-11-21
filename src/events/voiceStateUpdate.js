const { Events } = require('discord.js');
const activityTracker = require('../utils/activityTracker');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    activityTracker.handleVoiceStateUpdate(oldState, newState);
  },
};
