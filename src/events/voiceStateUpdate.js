const { Events } = require('discord.js');
const { handleVoiceStateUpdate } = require('../utils/afkVoiceManager');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    try {
      await handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      console.error('[VOICE STATE UPDATE HATASI]:', err);
    }
  },
};
