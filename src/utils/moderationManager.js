const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');
const { analyzeMessage } = require('./profanityFilter');

// Kullanıcıya DM spam'ini önlemek için bekleme süresi (aynı kişiye en fazla 15 sn'de bir DM)
const dmCooldowns = new Map();
const DM_COOLDOWN_MS = 15 * 1000;

/** Mesaj içeriğini kod bloğu içinde güvenle göstermek için temizler ve kısaltır */
function toCodeBlock(content, max = 1000) {
  const safe = String(content || '*(boş)*').replace(/`/g, "'");
  const trimmed = safe.length > max ? `${safe.slice(0, max)}…` : safe;
  return `\`\`\`\n${trimmed}\n\`\`\``;
}

/** Üyenin en yüksek 5 rolünü etiket olarak döndürür */
function getTopRoles(member) {
  if (!member) return '`Bilinmiyor`';
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .first(5);
  return roles.length > 0 ? roles.map((r) => `<@&${r.id}>`).join(' ') : '`Rol yok`';
}

/**
 * Kullanıcıya gönderilen temiz uyarı DM'i (Turuncu)
 */
function buildWarningDm(message, result, violationCount) {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Uyarı | Uygunsuz Dil Kullanımı')
    .setColor(config.COLORS.WARNING_ORANGE)
    .setDescription(
      `Merhaba <@${message.author.id}>,\n\n` +
      `**${message.guild.name}** sunucusunda yazdığın bir mesajda **uygunsuz ifade (küfür / argo)** tespit edildi.\n` +
      `Hepimiz için daha keyifli bir ortam sağlamak adına lütfen sohbet kurallarına dikkat et. 🙏`
    )
    .addFields(
      {
        name: '💬 Gönderdiğin Mesaj',
        value: toCodeBlock(message.content, 900),
        inline: false,
      },
      {
        name: '📍 Kanal',
        value: `<#${message.channel.id}>`,
        inline: true,
      },
      {
        name: '🕒 Zaman',
        value: `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`,
        inline: true,
      },
      {
        name: '📌 Hatırlatma',
        value:
          `> Bu kez yalnızca bir uyarı yapılmıştır. Tekrarlanması hâlinde yetkililer tarafından ` +
          `yaptırım uygulanabilir.\n> Toplam uyarı sayın: **${violationCount}**`,
        inline: false,
      }
    )
    .setFooter({ text: `Piyade Team • Otomatik Sohbet Koruma Sistemi` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Mesaja Git')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Link)
      .setURL(message.url)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Yetkililer için detaylı log kartı (Kırmızı)
 */
function buildLogMessage(message, result, violationCount, dmStatus) {
  const member = message.member;
  const author = message.author;

  const embed = new EmbedBuilder()
    .setTitle('🚨 Uygunsuz İçerik Tespit Edildi')
    .setColor(config.COLORS.DANGER)
    .setThumbnail(author.displayAvatarURL({ size: 256 }))
    .setDescription(
      `<@${author.id}> adlı kullanıcının mesajında **${result.category}** tespit edildi.\n` +
      `-# Mesaj silinmedi, yerinde duruyor. Kullanıcıya uyarı gönderildi.`
    )
    .addFields(
      {
        name: '👤 Kullanıcı',
        value: `<@${author.id}>\n\`${author.tag}\`\n\`${author.id}\``,
        inline: true,
      },
      {
        name: '📍 Kanal',
        value: `<#${message.channel.id}>\n\`#${message.channel.name}\``,
        inline: true,
      },
      {
        name: '🕒 Mesaj Zamanı',
        value: `<t:${Math.floor(message.createdTimestamp / 1000)}:F>\n(<t:${Math.floor(message.createdTimestamp / 1000)}:R>)`,
        inline: true,
      },
      {
        name: '⚠️ Kategori',
        value: `\`${result.category}\``,
        inline: true,
      },
      {
        name: '📊 Şiddet',
        value: `\`${result.severity}\``,
        inline: true,
      },
      {
        name: '🤖 Tespit Yöntemi',
        value: `\`${result.method}\``,
        inline: true,
      },
      {
        name: '🔎 Yakalanan İfadeler',
        value: result.matches && result.matches.length > 0
          ? result.matches.map((w) => `\`${w}\``).join(' • ')
          : '`Belirtilmedi (bağlamsal tespit)`',
        inline: false,
      },
      {
        name: '💬 Mesaj İçeriği',
        value: toCodeBlock(message.content, 1000),
        inline: false,
      }
    );

  if (result.reason) {
    embed.addFields({
      name: '🧠 Yapay Zeka Analizi',
      value: `> ${result.reason}`,
      inline: false,
    });
  }

  embed.addFields(
    {
      name: '📈 Kullanıcı Geçmişi',
      value: `Bu kullanıcının **${violationCount}.** ihlali`,
      inline: true,
    },
    {
      name: '📩 DM Durumu',
      value: dmStatus,
      inline: true,
    },
    {
      name: '🗑️ Mesaj Durumu',
      value: '`Silinmedi`',
      inline: true,
    },
    {
      name: '📅 Hesap Açılış',
      value: `<t:${Math.floor(author.createdTimestamp / 1000)}:D>`,
      inline: true,
    },
    {
      name: '📥 Sunucuya Katılış',
      value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : '`Bilinmiyor`',
      inline: true,
    },
    {
      name: '🎭 Üst Roller',
      value: getTopRoles(member),
      inline: false,
    }
  );

  embed
    .setFooter({ text: `Mesaj ID: ${message.id} • Kullanıcı ID: ${author.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Mesaja Git')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Link)
      .setURL(message.url)
  );

  return {
    content: `<@&${config.ROLES.MESSAGE_MODERATOR}> 🚨 **Uygunsuz içerik bildirimi!**`,
    embeds: [embed],
    components: [row],
    // Sadece Mesaj Denetimcisi rolü etiketlenir; kullanıcı vb. etiketler bildirim atmaz
    allowedMentions: { parse: [], roles: [config.ROLES.MESSAGE_MODERATOR] },
  };
}

/**
 * Bir mesajı inceler; uygunsuz içerik varsa kullanıcıya DM atar ve log kanalına detaylı kart gönderir.
 * Mesaj SİLİNMEZ.
 */
async function moderateMessage(message) {
  if (!message || !message.guild || !message.author || message.author.bot) return;
  if (message.channelId === config.CHANNELS.PROFANITY_LOG) return;

  const content = message.content;
  if (!content || content.trim().length === 0) return;

  // Komut mesajlarını (!temizle vb.) atla
  if (content.trim().startsWith('!')) return;

  const result = await analyzeMessage(content, message.author.id);
  if (!result) return;

  const violationCount = database.addProfanityViolation(message.author.id);

  // 1. Kullanıcıya DM (Turuncu uyarı)
  let dmStatus = '`✅ Gönderildi`';
  const lastDm = dmCooldowns.get(message.author.id) || 0;

  if (Date.now() - lastDm < DM_COOLDOWN_MS) {
    dmStatus = '`⏳ Atlandı (kısa sürede tekrar)`';
  } else {
    dmCooldowns.set(message.author.id, Date.now());
    try {
      await message.author.send(buildWarningDm(message, result, violationCount));
    } catch (err) {
      dmStatus = '`❌ Gönderilemedi (DM kapalı)`';
    }
  }

  // 2. Yetkili Log Kanalı (Kırmızı detaylı kart)
  const logChannel =
    message.guild.channels.cache.get(config.CHANNELS.PROFANITY_LOG) ||
    (await message.guild.channels.fetch(config.CHANNELS.PROFANITY_LOG).catch(() => null));

  if (!logChannel) {
    console.warn(`[KÜFÜR FİLTRESİ] Log kanalı (${config.CHANNELS.PROFANITY_LOG}) bulunamadı!`);
    return;
  }

  await logChannel
    .send(buildLogMessage(message, result, violationCount, dmStatus))
    .catch((err) => console.error('[KÜFÜR LOG HATASI]:', err.message));
}

module.exports = {
  moderateMessage,
};
