const { Events } = require('discord.js');
const config = require('../../config');
const { logMemberAdd } = require('../utils/serverLogManager');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 1. Sunucu Genel Log Kanalına bildir
    logMemberAdd(member).catch((err) =>
      console.error('[ÜYE KATILMA LOG HATASI]:', err.message)
    );

    // 2. Otomatik Kayıtsız rolü ver
    try {
      const unregisteredRoleId = config.ROLES.UNREGISTERED;
      if (!unregisteredRoleId) return;

      const role = member.guild.roles.cache.get(unregisteredRoleId);
      if (role) {
        await member.roles.add(role, 'Yeni üye - Otomatik Kayıtsız rolü verildi.');
        console.log(`[OTOMATİK ROL] ${member.user.tag} kullanıcısına Kayıtsız rolü verildi.`);
      } else {
        console.warn(`[OTOMATİK ROL] Kayıtsız rolü (${unregisteredRoleId}) sunucuda bulunamadı!`);
      }
    } catch (err) {
      console.error(`[OTOMATİK ROL] Rol verilirken hata (${member.user.tag}):`, err.message);
    }
  },
};
