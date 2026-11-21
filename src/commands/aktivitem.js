const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../../config');
const activityConfig = require('../../activity.config');
const database = require('../utils/database');
const activityTracker = require('../utils/activityTracker');
const { resolveLang } = require('../utils/i18n');
const { escapeEmbedText, neutralizeMentions, sanitizeTextInput } = require('../utils/inputSanitizer');

// Kullanıcı başına /aktivitem bekleme süresi haritası (Map<userId, timestamp>)
const activityCooldowns = new Map();

/**
 * Testler için /aktivitem bekleme süresi önbelleğini sıfırlar.
 */
function resetActivityCooldowns() {
  activityCooldowns.clear();
}

/**
 * Saniye cinsinden süreyi TR/EN okunabilir biçime çevirir ("5 sa 12 dk" / "5h 12m" / "<1 dk").
 */
function formatDuration(seconds, lang = 'tr') {
  const isEn = lang === 'en';
  const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
  if (totalSec < 60) {
    return isEn ? '<1m' : '<1 dk';
  }

  const totalMinutes = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return isEn ? `${minutes}m` : `${minutes} dk`;
  }
  if (minutes === 0) {
    return isEn ? `${hours}h` : `${hours} sa`;
  }
  return isEn ? `${hours}h ${minutes}m` : `${hours} sa ${minutes} dk`;
}

/**
 * 8 blokluk oransal çubuk ve yüzde üretir (örn: "▰▰▰▰▱▱▱▱ %50").
 */
