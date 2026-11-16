const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config');
const gamesConfig = require('../../games.config');
const database = require('../utils/database');
const { resolveLang } = require('../utils/i18n');

/**
 * Kayıt kaydı ve Discord rollerinden kullanıcının oyun listesini ve kullanıcı adlarını çözer.
 * Eski (sadece Roblox) kayıtlarla da geriye dönük tam uyumludur.
 */
function resolveMemberGameProfile(regRecord, member) {
  const gameSet = new Set();
  const usernames = {};

  if (regRecord) {
    if (Array.isArray(regRecord.games)) {
      for (const gId of regRecord.games) {
        if (gamesConfig.getGameById(gId)) {
          gameSet.add(gId);
        }
      }
    }

    if (regRecord.gameUsernames && typeof regRecord.gameUsernames === 'object') {
      for (const [gId, uname] of Object.entries(regRecord.gameUsernames)) {
        if (gamesConfig.getGameById(gId) && uname) {
          gameSet.add(gId);
          usernames[gId] = String(uname).trim();
        }
      }
    }

    // Eski kayıt desteği (yalnızca robloxUsername/robloxId saklanan kayıtlar)
    if (regRecord.robloxUsername || regRecord.robloxId) {
      gameSet.add('roblox');
      if (!usernames.roblox && regRecord.robloxUsername) {
        usernames.roblox = regRecord.robloxUsername;
      }
    }
  }

  // Sunucu rollerinden oyun rollerini tespit et (kayıtta eksikse tamamlar)
  const roleBadges = [];
  if (member && member.roles && member.roles.cache) {
    for (const game of gamesConfig.getEnabledGames()) {
      if (game.roleId && member.roles.cache.has(game.roleId)) {
        gameSet.add(game.id);
        roleBadges.push(`<@&${game.roleId}>`);
      }
    }
  }

  const orderedGames = gamesConfig.normalizeGameList(Array.from(gameSet));
  return {
    games: orderedGames,
    usernames,
    roleBadges,
    robloxId: regRecord?.robloxId || null,
    robloxProfileUrl:
      regRecord?.robloxProfileUrl ||
      (regRecord?.robloxId ? `https://www.roblox.com/users/${regRecord.robloxId}/profile` : null),
    realName: regRecord?.realName || null,
  };
}

/**
 * Düzenli, bol emojili /profilim Embed kartını üretir.
 */
