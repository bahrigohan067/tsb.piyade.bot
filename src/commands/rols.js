const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../../config');

/**
 * Kullanıcının Sunucu Sahibi veya Developer olup olmadığını kontrol eder
 */
function isAuthorized(member, guild) {
  if (!member) return false;
  if (guild && String(guild.ownerId) === String(member.id)) return true;
  if (config.ROLES.DEVELOPER && member.roles?.cache?.has(config.ROLES.DEVELOPER)) return true;
  return false;
}

/**
 * Rolleri hiyerarşik sıraya göre sıralar (@everyone hariç, en yüksek en üstte)
 */
function sortGuildRoles(roles, guildId) {
  return Array.from(roles.values())
    .filter((role) => role.id !== guildId)
    .sort((a, b) => b.position - a.position);
}

/**
 * Rol listesini Discord embed'lerine böler
 */
function buildRoleEmbeds(sortedRoles, brandName = config.BRAND_NAME || 'Piyade') {
  const chunkSize = 20;
  const totalPages = Math.ceil(sortedRoles.length / chunkSize) || 1;
  const embeds = [];

  for (let i = 0; i < sortedRoles.length; i += chunkSize) {
    const chunk = sortedRoles.slice(i, i + chunkSize);
    const pageNumber = Math.floor(i / chunkSize) + 1;

    const roleLines = chunk.map((role, idx) => {
      const rank = i + idx + 1;
      const managedBadge = role.managed ? ' 🤖 *(Bot/Entegrasyon)*' : '';
      return `**${rank}.** <@&${role.id}> — **${role.name}** \`(ID: ${role.id})\`${managedBadge}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`👑 ${brandName} | Sunucu Rol Listesi (Sayfa ${pageNumber}/${totalPages})`)
      .setColor(config.COLORS.PRIMARY || 0x0099FF)
      .setDescription(
        `Sunucudaki roller en yetkili olandan en düşüğe doğru hiyerarşik sırayla listelenmiştir:\n\n` +
        roleLines.join('\n')
      )
      .setFooter({
        text: `Toplam Rol: ${sortedRoles.length} • Yalnızca Sunucu Sahibi & Developer`,
      })
      .setTimestamp();

    embeds.push(embed);
  }

  return embeds;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rols')
    .setDescription('Tüm rolleri hiyerarşik sırayla etiketler ve listeler. (Kurucu & Developer)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  isAuthorized,
  sortGuildRoles,
  buildRoleEmbeds,

  async execute(interaction) {
    // 1. Yetki Kontrolü: Yalnızca Sunucu Sahibi veya Developer Rolü
    if (!isAuthorized(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: `❌ Bu komutu yalnızca **Sunucu Sahibi** veya <@&${config.ROLES.DEVELOPER}> rolüne sahip **Developer** kullanabilir!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // 2. Rolleri güncel olarak getir ve hiyerarşi sırasına (b.position - a.position) göre diz
      await interaction.guild.roles.fetch();

      const sortedRoles = sortGuildRoles(interaction.guild.roles.cache, interaction.guild.id);

      if (sortedRoles.length === 0) {
        return interaction.editReply({
          content: '⚠️ Sunucuda listelenecek özel bir rol bulunamadı.',
        });
      }

      // 3. Embed'leri üret (Her sayfada 20 rol)
      const embeds = buildRoleEmbeds(sortedRoles, config.BRAND_NAME);

      // Discord tek bir mesajda en fazla 10 embed kabul eder
      const firstBatch = embeds.slice(0, 10);
      await interaction.editReply({
        embeds: firstBatch,
        allowedMentions: { parse: [] }, // Rol etiketlerinin sunucudaki üyelere bildirim göndermesini engeller
      });

      // 10 embed'den fazlaysa kalanları ek takip mesajları (followUp) olarak gönder
      if (embeds.length > 10) {
        for (let i = 10; i < embeds.length; i += 10) {
          const nextBatch = embeds.slice(i, i + 10);
          await interaction.followUp({
            embeds: nextBatch,
            allowedMentions: { parse: [] },
            ephemeral: true,
          });
        }
      }
    } catch (err) {
      console.error('[ROLS KOMUTU HATASI]:', err);
      return interaction.editReply({
        content: `❌ Roller listelenirken bir hata oluştu: ${err.message}`,
      });
    }
  },
};