function buildProgressBar(ratio, width = 8) {
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const filled = Math.max(0, Math.min(width, Math.round(safeRatio * width)));
  const empty = width - filled;
  const pct = Math.round(safeRatio * 100);
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)} %${pct}`;
}

/**
 * Europe/Istanbul saat dilimine göre bir sonraki ayın 1'i 00:00:00 anının Unix zaman damgasını (saniye) döndürür.
 * Not: Türkiye 2016'dan beri kalıcı UTC+3 saat dilimindedir.
 */
function getNextIstanbulMonthResetUnix(nowDate = new Date()) {
  const currentMonthStr = database.getCurrentIstanbulMonth(nowDate);
  const [yStr, mStr] = currentMonthStr.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1..12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthZeroIdx = month === 12 ? 0 : month; // JS Date.UTC ayı 0..11
  // İstanbul 00:00:00 = UTC önceki gün 21:00:00 (UTC -3 saat)
  const utcMs = Date.UTC(nextYear, nextMonthZeroIdx, 1, -3, 0, 0);
  return Math.floor(utcMs / 1000);
}

/**
 * Teşhis kod bloğu için ham Discord etkinlik alanlarını güvenli ve kısa metne dönüştürür.
 */
function sanitizeDiagnosticField(val, maxLen = 100) {
  if (val === null || val === undefined || val === '') return '(boş)';
  const clean = neutralizeMentions(sanitizeTextInput(String(val)))
    .replace(/```/g, "'''")
    .replace(/`/g, "'");
  if (!clean) return '(boş)';
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

/**
 * /aktivitem herkese açık özet embed ve buton yükünü oluşturur.
 */
function buildActivitySummaryPayload({
  user,
  member,
  lang = 'tr',
  tracker = activityTracker,
  db = database,
  nowDate = new Date(),
}) {
  const isEn = lang === 'en';
  const userId = String(user.id);
  const prefs = db.getActivityPrefs(userId);
  const displayName = member?.displayName || user.globalName || user.username || 'Oyuncu';
  const safeName = escapeEmbedText(displayName, 64);
  const nextResetUnix = getNextIstanbulMonthResetUnix(nowDate);

  const resetLine = isEn
    ? `📅 Durations reset every month • Next reset: <t:${nextResetUnix}:D>`
    : `📅 Süreler her ay sıfırlanır • Sıradaki sıfırlama: <t:${nextResetUnix}:D>`;

  const avatarUrl =
    typeof user?.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 256 }) : null;

  const embed = new EmbedBuilder()
    .setTitle(isEn ? '🎮✨ Activity Summary • This Month' : '🎮✨ Aktivite Özeti • Bu Ay')
    .setColor(config.COLORS.PURPLE || config.COLORS.PRIMARY)
    .setFooter({ text: `${config.BRAND_NAME} • /aktivitem` });

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  // 1. Durum: Etkinlik takibi kapalı
  if (!prefs.tracking) {
    const desc = [
      `👤 **${safeName}**`,
      '━━━━━━━━━━━━━━━━━━━━',
      isEn
        ? '🔒 You have turned off activity tracking; game roles, voice transfer, and playtime counting are disabled.'
        : '🔒 Etkinlik takibini kapattın; roller, aktarma ve süre sayımı çalışmıyor.',
      '━━━━━━━━━━━━━━━━━━━━',
      resetLine,
    ].join('\n');

    embed.setDescription(desc.slice(0, 4096));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('act_enable_track')
        .setLabel(isEn ? '✅ Enable Tracking' : '✅ Takibi Aç')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('act_settings')
        .setLabel(isEn ? '⚙️ My Settings' : '⚙️ Ayarlarım')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [] },
    };
  }

  // 2. Durum: Takip açık -> bu ayın kayıtlı sürelerini canlı oturumla birleştir
  const stats = db.getUserActivityStats(userId);
  const liveInfo = tracker.getLivePlayingInfo(userId);

  const combinedMap = { ...stats.games };
  if (liveInfo && liveInfo.gameId && liveInfo.unsavedSec > 0) {
    combinedMap[liveInfo.gameId] = (Number(combinedMap[liveInfo.gameId]) || 0) + liveInfo.unsavedSec;
  }

  const entries = Object.entries(combinedMap)
    .map(([gameId, sec]) => ({ gameId, seconds: Math.floor(Number(sec) || 0) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const totalSec = entries.reduce((sum, item) => sum + item.seconds, 0);
  const topEntries = entries.slice(0, 10);

  const lines = [`👤 **${safeName}**`, '━━━━━━━━━━━━━━━━━━━━'];

  if (topEntries.length === 0) {
    lines.push(
      isEn
        ? "You don't have any recorded playtime this month yet. Play a game and check back later 🎮"
        : 'Bu ay henüz kaydedilmiş oyun süren yok. Oyun oynayıp bir süre sonra tekrar bak 🎮'
    );
  } else {
    lines.push(isEn ? '🕹️ **Games Played**' : '🕹️ **Oynadığın Oyunlar**');
    for (const item of topEntries) {
      const info = activityConfig.getGameDisplayInfo(item.gameId, lang);
      const ratio = totalSec > 0 ? item.seconds / totalSec : 0;
      lines.push(
        `${info.emoji} **${info.name}** — ⏱️ ${formatDuration(item.seconds, lang)}  ${buildProgressBar(ratio)}`
      );
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(
      isEn
        ? `⏳ **Total:** ${formatDuration(totalSec, lang)}`
        : `⏳ **Toplam:** ${formatDuration(totalSec, lang)}`
    );
  }

  if (liveInfo && liveInfo.gameId) {
    const liveDisplay = activityConfig.getGameDisplayInfo(liveInfo.gameId, lang);
    const liveDur = formatDuration(liveInfo.sessionElapsedSec, lang);
    lines.push(
      isEn
        ? `🟢 **Currently playing:** ${liveDisplay.emoji} **${liveDisplay.name}** (${liveDur})`
        : `🟢 **Şu an oynuyor:** ${liveDisplay.emoji} **${liveDisplay.name}** (${liveDur})`
    );
  }

  lines.push(resetLine);
  embed.setDescription(lines.join('\n').slice(0, 4096));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('act_settings')
      .setLabel(isEn ? '⚙️ My Settings' : '⚙️ Ayarlarım')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
}

/**
 * Ephemeral "⚙️ Ayarlarım / My Settings" panelini basan kişinin kendi tercihlerine göre oluşturur.
 */
function buildSettingsPanelPayload(userId, lang = 'tr', noticeText = null, db = database) {
  const isEn = lang === 'en';
  const uid = String(userId);
  const prefs = db.getActivityPrefs(uid);

  const infoText = isEn
    ? '⚙️ **Game Activity Settings**\n' +
      'The bot reads your Discord game activity to assign game activity roles, count your monthly playtime, and transfer you to the game\'s voice channel.\n' +
      'ℹ️ *If Discord Settings > Activity Privacy is turned off, the bot cannot see anything.*'
    : '⚙️ **Oyun Etkinliği Ayarların**\n' +
      'Bot, Discord\'daki oyun etkinliğini okuyarak oyun rollerini verir, süreni sayar ve oyunun ses kanalına aktarır.\n' +
      'ℹ️ *Discord\'da Ayarlar > Etkinlik Gizliliği kapalıysa bot hiçbir şey göremez.*';

  const content = noticeText ? `${infoText}\n\n${noticeText}` : infoText;

  const trackBtn = new ButtonBuilder()
    .setCustomId(`act_toggle_track:${uid}`)
    .setLabel(
      isEn
        ? `Activity Tracking: ${prefs.tracking ? '✅ On' : '❌ Off'}`
        : `Etkinlik Takibi: ${prefs.tracking ? '✅ Açık' : '❌ Kapalı'}`
    )
    .setStyle(prefs.tracking ? ButtonStyle.Success : ButtonStyle.Danger);

  const moveBtn = new ButtonBuilder()
    .setCustomId(`act_toggle_move:${uid}`)
    .setLabel(
      isEn
        ? `Auto Voice Transfer: ${prefs.autoMove ? '✅ On' : '❌ Off'}`
        : `Otomatik Ses Aktarma: ${prefs.autoMove ? '✅ Açık' : '❌ Kapalı'}`
    )
    .setStyle(prefs.autoMove && prefs.tracking ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(!prefs.tracking);

  const diagBtn = new ButtonBuilder()
    .setCustomId(`act_diag:${uid}`)
    .setLabel(isEn ? '🔍 Activity Seen by Bot' : '🔍 Botun Gördüğü Etkinlik')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(trackBtn, moveBtn, diagBtn);

  return {
    content: content.slice(0, 2000),
    components: [row],
    allowedMentions: { parse: [] },
  };
}

/**
 * Ephemeral teşhis çıktısını (hiçbir veri saklamadan) üretir.
 */
function buildDiagnosticPayload({ presence, lang = 'tr', tracker = activityTracker }) {
  const isEn = lang === 'en';
  const presenceAvailable = tracker.isPresenceIntentAvailable();

  if (!presenceAvailable) {
    return {
      content: isEn
        ? '⚠️ **Diagnostic:** Discord Presence Intent is currently disabled on the bot, so the bot cannot see any game activity.'
        : '⚠️ **Teşhis:** Botta Discord Presence Intent şu an kapalı olduğundan bot hiçbir oyun etkinliğini göremiyor.',
      allowedMentions: { parse: [] },
    };
  }

  const items = activityTracker.diagnosePresence(presence, activityConfig, tracker.disabledGameIds);

  if (items.length === 0) {
    const emptyMsg = isEn
      ? '🔍 **Activity Seen by Bot**\n' +
        'The bot currently sees **no Playing activity** for your account.\n\n' +
        '**Possible reasons:**\n' +
        '• Discord **Settings > Activity Privacy** is turned off\n' +
        '• The game is not recognized by the Discord desktop app *(games played on mobile are not detected)*\n' +
        '• Presence Intent is disabled or Discord has not pushed your activity yet'
      : '🔍 **Botun Gördüğü Etkinlik**\n' +
        'Bot şu an hesabında **hiçbir oyun (Playing) etkinliği görmüyor**.\n\n' +
        '**Olası nedenler:**\n' +
        '• Discord **Ayarlar > Etkinlik Gizliliği** kapalı olabilir\n' +
        '• Oyun Discord masaüstü uygulamasında tanınmıyor olabilir *(telefonda oynanan oyunlar algılanmaz)*\n' +
        '• Presence Intent kapalı olabilir veya Discord henüz durumu iletmemiş olabilir';

    return {
      content: emptyMsg.slice(0, 2000),
      allowedMentions: { parse: [] },
    };
  }

  const blocks = items.slice(0, 5).map((item, idx) => {
    const rawLines = [
      `name: ${sanitizeDiagnosticField(item.raw.name, 90)}`,
      `applicationId: ${sanitizeDiagnosticField(item.raw.applicationId, 40)}`,
      `details: ${sanitizeDiagnosticField(item.raw.details, 100)}`,
      `state: ${sanitizeDiagnosticField(item.raw.state, 100)}`,
      `assets.largeText: ${sanitizeDiagnosticField(item.raw.largeText, 100)}`,
    ].join('\n');

    let statusLine = '';
    if (item.status === 'matched' && item.game) {
      statusLine = isEn
        ? `✅ **Result:** Matched ➜ ${item.game.emoji} **${item.game.name}**`
        : `✅ **Sonuç:** Eşleşti ➜ ${item.game.emoji} **${item.game.name}**`;
    } else if (item.status === 'roblox_unknown') {
      statusLine = isEn
        ? '🧱 **Result:** **Roblox (unknown game)** ➜ OTHER GAMES channel'
        : '🧱 **Sonuç:** **Roblox (oyun bilinmiyor)** ➜ OTHER GAMES kanalı';
    } else if (item.status === 'ignored') {
      statusLine = isEn
        ? '⏭️ **Result:** Ignored (non-game app)'
        : '⏭️ **Sonuç:** Yoksayıldı (oyun olmayan uygulama)';
    } else {
      statusLine = isEn
        ? '❓ **Result:** No match.\n💡 *If the game\'s name doesn\'t appear here, Discord does not recognize the game.*'
        : '❓ **Sonuç:** Eşleşmedi.\n💡 *Oyunun adı burada görünmüyorsa Discord oyunu tanımıyor demektir.*';
    }

    return `**#${idx + 1}**\n\`\`\`text\n${rawLines}\n\`\`\`\n${statusLine}`;
  });

  const header = isEn
    ? '🔍 **Activity Seen by Bot** *(nothing is stored)*\n\n'
    : '🔍 **Botun Gördüğü Etkinlik** *(hiçbir veri saklanmaz)*\n\n';

  return {
    content: `${header}${blocks.join('\n\n')}`.slice(0, 1980),
    allowedMentions: { parse: [] },
  };
}