function buildProfileEmbed({ targetUser, targetMember, guild, profile, lang = 'tr' }) {
  const isEn = lang === 'en';
  const avatarUrl =
    typeof targetUser.displayAvatarURL === 'function'
      ? targetUser.displayAvatarURL({ size: 256, dynamic: true })
      : null;
  const guildIcon =
    guild && typeof guild.iconURL === 'function'
      ? guild.iconURL({ size: 128, dynamic: true })
      : null;

  const displayName = targetMember?.displayName || targetUser.username;
  const gamesSummary =
    profile.games
      .map((gId) => {
        const g = gamesConfig.getGameById(gId);
        return g ? `${g.emoji} **${g.name[lang]}**` : gId;
      })
      .join('  •  ') || (isEn ? '*None*' : '*Yok*');

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.PRIMARY || 0x0099FF)
    .setAuthor({
      name: `${displayName} • ${isEn ? 'Player Profile' : 'Oyuncu Kartı'}`,
      iconURL: avatarUrl || undefined,
    })
    .setTitle(
      isEn
        ? '🎮✨ PLAYER PROFILE & FRIEND CARD ✨🎮'
        : '🎮✨ OYUNCU PROFİLİ & ARKADAŞ KARTI ✨🎮'
    )
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 **${isEn ? 'Member' : 'Üye'}:** <@${targetUser.id}>\n` +
      (profile.realName
        ? `🪪 **${isEn ? 'Name / Nickname' : 'İsim / Takma Ad'}:** \`${profile.realName}\`\n`
        : '') +
      `🕹️ **${isEn ? 'Played Games' : 'Oynadığı Oyunlar'}:** ${gamesSummary}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setFooter({
      text: isEn
        ? `🤝 Copy the usernames above to send a friend request! • ${config.BRAND_NAME}`
        : `🤝 Arkadaş eklemek için yukarıdaki kullanıcı adlarını kopyalayabilirsiniz! • ${config.BRAND_NAME}`,
      iconURL: guildIcon || undefined,
    })
    .setTimestamp();

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  for (const gameId of profile.games) {
    const game = gamesConfig.getGameById(gameId);
    if (!game) continue;

    const uname = profile.usernames[gameId];
    const displayUsername = uname
      ? `\`${uname}\``
      : isEn
      ? '*Not specified*'
      : '*Belirtilmemiş*';

    if (gameId === 'roblox') {
      const linkLine = profile.robloxProfileUrl
        ? `\n🔗 **${isEn ? 'Profile Link' : 'Profil Linki'}:** [${isEn ? 'Open Roblox Profile' : 'Roblox Profilini Aç'} ↗️](${profile.robloxProfileUrl})`
        : '';
      embed.addFields({
        name: `🎮 ━━ ROBLOX ━━`,
        value: `🏷️ **${isEn ? 'Username' : 'Kullanıcı Adı'}:** ${displayUsername}${linkLine}`,
        inline: false,
      });
    } else if (gameId === 'cs2') {
      embed.addFields({
        name: `💣 ━━ CS2 (Counter-Strike 2) ━━`,
        value: `🎯 **${isEn ? 'Username / Code' : 'Kullanıcı Adı / Kod'}:** ${displayUsername}`,
        inline: false,
      });
    } else if (gameId === 'zula') {
      embed.addFields({
        name: `🔫 ━━ ZULA ━━`,
        value: `🪖 **${isEn ? 'Username' : 'Kullanıcı Adı'}:** ${displayUsername}`,
        inline: false,
      });
    } else if (gameId === 'minecraft') {
      embed.addFields({
        name: `⛏️ ━━ MINECRAFT ━━`,
        value: `🧱 **${isEn ? 'Username' : 'Kullanıcı Adı'}:** ${displayUsername}`,
        inline: false,
      });
    }
  }

  if (profile.roleBadges.length > 0) {
    embed.addFields({
      name: isEn ? '🏅 ━━ GAME ROLES ━━' : '🏅 ━━ OYUN ROLLERİ ━━',
      value: profile.roleBadges.join('  '),
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profilim')
    .setDescription('Oynadığın oyunları ve kullanıcı adlarını arkadaş eklemeleri için kanalda gösterir.')
    .setDescriptionLocalizations({
      'en-US': 'Shows your played games and usernames in chat so members can add you as a friend.',
    })
    .addUserOption((option) =>
      option
        .setName('kullanici')
        .setDescription('Profilini görüntülemek istediğin üye (Boş bırakırsan kendi profilin gösterilir)')
        .setDescriptionLocalizations({
          'en-US': 'Optional member whose game profile you want to view (defaults to you)',
        })
        .setRequired(false)
    ),

  resolveMemberGameProfile,
  buildProfileEmbed,

  async execute(interaction) {
    const lang = resolveLang(interaction);
    const isEn = lang === 'en';

    const optionUser = interaction.options?.getUser?.('kullanici') || null;
    const targetUser = optionUser || interaction.user;
    const isSelf = String(targetUser.id) === String(interaction.user.id);

    if (targetUser.bot) {
      return interaction.reply({
        content: isEn
          ? '🤖 Bot accounts do not have a game profile!'
          : '🤖 Bot hesaplarının oyuncu profili bulunmaz!',
        ephemeral: true,
      });
    }

    const targetMember =
      interaction.guild && interaction.guild.members
        ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
        : null;

    const regRecord = database.getRegistrationByDiscordId(targetUser.id);
    const profile = resolveMemberGameProfile(regRecord, targetMember || (isSelf ? interaction.member : null));

    const hasAnyData = Boolean(regRecord) || profile.games.length > 0;
    if (!hasAnyData) {
      return interaction.reply({
        content: isSelf
          ? isEn
            ? `⚠️ You don't have a registered game profile yet! Please register in <#${config.CHANNELS.REGISTER}> first.`
            : `⚠️ Henüz kayıtlı bir oyuncu profilin bulunmuyor! Kayıt olmak için <#${config.CHANNELS.REGISTER}> kanalından **Kayıt Ol** butonunu kullanabilirsin.`
          : isEn
          ? `ℹ️ <@${targetUser.id}> does not have a registered game profile yet.`
          : `ℹ️ <@${targetUser.id}> kullanıcısı henüz sunucuda oyuncu kaydını tamamlamamış.`,
        ephemeral: true,
      });
    }

    const embed = buildProfileEmbed({
      targetUser,
      targetMember: targetMember || (isSelf ? interaction.member : null),
      guild: interaction.guild,
      profile,
      lang,
    });

    // Diğer sunucu üyelerinin görebilmesi ve arkadaş ekleyebilmesi için herkese açık (public) gönderilir
    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
      ephemeral: false,
    });
  },
};
