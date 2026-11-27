const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const database = require('../utils/database');
const config = require('../../config');
const gamesConfig = require('../../games.config');
const { resolveLang } = require('../utils/i18n');

// /kayit-sifirla komutunu kullanmaya yetkili roller (yalnızca Developer ve Community Official)
const ALLOWED_ROLE_IDS = Object.freeze(
  [config.ROLES.DEVELOPER, config.ROLES.COMMUNITY_OFFICIAL].filter(Boolean)
);

/**
 * Kullanıcının yalnızca izin verilen rollerden (1561777507223601353 veya 1570767625188016259)
 * en az birine sahip olup olmadığını doğrular.
 */
function hasKayitSifirlaAuthority(member) {
  const roleCache = member?.roles?.cache;
  if (!roleCache || typeof roleCache.has !== 'function') return false;
  return ALLOWED_ROLE_IDS.some((roleId) => roleCache.has(roleId));
}

module.exports = {
  ALLOWED_ROLE_IDS,
  hasKayitSifirlaAuthority,

  data: new SlashCommandBuilder()
    .setName('kayit-sifirla')
    .setDescription('Seçilen kişinin kaydını ve rollerini sıfırlar, Roblox hesabını bot hafızasından siler.')
    .setDescriptionLocalizations({
      'en-US': 'Resets user registration, wipes Roblox data, removes roles, and grants unregistered role.',
    })
    .addUserOption((option) =>
      option
        .setName('kisi')
        .setDescription('Kaydı ve rolleri sıfırlanacak kullanıcıyı seçin')
        .setDescriptionLocalizations({
          'en-US': 'Select the user whose registration will be reset',
        })
        .setRequired(true)
    ),

  async execute(interaction) {
    const isEn = resolveLang(interaction) === 'en';

    // 1. Yetki Kontrolü: YALNIZCA Developer (1561777507223601353) ve Community Official (1570767625188016259) rolleri
    const isDev = Boolean(
      config.ROLES.DEVELOPER && interaction.member?.roles?.cache?.has?.(config.ROLES.DEVELOPER)
    );
    if (!hasKayitSifirlaAuthority(interaction.member)) {
      return interaction.reply({
        content: isEn
          ? `❌ Only members with the <@&${config.ROLES.DEVELOPER}> or <@&${config.ROLES.COMMUNITY_OFFICIAL}> role can use this command.`
          : `❌ Bu komutu yalnızca <@&${config.ROLES.DEVELOPER}> ve <@&${config.ROLES.COMMUNITY_OFFICIAL}> rollerine sahip yetkililer kullanabilir.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = interaction.options.getUser('kisi');
    if (!targetUser) {
      return interaction.reply({
        content: isEn ? '❌ Please specify a valid user.' : '❌ Lütfen geçerli bir kullanıcı belirtin.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // 2. Güvenlik Kontrolleri: Botun kendisi veya bot hesapları sıfırlanamaz
    if (targetUser.id === interaction.client.user.id) {
      return interaction.reply({
        content: isEn ? '❌ You cannot reset the bot itself!' : '❌ Botun kaydını sıfırlayamazsınız!',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (targetUser.bot) {
      return interaction.reply({
        content: isEn ? '❌ Bot accounts do not have registration records!' : '❌ Bot hesaplarının kayıt bilgisi bulunmaz!',
        flags: MessageFlags.Ephemeral,
      });
    }

    // 3. Hiyerarşi Kontrolü: Kendinden üst veya eşit yetkiliyi sıfırlayamaz (Developer hariç)
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (targetMember && !isDev) {
      if (targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({
          content: isEn
            ? '❌ You cannot reset the registration of a staff member with equal or higher rank than you!'
            : '❌ Kendinizle aynı veya sizden daha üst kademedeki bir yetkilinin kaydını sıfırlayamazsınız!',
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // 4. Veritabanından Kayıt, Roblox Bilgileri ve Başvuruları Temizle
    const activeApp = database.getActiveApplication(targetUser.id);
    const { removedRecord } = database.removeRegistration(targetUser.id);

    // Varsa devam eden alt başlığı (thread) kapat/sil
    if (activeApp && activeApp.threadId) {
      const thread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
      if (thread) {
        await thread.delete('Kayıt sıfırlandı: Yetkili tarafından başvuru odası temizlendi').catch(() => {});
      }
    }

    // 5. Discord Üzerindeki Rolleri Sıfırla ve Kayıtsız Rolünü Ver
    let strippedCount = 0;
    const strippedRoleNames = [];

    if (targetMember) {
      const botMember =
        interaction.guild.members.me ||
        (await interaction.guild.members.fetchMe().catch(() => null));
      const botHighestPos = botMember ? botMember.roles.highest.position : Infinity;

      // Alınacak roller: @everyone, managed ve botun hiyerarşisi üzerindeki roller hariç tüm roller
      const rolesToRemove = targetMember.roles.cache.filter((role) => {
        if (role.id === interaction.guild.id) return false;
        if (role.id === config.ROLES.UNREGISTERED) return false;
        if (role.managed) return false;
        if (role.position >= botHighestPos) return false;
        return true;
      });

      const rolesToRemoveIds = Array.from(rolesToRemove.keys());
      if (rolesToRemoveIds.length > 0) {
        strippedCount = rolesToRemoveIds.length;
        rolesToRemove.forEach((r) => strippedRoleNames.push(r.name));

        await targetMember.roles
          .remove(
            rolesToRemoveIds,
            `Kayıt sıfırlandı: Yetkili ${interaction.user.tag} (${interaction.user.id})`
          )
          .catch((err) => {
            console.warn(`[KAYIT SIFIRLA] Roller alınırken hata: ${err.message}`);
          });
      }

      // Kayıtsız rolü (<@&1559604540997636147>) ver
      if (config.ROLES.UNREGISTERED) {
        await targetMember.roles
          .add(
            config.ROLES.UNREGISTERED,
            `Kayıt sıfırlandı: Yetkili ${interaction.user.tag}`
          )
          .catch((err) => {
            console.warn(`[KAYIT SIFIRLA] Kayıtsız rolü verilirken hata: ${err.message}`);
          });
      }

      // Takma adı (Nickname) temizle
      if (targetMember.manageable && targetMember.nickname) {
        await targetMember
          .setNickname(null, `Kayıt sıfırlandı: Yetkili ${interaction.user.tag}`)
          .catch(() => {});
      }
    }

    // Silinen oyun / Roblox bilgisi özetini oluştur (geriye dönük uyumlu)
    let removedGamesValue = isEn ? '*No registration record found*' : '*Kayıtlı hesap bulunamadı*';
    if (removedRecord) {
      const removedGames = Array.isArray(removedRecord.games) ? removedRecord.games : [];
      if (removedGames.length > 0) {
        removedGamesValue = removedGames
          .map((g) => {
            const cfg = gamesConfig.getGameById(g.id);
            const label = cfg ? gamesConfig.getGameLabel(cfg, isEn ? 'en' : 'tr') : g.id;
            const idPart = g.robloxId ? ` (ID: \`${g.robloxId}\`)` : '';
            return `${cfg?.emoji || '🎮'} **${label}:** \`${g.username}\`${idPart}`;
          })
          .join('\n');
      } else if (removedRecord.robloxUsername) {
        removedGamesValue = `**@${removedRecord.robloxUsername}**\nID: \`${removedRecord.robloxId || '-'}\``;
      } else {
        removedGamesValue = `**${removedRecord.displayName || removedRecord.realName || 'Kayıt'}**`;
      }
    }

    // 6. Bilgilendirme Embed'i Oluştur
    const embed = new EmbedBuilder()
      .setTitle(isEn ? '🔄 Registration & Roles Successfully Reset' : '🔄 Kayıt ve Roller Başarıyla Sıfırlandı')
      .setColor(config.COLORS.WARNING_ORANGE || 0xFF7A00)
      .setDescription(
        isEn
          ? `The server registration, game accounts, and assigned roles of <@${targetUser.id}> have been completely reset.`
          : `<@${targetUser.id}> kullanıcısının sunucu kaydı, bot hafızasındaki oyun/Roblox hesapları ve rolleri başarıyla sıfırlandı.`
      )
      .addFields(
        {
          name: isEn ? '👤 User' : '👤 Kullanıcı',
          value: `<@${targetUser.id}> (\`${targetUser.id}\`)`,
          inline: true,
        },
        {
          name: isEn ? '🗑️ Wiped Games & Roblox Account' : '🗑️ Silinen Oyun / Roblox Hesabı',
          value: removedGamesValue,
          inline: true,
        },
        {
          name: isEn ? '🏷️ Removed Roles' : '🏷️ Alınan Roller',
          value:
            strippedCount > 0
              ? isEn
                ? `${strippedCount} roles removed`
                : `${strippedCount} adet rol alındı`
              : isEn
              ? '*No removable roles*'
              : '*Alınacak rol bulunamadı*',
          inline: true,
        },
        {
          name: isEn ? '➕ Assigned Role' : '➕ Verilen Rol',
          value: `<@&${config.ROLES.UNREGISTERED}>`,
          inline: true,
        },
        {
          name: isEn ? '👮 Authorized Staff' : '👮 İşlemi Yapan Yetkili',
          value: `<@${interaction.user.id}>`,
          inline: true,
        }
      )
      .setFooter({
        text: `${config.BRAND_NAME} • Kayıt Yönetim Sistemi`,
      })
      .setTimestamp();

    if (!targetMember) {
      embed.addFields({
        name: isEn ? '⚠️ Note' : '⚠️ Not',
        value: isEn
          ? 'The user is not currently in the Discord server, but all database records were wiped.'
          : 'Kullanıcı şu anda Discord sunucusunda bulunmuyor, ancak veritabanındaki tüm kayıtları silindi.',
      });
    }

    console.log(
      `[KAYIT SIFIRLANDI] Yetkili ${interaction.user.tag} (${interaction.user.id}), ${targetUser.tag} (${targetUser.id}) kullanıcısının kaydını ve ${strippedCount} rolünü sıfırladı.`
    );

    return interaction.reply({ embeds: [embed] });
  },
};