/**
 * /aktivitem ve ⚙️ Ayarlarım buton etkileşimlerini yönetir.
 */
async function handleActivityButton(interaction, { tracker = activityTracker, db = database } = {}) {
  const cid = String(interaction.customId || '');
  const lang = resolveLang(interaction);
  const isEn = lang === 'en';
  const actorId = String(interaction.user.id);

  // 1. "⚙️ Ayarlarım" — herkes basabilir, BASAN kişinin kendi ayarlarını açar
  if (cid === 'act_settings') {
    const payload = buildSettingsPanelPayload(actorId, lang, null, db);
    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  }

  // 2. Kapalı durumda gösterilen "✅ Takibi Aç" — basan kişinin kendi takibini açar
  if (cid === 'act_enable_track') {
    db.setActivityPrefs(actorId, { tracking: true });
    tracker.enableTrackingForUser(actorId, interaction.member);
    const notice = isEn
      ? '✅ **Activity tracking has been enabled!**'
      : '✅ **Etkinlik takibi yeniden açıldı!**';
    const payload = buildSettingsPanelPayload(actorId, lang, notice, db);
    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  }

  // 3. Sahip doğrulamalı ayar butonları: act_toggle_track:<uid>, act_toggle_move:<uid>, act_diag:<uid>
  const parts = cid.split(':');
  const action = parts[0];
  const ownerId = parts[1];

  if (parts.length !== 2 || !ownerId) {
    return interaction.reply({
      content: isEn ? '⚠️ This menu has expired.' : '⚠️ Bu menü eskidi.',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  if (actorId !== ownerId) {
    return interaction.reply({
      content: isEn ? '❌ This button is not for you.' : '❌ Bu buton sana ait değil.',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  if (action === 'act_toggle_track') {
    const cur = db.getActivityPrefs(actorId);
    const nextTracking = !cur.tracking;
    db.setActivityPrefs(actorId, { tracking: nextTracking });

    let notice;
    if (!nextTracking) {
      await tracker.disableTrackingForUser(actorId, interaction.member);
      notice = isEn
        ? '🛑 **Activity tracking turned off.** Your game activity roles were removed, pending voice transfers were cancelled, and your playtime for this month was deleted.'
        : '🛑 **Etkinlik takibi kapatıldı.** Oyun aktiflik rollerin alındı, bekleyen ses aktarımı iptal edildi ve bu ayki sürelerin silindi.';
    } else {
      tracker.enableTrackingForUser(actorId, interaction.member);
      notice = isEn
        ? '✅ **Activity tracking turned on.**'
        : '✅ **Etkinlik takibi açıldı.**';
    }

    const payload = buildSettingsPanelPayload(actorId, lang, notice, db);
    return interaction.update(payload);
  }

  if (action === 'act_toggle_move') {
    const cur = db.getActivityPrefs(actorId);
    if (!cur.tracking) {
      const payload = buildSettingsPanelPayload(actorId, lang, null, db);
      return interaction.update(payload);
    }

    const nextAutoMove = !cur.autoMove;
    db.setActivityPrefs(actorId, { autoMove: nextAutoMove });

    if (!nextAutoMove) {
      tracker.cancelActiveCountdown(actorId, { consumeToken: true });
    }

    const notice = nextAutoMove
      ? isEn
        ? '🔊 **Auto voice transfer turned on.**'
        : '🔊 **Otomatik ses aktarma açıldı.**'
      : isEn
        ? '🔇 **Auto voice transfer turned off.** You will no longer be moved automatically.'
        : '🔇 **Otomatik ses aktarma kapatıldı.** Artık ses kanallarına otomatik aktarılmayacaksın.';

    const payload = buildSettingsPanelPayload(actorId, lang, notice, db);
    return interaction.update(payload);
  }

  if (action === 'act_diag') {
    const presence =
      interaction.member?.presence ||
      interaction.guild?.presences?.cache?.get?.(actorId) ||
      null;
    const payload = buildDiagnosticPayload({ presence, lang, tracker });
    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: isEn ? '⚠️ This menu has expired.' : '⚠️ Bu menü eskidi.',
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aktivitem')
    .setNameLocalizations({
      'en-US': 'activity',
      'en-GB': 'activity',
    })
    .setDescription('Bu ay oynadığın oyunları ve sürelerini göster 🎮')
    .setDescriptionLocalizations({
      'en-US': 'Show the games you played this month and their durations 🎮',
      'en-GB': 'Show the games you played this month and their durations 🎮',
    }),

  formatDuration,
  buildProgressBar,
  getNextIstanbulMonthResetUnix,
  buildActivitySummaryPayload,
  buildSettingsPanelPayload,
  buildDiagnosticPayload,
  handleActivityButton,
  resetActivityCooldowns,

  async execute(interaction) {
    const lang = resolveLang(interaction);
    const isEn = lang === 'en';
    const userId = String(interaction.user.id);

    // Kullanıcı başına 30 sn bekleme süresi
    const cooldownSec = Number(activityConfig.TIMINGS?.PROFILE_COOLDOWN_SEC ?? 30);
    const cooldownMs = Math.max(0, cooldownSec) * 1000;
    const now = Date.now();
    const lastUsed = activityCooldowns.get(userId) || 0;

    if (cooldownMs > 0 && now - lastUsed < cooldownMs) {
      const remainingSec = Math.max(1, Math.ceil((cooldownMs - (now - lastUsed)) / 1000));
      return interaction.reply({
        content: isEn
          ? `Try again in ${remainingSec} sec ⏳`
          : `${remainingSec} sn sonra tekrar dene ⏳`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    activityCooldowns.set(userId, now);

    const payload = buildActivitySummaryPayload({
      user: interaction.user,
      member: interaction.member,
      lang,
    });

    return interaction.reply({
      ...payload,
      ephemeral: false,
    });
  },
};
