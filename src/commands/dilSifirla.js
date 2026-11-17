const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../../config');
const database = require('../utils/database');
const { findEnglishRoleInGuild } = require('../utils/i18n');

/**
 * Yalnızca Developer ve Yönetmenlik (WARNING_AUTHORITIES) veya Yönetici yetkisini kontrol eder.
 */
function hasLanguageResetAuthority(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const allowedRoles = config.ROLES.WARNING_AUTHORITIES || [];
  return allowedRoles.some((roleId) => member.roles?.cache?.has?.(roleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dil-sifirla')
    .setDescription('Bir kullanıcının kayıtlı dil tercihini ve English rolünü sıfırlar. (Yetkili)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Dil tercihi sıfırlanacak Discord kullanıcısı')
        .setRequired(true)
    ),

  hasLanguageResetAuthority,

  async execute(interaction) {
    // 1. Yetki Kontrolü
    if (!hasLanguageResetAuthority(interaction.member)) {
      return interaction.reply({
        content: '❌ Bu komutu yalnızca **Developer** ve **Yönetmenlik** yetkilileri kullanabilir.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = interaction.options.getUser('kullanici', true);
    const prevInfo = database.getUserLangInfo(targetUser.id);
    const dbCleared = database.clearUserLang(targetUser.id);

    // 2. En iyi çabayla English rolünü kaldır
    let roleStatus = 'Üyede English rolü bulunmuyordu';
    const guild = interaction.guild;
    if (guild && targetUser.id) {
      const targetMember = await guild.members?.fetch?.(targetUser.id).catch(() => null);
      const enRole = findEnglishRoleInGuild(guild);
      if (targetMember && enRole && targetMember.roles?.cache?.has?.(enRole.id)) {
        try {
          await targetMember.roles.remove(
            enRole.id,
            `Dil tercihi sıfırlandı (/dil-sifirla - Yetkili: ${interaction.user.tag})`
          );
          roleStatus = `<@&${enRole.id}> rolü kaldırıldı`;
        } catch (err) {
          roleStatus = `<@&${enRole.id}> rolü yetki nedeniyle kaldırılamadı (${err.message})`;
        }
      }
    }

    const prevText = prevInfo
      ? `\`${prevInfo.lang}\` (kaynak: \`${prevInfo.source}\`)`
      : '*Kayıtlı tercih yoktu*';

    // 3. Denetim logu (mevcut yetkili log kanalına)
    const logChannelId = config.CHANNELS.WEB_AUDIT_LOG || config.CHANNELS.WARNING_LOG;
    if (guild && logChannelId) {
      const logChannel =
        guild.channels?.cache?.get?.(logChannelId) ||
        (await guild.channels?.fetch?.(logChannelId).catch(() => null));
      if (logChannel && typeof logChannel.send === 'function') {
        const auditEmbed = new EmbedBuilder()
          .setTitle('🌐 Dil Tercihi Sıfırlandı (/dil-sifirla)')
          .setColor(config.COLORS.PRIMARY)
          .addFields(
            { name: '👮 Yetkili', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
            { name: '👤 Hedef Kullanıcı', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
            { name: '📄 Önceki Kayıt', value: prevText, inline: true },
            { name: '🎭 Rol Durumu', value: roleStatus, inline: false }
          )
          .setFooter({ text: `${config.BRAND_NAME} • Dil Yönetimi` })
          .setTimestamp();

        await logChannel
          .send({
            embeds: [auditEmbed],
            allowedMentions: { parse: [] },
          })
          .catch(() => {});
      }
    }

    return interaction.reply({
      content:
        `✅ <@${targetUser.id}> kullanıcısının dil tercihi sıfırlandı.\n` +
        `• **Veritabanı:** ${dbCleared ? `Silindi (önceki: ${prevText})` : 'Kayıt bulunmuyordu'}\n` +
        `• **Rol:** ${roleStatus}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
