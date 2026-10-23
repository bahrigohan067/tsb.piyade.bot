const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rols')
    .setDescription('Sunucudaki tüm rolleri ve ID\'lerini sırasıyla gösterir. (Kurucu & Developer)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // 1. Güvenlik Kontrolü: Sunucu Kurucusu veya Developer Rolü (<@&1561777507223601353>)
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    const isDeveloper = config.ROLES.DEVELOPER && interaction.member.roles.cache.has(config.ROLES.DEVELOPER);

    if (!isOwner && !isDeveloper) {
      return interaction.reply({
        content: `❌ Bu komutu yalnızca **Sunucu Kurucusu** veya **<@&${config.ROLES.DEVELOPER}>** rolüne sahip kişiler kullanabilir!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Rolleri önbelleğe çek ve hiyerarşi sırasına göre diz (En yüksek rol en üstte)
      await interaction.guild.roles.fetch();

      const sortedRoles = Array.from(interaction.guild.roles.cache.values())
        .filter((role) => role.id !== interaction.guild.id) // @everyone hariç tutulur
        .sort((a, b) => b.position - a.position);

      if (sortedRoles.length === 0) {
        return interaction.editReply({
          content: '⚠️ Sunucuda listelenecek özel bir rol bulunamadı.',
        });
      }

      // Discord Embed sınırını (4096 karakter) aşmamak için rolleri 25'erli parçalara ayır
      const chunkSize = 20;
      const totalPages = Math.ceil(sortedRoles.length / chunkSize);
      const embeds = [];

      for (let i = 0; i < sortedRoles.length; i += chunkSize) {
        const chunk = sortedRoles.slice(i, i + chunkSize);
        const pageNumber = Math.floor(i / chunkSize) + 1;

        const roleLines = chunk.map((role, idx) => {
          const rank = i + idx + 1;
          const isManaged = role.managed ? ' *(Entegrasyon/Bot)*' : '';
          return `**#${rank}** • <@&${role.id}> (${role.name})${isManaged}\n└ **ID:** \`${role.id}\``;
        });

        const embed = new EmbedBuilder()
          .setTitle(`👑 Sunucu Rol Listesi (Sayfa ${pageNumber}/${totalPages})`)
          .setColor(config.COLORS.PRIMARY || 0x0099FF)
          .setDescription(
            `Sunucudaki roller en yetkili olandan en düşüğe doğru sıralanmıştır:\n\n` +
            roleLines.join('\n\n')
          )
          .setFooter({
            text: `Toplam Rol: ${sortedRoles.length} • Kurucu & Developer Yetkisi`,
          })
          .setTimestamp();

        embeds.push(embed);
      }

      // Discord tek mesajda en fazla 10 embed kabul eder
      return interaction.editReply({
        embeds: embeds.slice(0, 10),
      });
    } catch (err) {
      console.error('[ROLS KOMUTU HATASI]:', err);
      return interaction.editReply({
        content: `❌ Roller listelenirken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
