const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const activityConfig = require('../../activity.config');
const database = require('../utils/database');
const activityTracker = require('../utils/activityTracker');
const { resolveLang } = require('../utils/i18n');
const { escapeEmbedText, neutralizeMentions, sanitizeTextInput } = require('../utils/inputSanitizer');

const { TRANSFER_REASONS } = activityConfig;

// Kullanıcı başına /aktivitem bekleme süresi haritası (Map<userId, timestamp>)
const activityCooldowns = new Map();

/**
 * Testler için /aktivitem bekleme süresi önbelleğini sıfırlar.
 */
function resetActivityCooldowns() {
  activityCooldowns.clear();
}

/**
 * Üyenin "🛠️ Sistem Durumu" düğmesini görme/kullanma yetkisi SADECE Developer rolüne aittir.
 * Yönetmenlik, Administrator izni veya sunucu sahibi olmak yeterli değildir.
 */
function hasSystemStatusAuthority(member) {
  if (!member || !config.ROLES?.DEVELOPER) return false;
  return Boolean(member.roles?.cache?.has?.(config.ROLES.DEVELOPER));
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
 * 22 aktarma sebep kodunun her biri için sade TR/EN açıklama ve çözüm ipucu döndürür.
 */
function getReasonExplanation(reason, lang = 'tr') {
  const isEn = lang === 'en';
  const map = {
    [TRANSFER_REASONS.NO_PRESENCE_DATA]: {
      tr: 'Discord bu hesap için etkinlik bilgisi vermiyor.\n💡 **Çözüm:** Discord **Ayarlar > Etkinlik Gizliliği** bölümünden oynadığın oyunu paylaşmayı aç.',
      en: 'Discord is not providing activity data for this account.\n💡 **Fix:** Enable game activity sharing in Discord **Settings > Activity Privacy**.',
    },
    [TRANSFER_REASONS.NOT_PLAYING]: {
      tr: 'Şu anda aktif bir oyun (Playing) etkinliği görünmüyor.\n💡 **Çözüm:** Masaüstü Discord uygulamasında desteklenen bir oyunu aç.',
      en: 'No active game (Playing) activity was detected right now.\n💡 **Fix:** Launch a supported game on the Discord desktop app.',
    },
    [TRANSFER_REASONS.UNMATCHED_ACTIVITY]: {
      tr: 'Bir oyun oynuyorsun ancak sunucunun tanımlı oyun listesiyle eşleşmedi.\n💡 **Çözüm:** **🔍 Botun Gördüğü Etkinlik** düğmesiyle oyunun adını kontrol et.',
      en: 'You are playing a game, but it did not match the server\'s configured games.\n💡 **Fix:** Check the game name via **🔍 Activity Seen by Bot**.',
    },
    [TRANSFER_REASONS.ACTIVITY_IGNORED]: {
      tr: 'Görünen etkinlik oyun olmayan uygulamalar listesinde (Roblox Studio, VS Code, OBS vb.) olduğu için yoksayıldı.',
      en: 'The detected activity is in the ignored non-game applications list (Roblox Studio, VS Code, OBS, etc.).',
    },
    [TRANSFER_REASONS.TRACKING_OFF]: {
      tr: 'Etkinlik takibini kapattığın için aktarma yapılmadı.\n💡 **Çözüm:** **⚙️ Ayarlarım** panelinden Etkinlik Takibi\'ni açabilirsin.',
      en: 'Activity tracking is turned off for your account.\n💡 **Fix:** Turn on Activity Tracking in **⚙️ My Settings**.',
    },
    [TRANSFER_REASONS.AUTOMOVE_OFF]: {
      tr: 'Otomatik ses aktarmayı kapattığın için aktarma yapılmadı.\n💡 **Çözüm:** **⚙️ Ayarlarım** panelinden Otomatik Ses Aktarma\'yı açabilirsin.',
      en: 'Auto voice transfer is turned off for your account.\n💡 **Fix:** Turn on Auto Voice Transfer in **⚙️ My Settings**.',
    },
    [TRANSFER_REASONS.NOT_IN_VOICE]: {
      tr: 'Bir ses kanalında değildin.\n💡 **Çözüm:** Herhangi bir normal ses kanalına girersen bot seni oyunun kanalına aktarır.',
      en: 'You were not in a voice channel.\n💡 **Fix:** Join any regular voice channel and the bot will transfer you to the game\'s channel.',
    },
    [TRANSFER_REASONS.EXCLUDED_CHANNEL]: {
      tr: 'Bulunduğun ses kanalı (AFK, Sahne veya taşınmaz özel kanal) aktarmadan muaf tutuluyor.\n💡 **Çözüm:** Normal bir sohbet/oyun ses kanalına geç.',
      en: 'Your current voice channel (AFK, Stage, or excluded channel) is exempt from auto-transfer.\n💡 **Fix:** Switch to a regular voice channel.',
    },
    [TRANSFER_REASONS.ALREADY_IN_TARGET]: {
      tr: 'Zaten oynadığın oyunun hedef ses kanalındaydın (veya kendin geçtin).',
      en: 'You were already in the target voice channel for your game (or moved there yourself).',
    },
    [TRANSFER_REASONS.TOKEN_SPENT]: {
      tr: 'Bu oyun oturumundaki 1 kerelik aktarma hakkın zaten kullanıldı veya iptal edildi.\n💡 **Çözüm:** Aynı oturumda tekrar zorla taşınmazsın; başka bir oyuna geçtiğinde yeni hak verilir.',
      en: 'Your one-time transfer token for this game session was already used or cancelled.\n💡 **Fix:** You won\'t be moved again in the same session; switching games grants a new transfer.',
    },
    [TRANSFER_REASONS.TARGET_NOT_FOUND]: {
      tr: 'Oyunun hedef ses kanalı sunucuda bulunamadı veya ses kanalı değil.\n💡 **Çözüm:** Yetkililere haber ver.',
      en: 'The target voice channel for this game was not found on the server.\n💡 **Fix:** Please notify server staff.',
    },
    [TRANSFER_REASONS.TARGET_FULL]: {
      tr: 'Oyunun hedef ses kanalı (veya kanalları) tamamen dolu.\n💡 **Çözüm:** Kanalda yer açıldığında ses kanalını değiştirerek tekrar deneyebilirsin.',
      en: 'The target voice channel(s) for this game are currently full.\n💡 **Fix:** Try switching voice channels once a spot opens up.',
    },
    [TRANSFER_REASONS.NO_MOVE_PERMISSION]: {
      tr: 'Botun seni taşımak veya hedef ses kanalına bağlanmak için yetkisi yok.\n💡 **Çözüm:** Yetkililere haber ver (Üyeleri Taşı / Bağlan izni gerekli).',
      en: 'The bot lacks permission to move members or connect to the target voice channel.\n💡 **Fix:** Please notify server staff (Move Members / Connect permission required).',
    },
    [TRANSFER_REASONS.COMMAND_CHANNEL_UNAVAILABLE]: {
      tr: 'Bot, komut kanalına geri sayım mesajı atamadığı için güvenlik gereği aktarmadı.\n💡 **Çözüm:** Yetkililere haber ver.',
      en: 'The bot could not send the countdown message in the command channel, so it did not move you for safety.\n💡 **Fix:** Please notify server staff.',
    },
    [TRANSFER_REASONS.WAITING_CONFIRM]: {
      tr: 'Oyunun henüz 15 saniyelik doğrulama süresini doldurması bekleniyor.\n💡 **Çözüm:** Birkaç saniye içinde otomatik olarak geri sayım başlayacaktır.',
      en: 'Waiting for your game to complete the 15-second confirmation window.\n💡 **Fix:** The transfer countdown will start automatically in a few seconds.',
    },
    [TRANSFER_REASONS.COUNTDOWN_PENDING]: {
      tr: '10 saniyelik aktarma geri sayımı şu anda devam ediyor.',
      en: 'The 10-second transfer countdown is currently in progress.',
    },
    [TRANSFER_REASONS.MOVED]: {
      tr: 'Başarıyla oyunun ses kanalına aktarıldın! 🎮',
      en: 'You were successfully moved to the game\'s voice channel! 🎮',
    },
    [TRANSFER_REASONS.CANCELLED_BY_USER]: {
      tr: 'Geri sayım mesajındaki **❌ Aktarmayı İptal Et** düğmesine basarak aktarmayı kendin iptal ettin.',
      en: 'You cancelled the transfer yourself by pressing **❌ Cancel Transfer**.',
    },
    [TRANSFER_REASONS.LEFT_VOICE_DURING_COUNTDOWN]: {
      tr: 'Geri sayım sürerken ses kanalından çıktığın için aktarma durduruldu (hakkın korundu, tekrar sese girersen çalışır).',
      en: 'You left the voice channel during the countdown (your transfer token is preserved if you rejoin voice).',
    },
    [TRANSFER_REASONS.GAME_CHANGED_DURING_COUNTDOWN]: {
      tr: 'Geri sayım sürerken başka bir oyuna geçtiğin için eski aktarma iptal edildi.',
      en: 'You switched to a different game during the countdown, so the previous transfer was cancelled.',
    },
    [TRANSFER_REASONS.GAME_STOPPED]: {
      tr: 'Geri sayım tamamlanmadan önce oyunu kapattığın için aktarma iptal edildi.',
      en: 'You closed the game before the countdown finished, so the transfer was cancelled.',
    },
    [TRANSFER_REASONS.MOVE_FAILED]: {
      tr: 'Discord ses taşıma işlemi beklenmeyen bir hatayla başarısız oldu.\n💡 **Çözüm:** Ses kanalından çıkıp tekrar girmeyi dene.',
      en: 'The Discord voice move operation failed unexpectedly.\n💡 **Fix:** Try leaving and rejoining the voice channel.',
    },
    [TRANSFER_REASONS.RETURN_MOVED]: {
      tr: "Oyunu bıraktığın için Salon 1'e aktarıldın.",
      en: 'You were moved to Lounge 1 because you closed your game.',
    },
    [TRANSFER_REASONS.RETURN_SKIPPED_NOT_IN_VOICE]: {
      tr: 'Oyundan çıkarken bir ses kanalında değildin.',
      en: 'You were not in a voice channel when you closed your game.',
    },
    [TRANSFER_REASONS.RETURN_SKIPPED_NOT_GAME_CHANNEL]: {
      tr: 'Bir oyun ses kanalında değildin, bu yüzden seni taşımadım.',
      en: "You were not in a game voice channel, so I didn't move you.",
    },
    [TRANSFER_REASONS.RETURN_SKIPPED_OTHER_GAME_ACTIVE]: {
      tr: 'Başka bir oyun oynadığın için taşımadım.',
      en: "I didn't move you because you are playing another game.",
    },
    [TRANSFER_REASONS.RETURN_SKIPPED_OPTED_OUT]: {
      tr: 'Bu özelliği kapattığın için taşımadım.',
      en: "I didn't move you because you turned this feature off.",
    },
    [TRANSFER_REASONS.RETURN_SKIPPED_NO_PRESENCE]: {
      tr: 'Discord durumunu göremediğim için (görünmez olabilirsin) taşımadım.',
      en: "I didn't move you because I couldn't see your Discord status (you may be invisible).",
    },
    [TRANSFER_REASONS.RETURN_TARGET_NOT_FOUND]: {
      tr: "Salon 1 kanalına aktarım yapılamadı. Yetkililere haber ver.",
      en: 'Could not move you to Lounge 1. Please notify server staff.',
    },
    [TRANSFER_REASONS.RETURN_TARGET_FULL]: {
      tr: "Salon 1 kanalına aktarım yapılamadı. Yetkililere haber ver.",
      en: 'Could not move you to Lounge 1. Please notify server staff.',
    },
    [TRANSFER_REASONS.RETURN_NO_PERMISSION]: {
      tr: "Salon 1 kanalına aktarım yapılamadı. Yetkililere haber ver.",
      en: 'Could not move you to Lounge 1. Please notify server staff.',
    },
    [TRANSFER_REASONS.RETURN_FAILED]: {
      tr: "Salon 1 kanalına aktarım yapılamadı. Yetkililere haber ver.",
      en: 'Could not move you to Lounge 1. Please notify server staff.',
    },
  };

  const entry = map[reason];
  if (!entry) {
    return isEn ? `Reason code: \`${reason}\`` : `Sebep kodu: \`${reason}\``;
  }
  return isEn ? entry.en : entry.tr;
}

/**
 * Tetikleyici adını kullanıcı dilinde okunabilir metne çevirir.
 */
function formatTriggerLabel(trigger, lang = 'tr') {
  const isEn = lang === 'en';
  const labels = {
    'game-confirmed': isEn ? 'Game started / confirmed' : 'Oyun başladı / onaylandı',
    'game-ended': isEn ? 'Game ended' : 'Oyun sona erdi',
    'voice-join': isEn ? 'Joined a voice channel' : 'Ses kanalına girdi',
    'voice-switch': isEn ? 'Switched voice channel' : 'Ses kanalı değiştirdi',
    sweep: isEn ? 'Backup sweep (30s)' : 'Yedek tarama (30 sn)',
  };
  return labels[trigger] || String(trigger || '-');
}

/**
 * /aktivitem komutu ve GET /api/member/:id/activity uç noktası için ortak etkinlik özeti hesaplayıcısı.
 * Kayıtlı aylık süreleri ve varsa canlı oturumun kaydedilmemiş saniyesini (unsavedSec) birleştirir.
 */
function computeUserActivitySummary({
  userId,
  lang = 'tr',
  tracker = activityTracker,
  db = database,
  nowDate = new Date(),
}) {
  const uid = String(userId || '');
  const cleanLang = lang === 'en' ? 'en' : 'tr';
  const prefs =
    tracker && typeof tracker.getPrefs === 'function'
      ? tracker.getPrefs(uid)
      : db.getActivityPrefs(uid);
  const tracking = Boolean(prefs.tracking);
  const nextResetUnix = getNextIstanbulMonthResetUnix(nowDate);
  const nextResetAt = nextResetUnix * 1000;
  const stats = db.getUserActivityStats(uid);
  const month = stats.month || db.getCurrentIstanbulMonth(nowDate);

  if (!tracking) {
    return {
      userId: uid,
      month,
      tracking: false,
      games: [],
      totalSeconds: 0,
      live: null,
      nextResetAt,
      nextResetUnix,
    };
  }

  const liveInfo =
    tracker && typeof tracker.getLivePlayingInfo === 'function'
      ? tracker.getLivePlayingInfo(uid)
      : null;

  const combinedMap = { ...stats.games };
  if (liveInfo && liveInfo.gameId && liveInfo.unsavedSec > 0) {
    combinedMap[liveInfo.gameId] =
      (Number(combinedMap[liveInfo.gameId]) || 0) + liveInfo.unsavedSec;
  }

  const entries = Object.entries(combinedMap)
    .map(([gameId, sec]) => ({ gameId, seconds: Math.floor(Number(sec) || 0) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const totalSeconds = entries.reduce((sum, item) => sum + item.seconds, 0);
  const topEntries = entries.slice(0, 10).map((item) => {
    const info = activityConfig.getGameDisplayInfo(item.gameId, cleanLang);
    const ratio = totalSeconds > 0 ? item.seconds / totalSeconds : 0;
    const percent = totalSeconds > 0 ? Math.round(ratio * 100) : 0;
    return {
      id: item.gameId,
      name: info.name,
      emoji: info.emoji,
      family: info.family,
      seconds: item.seconds,
      ratio,
      percent,
      formattedDuration: formatDuration(item.seconds, cleanLang),
    };
  });

  let live = null;
  if (liveInfo && liveInfo.gameId) {
    const liveDisplay = activityConfig.getGameDisplayInfo(liveInfo.gameId, cleanLang);
    const sessionElapsedSec = Math.max(0, Math.floor(Number(liveInfo.sessionElapsedSec) || 0));
    live = {
      gameId: liveInfo.gameId,
      name: liveDisplay.name,
      emoji: liveDisplay.emoji,
      family: liveDisplay.family,
      sessionElapsedSec,
      formattedDuration: formatDuration(sessionElapsedSec, cleanLang),
    };
  }

  return {
    userId: uid,
    month,
    tracking: true,
    games: topEntries,
    totalSeconds,
    live,
    nextResetAt,
    nextResetUnix,
  };
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
  const summary = computeUserActivitySummary({ userId, lang, tracker, db, nowDate });
  const displayName = member?.displayName || user.globalName || user.username || 'Oyuncu';
  const safeName = escapeEmbedText(displayName, 64);
  const nextResetUnix = summary.nextResetUnix;

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
  if (!summary.tracking) {
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

  // 2. Durum: Takip açık -> ortak hesaplayıcıdan gelen oyun listesini ve canlı oturumu yazdır
  const topEntries = summary.games;
  const totalSec = summary.totalSeconds;

  const lines = [`👤 **${safeName}**`, '━━━━━━━━━━━━━━━━━━━━'];

  if (topEntries.length === 0) {
    lines.push(
      isEn
        ? "You don't have any recorded playtime this month yet. Play a game and check back later 🎮\n" +
          '💡 *If you are playing a game but no time is recorded, check **⚙️ My Settings > 🔍 Activity Seen by Bot** to see if the bot detects your game.*'
        : 'Bu ay henüz kaydedilmiş oyun süren yok. Oyun oynayıp bir süre sonra tekrar bak 🎮\n' +
          '💡 *Oyun oynuyorsan ama süre yazmıyorsa **⚙️ Ayarlarım > 🔍 Botun Gördüğü Etkinlik** ile botun oyunu görüp görmediğini kontrol et.*'
    );
  } else {
    lines.push(isEn ? '🕹️ **Games Played**' : '🕹️ **Oynadığın Oyunlar**');
    for (const item of topEntries) {
      lines.push(
        `${item.emoji} **${item.name}** — ⏱️ ${item.formattedDuration}  ${buildProgressBar(item.ratio)}`
      );
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(
      isEn
        ? `⏳ **Total:** ${formatDuration(totalSec, lang)}`
        : `⏳ **Toplam:** ${formatDuration(totalSec, lang)}`
    );
  }

  if (summary.live) {
    lines.push(
      isEn
        ? `🟢 **Currently playing:** ${summary.live.emoji} **${summary.live.name}** (${summary.live.formattedDuration})`
        : `🟢 **Şu an oynuyor:** ${summary.live.emoji} **${summary.live.name}** (${summary.live.formattedDuration})`
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
 * Ephemeral "⚙️ Ayarlarım / My Settings" panelini basan kişinin kendi tercihlerine ve yetkisine göre oluşturur.
 */
function buildSettingsPanelPayload(
  userId,
  lang = 'tr',
  noticeText = null,
  db = database,
  { member = null, guild = null } = {}
) {
  const isEn = lang === 'en';
  const uid = String(userId);
  const prefs = typeof db.getPrefs === 'function' ? db.getPrefs(uid) : db.getActivityPrefs(uid);

  const returnDisabled = !prefs.tracking || !prefs.autoMove;
  const returnDisabledHint = returnDisabled
    ? isEn
      ? '\n🔒 *"Return to Lounge 1 after game" is disabled while Activity Tracking or Auto Voice Transfer is turned off.*'
      : "\n🔒 *\"Oyun Bitince Salon 1'e Dön\" düğmesi, Etkinlik Takibi veya Otomatik Ses Aktarma kapalıyken devre dışıdır.*"
    : '';

  const infoText = isEn
    ? '⚙️ **Game Activity Settings**\n' +
      "The bot reads your Discord game activity to assign game activity roles, count your monthly playtime, and transfer you to the game's voice channel.\n" +
      "When you close your game your game role is removed, and if you're in a game voice channel you'll be moved to Lounge 1. You can turn this off below.\n" +
      '📱 Playing on mobile? Use the `/game` command.\n' +
      'ℹ️ *If Discord Settings > Activity Privacy is turned off, the bot cannot see anything.*' +
      returnDisabledHint
    : '⚙️ **Oyun Etkinliği Ayarların**\n' +
      "Bot, Discord'daki oyun etkinliğini okuyarak oyun rollerini verir, süreni sayar ve oyunun ses kanalına aktarır.\n" +
      "Oyunu kapattığında oyun rolün alınır; bir oyun ses kanalındaysan Salon 1'e aktarılırsın. İstemiyorsan aşağıdan kapatabilirsin.\n" +
      '📱 Mobilden oynuyorsan `/oyun` komutunu kullan.\n' +
      "ℹ️ *Discord'da Ayarlar > Etkinlik Gizliliği kapalıysa bot hiçbir şey göremez.*" +
      returnDisabledHint;

  const content = noticeText ? `${infoText}\n\n${noticeText}` : infoText;

  // Satır 1 (en çok 5 düğme): Etkinlik Takibi, Otomatik Ses Aktarma, Oyun Bitince Salon 1'e Dön
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

  const returnToLobbyOn = prefs.returnToLobby !== false;
  const returnBtn = new ButtonBuilder()
    .setCustomId(`act_ret:${uid}`)
    .setLabel(
      isEn
        ? `🔙 Return to Lounge 1 after game: ${returnToLobbyOn ? '✅ On' : '❌ Off'}`
        : `🔙 Oyun Bitince Salon 1'e Dön: ${returnToLobbyOn ? '✅ Açık' : '❌ Kapalı'}`
    )
    .setStyle(returnToLobbyOn && !returnDisabled ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(returnDisabled);

  const row1 = new ActionRowBuilder().addComponents(trackBtn, moveBtn, returnBtn);

  // Satır 2 (en çok 5 düğme): 🔍 Botun Gördüğü Etkinlik, 🧪 Neden aktarılmadım?, 🛠️ Sistem Durumu (YALNIZCA Developer)
  const diagBtn = new ButtonBuilder()
    .setCustomId(`act_diag:${uid}`)
    .setLabel(isEn ? '🔍 Activity Seen by Bot' : '🔍 Botun Gördüğü Etkinlik')
    .setStyle(ButtonStyle.Secondary);

  const whyBtn = new ButtonBuilder()
    .setCustomId(`act_why:${uid}`)
    .setLabel(isEn ? "🧪 Why wasn't I moved?" : '🧪 Neden aktarılmadım?')
    .setStyle(ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(diagBtn, whyBtn);

  if (hasSystemStatusAuthority(member)) {
    const sysBtn = new ButtonBuilder()
      .setCustomId(`act_sys:${uid}`)
      .setLabel(isEn ? '🛠️ System Status' : '🛠️ Sistem Durumu')
      .setStyle(ButtonStyle.Primary);
    row2.addComponents(sysBtn);
  }

  return {
    content: content.slice(0, 2000),
    components: [row1, row2],
    allowedMentions: { parse: [] },
  };
}

/**
 * Ephemeral "🧪 Son Karar / Last Decision" çıktısını oluşturur.
 */
function buildWhyNotMovedPayload({ userId, lang = 'tr', tracker = activityTracker }) {
  const isEn = lang === 'en';
  const decision = tracker.getLastDecision(userId);

  if (!decision) {
    return {
      content: isEn
        ? '🧪 **Last Decision**\n' +
          'No transfer or return evaluation in the last 30 minutes. Open a game and join a voice channel, then check back.'
        : '🧪 **Son Karar**\n' +
          'Son 30 dakikada bir aktarma veya dönüş değerlendirmesi yok. Oyunu aç ve bir ses kanalına gir, sonra tekrar bak.',
      allowedMentions: { parse: [] },
    };
  }

  const unixSec = Math.floor(decision.at / 1000);
  const triggerText = formatTriggerLabel(decision.trigger, lang);
  const explanation = getReasonExplanation(decision.reason, lang);

  const resultBadgeMap = {
    moved: isEn ? '✅ Moved' : '✅ Aktarıldı',
    pending: isEn ? '⏳ Pending / Countdown' : '⏳ Beklemede / Geri Sayımda',
    cancelled: isEn ? '❌ Cancelled' : '❌ İptal Edildi',
    skipped: isEn ? '⏭️ Not Moved' : '⏭️ Aktarılmadı',
  };
  const resultText = resultBadgeMap[decision.result] || decision.result;

  const lines = [
    isEn ? '🧪 **Last Decision (Your Latest Evaluation)**' : '🧪 **Son Karar (Son Değerlendirmen)**',
    isEn ? `• **Evaluated:** <t:${unixSec}:R>` : `• **Değerlendirme Zamanı:** <t:${unixSec}:R>`,
    isEn ? `• **Trigger:** ${triggerText}` : `• **Tetikleyici:** ${triggerText}`,
    isEn ? `• **Outcome:** ${resultText} (\`${decision.reason}\`)` : `• **Sonuç:** ${resultText} (\`${decision.reason}\`)`,
  ];

  if (decision.game) {
    lines.push(
      isEn
        ? `• **Detected Game:** ${sanitizeDiagnosticField(decision.game, 64)}`
        : `• **Algılanan Oyun:** ${sanitizeDiagnosticField(decision.game, 64)}`
    );
  }
  if (decision.fromChannelId || decision.toChannelId) {
    const fromStr = decision.fromChannelId ? `<#${decision.fromChannelId}>` : '-';
    const toStr = decision.toChannelId ? `<#${decision.toChannelId}>` : '-';
    lines.push(
      isEn
        ? `• **Voice Channel:** ${fromStr} ➜ ${toStr}`
        : `• **Ses Kanalı:** ${fromStr} ➜ ${toStr}`
    );
  }

  lines.push('', `📌 ${explanation}`);

  return {
    content: lines.join('\n').slice(0, 1980),
    allowedMentions: { parse: [] },
  };
}

/**
 * Sadece Developer rolündekilere özel "🛠️ Sistem Durumu / System Status" tanı çıktısını üretir.
 * Kullanıcı kimliği veya kullanıcıya özel oyun bilgisi İÇERMEZ.
 */
function buildSystemStatusPayload({ guild, client = null, lang = 'tr', tracker = activityTracker, db = database }) {
  const isEn = lang === 'en';
  const activeGuild = guild || tracker.guild || null;
  const activeClient = client || tracker.client || activeGuild?.client || null;

  // 1. Intent Kontrolleri
  const intentsBitfield = activeClient?.options?.intents;
  const hasBit = (bit) => {
    if (!intentsBitfield) return null;
    if (typeof intentsBitfield.has === 'function') return intentsBitfield.has(bit);
    if (Array.isArray(intentsBitfield)) return intentsBitfield.includes(bit);
    return null;
  };

  const presenceIntentBit = hasBit(GatewayIntentBits.GuildPresences);
  const membersIntentBit = hasBit(GatewayIntentBits.GuildMembers);
  const voiceIntentBit = hasBit(GatewayIntentBits.GuildVoiceStates);
  const presenceActive = tracker.isPresenceIntentAvailable() && presenceIntentBit !== false;

  const presenceStatusLine = presenceActive
    ? isEn
      ? '✅ **Presence Intent:** Bot is receiving presences (`GuildPresences` active)'
      : '✅ **Presence Intent:** Bot presence alıyor (`GuildPresences` aktif)'
    : isEn
      ? '❌ **Presence Intent:** Bot is running WITHOUT presences, this feature is disabled!\n⚠️ *Fix: Enable PRESENCE INTENT in Discord Developer Portal > Bot.*'
      : '❌ **Presence Intent:** Bot presence OLMADAN çalışıyor, bu özellik devre dışı!\n⚠️ *Çözüm: Discord Developer Portal > Bot sekmesinden PRESENCE INTENT\'i açın.*';

  const membersStatusLine =
    membersIntentBit === false
      ? isEn
        ? '⚠️ **Server Members Intent:** Disabled (enable in Developer Portal)'
        : '⚠️ **Server Members Intent:** Kapalı (Developer Portal\'dan açın)'
      : isEn
        ? '✅ **Server Members & Voice States Intents:** Active'
        : '✅ **Server Members & Voice States Intent:** Aktif';

  // 2. Bot İzinleri ve 4 Aktiflik Rolü Hiyerarşisi
  const botMember = activeGuild?.members?.me || null;
  const botHighestPos = botMember?.roles?.highest?.position ?? null;
  const hasManageRoles = !botMember?.permissions?.has || botMember.permissions.has(PermissionFlagsBits.ManageRoles);
  const hasMoveMembers = !botMember?.permissions?.has || botMember.permissions.has(PermissionFlagsBits.MoveMembers);

  const permLines = [];
  permLines.push(
    hasManageRoles
      ? isEn
        ? '✅ **Manage Roles:** Granted'
        : '✅ **Rolleri Yönet:** Var'
      : isEn
        ? '⚠️ **Manage Roles:** Missing! *(Grant Manage Roles to the bot)*'
        : '⚠️ **Rolleri Yönet:** Eksik! *(Bota Rolleri Yönet izni verin)*'
  );
  permLines.push(
    hasMoveMembers
      ? isEn
        ? '✅ **Move Members:** Granted'
        : '✅ **Üyeleri Taşı:** Var'
      : isEn
        ? '⚠️ **Move Members:** Missing! *(Grant Move Members to the bot)*'
        : '⚠️ **Üyeleri Taşı:** Eksik! *(Bota Üyeleri Taşı izni verin)*'
  );

  const roleLines = [];
  let manualReadyRoleCount = 0;
  const totalFamilyRoles = Object.keys(activityConfig.FAMILIES || {}).length;
  for (const [famKey, fam] of Object.entries(activityConfig.FAMILIES || {})) {
    const r = activeGuild?.roles?.cache?.get?.(fam.roleId) || null;
    if (!r) {
      roleLines.push(
        isEn
          ? `⚠️ **${fam.emoji} ${famKey}:** Role (<@&${fam.roleId}>) not found on server!`
          : `⚠️ **${fam.emoji} ${famKey}:** Rol (<@&${fam.roleId}>) sunucuda bulunamadı!`
      );
    } else if (botHighestPos !== null && typeof r.position === 'number' && botHighestPos <= r.position) {
      roleLines.push(
        isEn
          ? `⚠️ **${fam.emoji} ${famKey}:** <@&${fam.roleId}> is ABOVE the bot's role! *(Move bot role higher)*`
          : `⚠️ **${fam.emoji} ${famKey}:** <@&${fam.roleId}> botun rolünün ÜSTÜNDE! *(Bot rolünü yukarı taşıyın)*`
      );
    } else {
      manualReadyRoleCount += 1;
      roleLines.push(
        isEn
          ? `✅ **${fam.emoji} ${famKey}:** <@&${fam.roleId}> (Bot role is higher)`
          : `✅ **${fam.emoji} ${famKey}:** <@&${fam.roleId}> (Bot rolü üstte)`
      );
    }
  }

  // Mobil /oyun manuel rol durumu ve gece 00:00 temizliği bilgileri (tamamen kimliksiz)
  const manualCounts =
    typeof db.countManualActivityMarks === 'function'
      ? db.countManualActivityMarks()
      : { totalMarks: 0, totalUsers: 0 };
  const lastCleanup = tracker.lastMidnightCleanup || null;
  const lastCleanupStr = lastCleanup?.at
    ? `<t:${Math.floor(lastCleanup.at / 1000)}:R> (${isEn ? 'removed' : 'alınan'}:${lastCleanup.removed}, ${isEn ? 'failed' : 'hata'}:${lastCleanup.failed})`
    : isEn
      ? 'none yet'
      : 'henüz yok';
  const nextMidnightMs =
    typeof tracker.getNextMidnightCleanupAt === 'function'
      ? tracker.getNextMidnightCleanupAt()
      : activityConfig.getNextMidnightMsInTimeZone(Date.now(), activityConfig.MANUAL_TIMEZONE);
  const nextMidnightUnix = Math.floor(nextMidnightMs / 1000);
  const clearAllFlag = Boolean(
    tracker.config?.MANUAL_CLEAR_ALL_ACTIVITY_ROLES ?? activityConfig.MANUAL_CLEAR_ALL_ACTIVITY_ROLES
  );
  const manualRolesReadyPrefix = manualReadyRoleCount === totalFamilyRoles ? '✅' : '⚠️';
  const manualSummaryLine = isEn
    ? `${manualRolesReadyPrefix} **Mobile \`/game\`:** Roles ready \`${manualReadyRoleCount}/${totalFamilyRoles}\` • Active marks: \`${manualCounts.totalMarks}\` • ClearAll: \`${clearAllFlag ? 'ON' : 'OFF'}\`\n` +
      `🌙 **00:00 Cleanup:** Last: ${lastCleanupStr} • Next: <t:${nextMidnightUnix}:R>`
    : `${manualRolesReadyPrefix} **Mobil \`/oyun\`:** Hazır rol \`${manualReadyRoleCount}/${totalFamilyRoles}\` • Aktif manuel işaret: \`${manualCounts.totalMarks}\` • ClearAll: \`${clearAllFlag ? 'Açık' : 'Kapalı'}\`\n` +
      `🌙 **00:00 Temizliği:** Son: ${lastCleanupStr} • Sıradaki: <t:${nextMidnightUnix}:R>`;

  // 3. Komut Kanalı ve Oyun Ses Kanalları
  const cmdCh = activeGuild?.channels?.cache?.get?.(activityConfig.COMMAND_CHANNEL_ID) || null;
  let cmdView = Boolean(cmdCh);
  let cmdSend = Boolean(cmdCh);
  if (cmdCh && botMember && typeof cmdCh.permissionsFor === 'function') {
    const p = cmdCh.permissionsFor(botMember);
    if (p && typeof p.has === 'function') {
      cmdView = p.has(PermissionFlagsBits.ViewChannel);
      cmdSend = p.has(PermissionFlagsBits.SendMessages);
    }
  }
  const cmdLine =
    cmdCh && cmdView && cmdSend
      ? isEn
        ? `✅ **Command Channel:** <#${activityConfig.COMMAND_CHANNEL_ID}> (View + Send OK)`
        : `✅ **Komut Kanalı:** <#${activityConfig.COMMAND_CHANNEL_ID}> (Görüntüle + Mesaj Gönder OK)`
      : isEn
        ? `⚠️ **Command Channel:** <#${activityConfig.COMMAND_CHANNEL_ID}> missing or lacks View/Send permission!`
        : `⚠️ **Komut Kanalı:** <#${activityConfig.COMMAND_CHANNEL_ID}> yok veya Görüntüle/Mesaj Gönder izni eksik!`;

  const voiceProblemLines = [];
  let validVoiceGameCount = 0;
  const allEntries = [
    ...(activityConfig.GAMES || []),
    { id: 'roblox_unknown', name: 'OTHER GAMES', emoji: '🧱', voiceChannelIds: activityConfig.ROBLOX_UNKNOWN?.voiceChannelIds || [] },
  ];

  for (const entry of allEntries) {
    let entryOk = true;
    for (const chId of entry.voiceChannelIds || []) {
      const ch = activeGuild?.channels?.cache?.get?.(chId) || null;
      if (!ch || !activityConfig.isRegularVoiceChannel(ch)) {
        entryOk = false;
        voiceProblemLines.push(
          isEn
            ? `⚠️ **${entry.name}:** Channel \`${chId}\` missing or not a voice channel!`
            : `⚠️ **${entry.name}:** Kanal \`${chId}\` sunucuda yok veya ses kanalı değil!`
        );
        continue;
      }
      if (botMember && typeof ch.permissionsFor === 'function') {
        const p = ch.permissionsFor(botMember);
        if (p && typeof p.has === 'function') {
          if (!p.has(PermissionFlagsBits.ViewChannel) || !p.has(PermissionFlagsBits.Connect)) {
            entryOk = false;
            voiceProblemLines.push(
              isEn
                ? `⚠️ **${entry.name}:** Missing View/Connect permission in <#${chId}>!`
                : `⚠️ **${entry.name}:** <#${chId}> kanalında Görüntüle/Bağlan izni eksik!`
            );
          }
        }
      }
    }
    if (entryOk) validVoiceGameCount += 1;
  }

  const voiceSummaryLine =
    voiceProblemLines.length === 0
      ? isEn
        ? `✅ **Game Voice Channels + OTHER GAMES:** All ${allEntries.length}/${allEntries.length} configured & accessible`
        : `✅ **Oyun Ses Kanalları + OTHER GAMES:** ${allEntries.length}/${allEntries.length} kanalın tamamı mevcut ve erişilebilir`
      : voiceProblemLines.slice(0, 5).join('\n');

  // 3b. Oyun bitişi dönüş kanalı (Salon 1 - RETURN_CHANNEL_ID) doğrulaması
  const returnChannelId = tracker.config?.RETURN_CHANNEL_ID || activityConfig.RETURN_CHANNEL_ID;
  const retCh = returnChannelId ? activeGuild?.channels?.cache?.get?.(String(returnChannelId)) || null : null;
  let returnChannelLine;
  if (!returnChannelId || !retCh || !activityConfig.isRegularVoiceChannel(retCh)) {
    returnChannelLine = isEn
      ? `⚠️ **Return Channel (Lounge 1):** \`${returnChannelId || 'unset'}\` missing or not a voice channel!`
      : `⚠️ **Dönüş Kanalı (Salon 1):** \`${returnChannelId || 'tanımsız'}\` bulunamadı veya ses kanalı değil!`;
  } else {
    let retPermOk = true;
    if (botMember && typeof retCh.permissionsFor === 'function') {
      const p = retCh.permissionsFor(botMember);
      if (p && typeof p.has === 'function') {
        if (!p.has(PermissionFlagsBits.ViewChannel) || !p.has(PermissionFlagsBits.Connect)) {
          retPermOk = false;
        }
      }
    }
    const retLimit = Number(retCh.userLimit) || 0;
    const retCount = retCh.members?.size ?? 0;
    const retFull = retLimit > 0 && retCount >= retLimit;
    if (!retPermOk) {
      returnChannelLine = isEn
        ? `⚠️ **Return Channel (Lounge 1):** Missing View/Connect permission in <#${returnChannelId}>!`
        : `⚠️ **Dönüş Kanalı (Salon 1):** <#${returnChannelId}> kanalında Görüntüle/Bağlan izni eksik!`;
    } else if (retFull) {
      returnChannelLine = isEn
        ? `⚠️ **Return Channel (Lounge 1):** <#${returnChannelId}> is currently full (${retCount}/${retLimit})!`
        : `⚠️ **Dönüş Kanalı (Salon 1):** <#${returnChannelId}> şu an dolu (${retCount}/${retLimit})!`;
    } else {
      const limitLabel =
        retLimit > 0
          ? `${retCount}/${retLimit}`
          : isEn
            ? 'unlimited'
            : 'sınırsız';
      returnChannelLine = isEn
        ? `✅ **Return Channel (Lounge 1):** <#${returnChannelId}> (View + Connect OK, limit: ${limitLabel})`
        : `✅ **Dönüş Kanalı (Salon 1):** <#${returnChannelId}> (Görüntüle + Bağlan OK, limit: ${limitLabel})`;
    }
  }

  // 4. Aktif Oturum Sayısı ve Takibi Açık Üye Sayısı (Kimliksiz)
  let confirmedSessionCount = 0;
  for (const s of tracker.sessions.values()) {
    if (s.confirmed) confirmedSessionCount += 1;
  }

  const totalCachedHumanMembers = activeGuild?.members?.cache
    ? Array.from(activeGuild.members.cache.values()).filter((m) => !m.user?.bot).length
    : 0;
  const disabledTrackingCount = Object.values(db.data.activityPrefs || {}).filter(
    (p) => p && p.tracking === false
  ).length;
  const trackingOpenCount = Math.max(0, totalCachedHumanMembers - disabledTrackingCount);

  // 5. Zincir Sayaçları ve Kırık Halka Analizi
  const c = tracker.counters;
  const dbOk = db.lastSaveOk !== false;
  const reasonSummary = Object.entries(c.reasons || {})
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${code}:${count}`)
    .join(', ') || (isEn ? 'none yet' : 'henüz yok');

  const chainHints = [];
  if (!presenceActive) {
    chainHints.push(
      isEn
        ? '⚠️ **Broken Link:** Presence Intent is OFF. The bot cannot receive any presence events.'
        : '⚠️ **Kırık Halka:** Presence Intent KAPALI. Bot hiçbir oyun etkinliği alamaz.'
    );
  } else if (c.presenceReceived === 0) {
    chainHints.push(
      isEn
        ? '⚠️ **Notice:** `presenceUpdate: 0` — No member presence change has arrived from Discord since startup.'
        : '⚠️ **Bilgi:** `presenceUpdate: 0` — Bot açıldığından beri Discord\'dan henüz etkinlik değişimi gelmedi.'
    );
  } else if (c.presenceWithPlaying === 0) {
    chainHints.push(
      isEn
        ? `⚠️ **Broken Link:** \`presenceUpdate: ${c.presenceReceived}, Playing: 0\` — Events arrive, but none contain a Playing game (check Activity Privacy).`
        : `⚠️ **Kırık Halka:** \`presenceUpdate: ${c.presenceReceived}, Playing etkinliği: 0\` — Olaylar geliyor ama hiçbirinde "Oynuyor" verisi yok (Etkinlik Gizliliği kapalı olabilir).`
    );
  } else if (c.matchedGame === 0 && c.generalRoblox === 0) {
    chainHints.push(
      isEn
        ? `⚠️ **Broken Link:** \`Playing: ${c.presenceWithPlaying}, Matched/Roblox: 0\` — Games seen did not match any configured game.`
        : `⚠️ **Kırık Halka:** \`Playing: ${c.presenceWithPlaying}, Eşleşen/Roblox: 0\` — Görülen oyunların hiçbiri listedeki oyunlarla eşleşmedi.`
    );
  } else if (c.sessionConfirmed === 0) {
    chainHints.push(
      isEn
        ? '⚠️ **Notice:** Games matched, but none have completed the 15s confirmation window yet.'
        : '⚠️ **Bilgi:** Oyun eşleşti ancak henüz 15 saniyelik onay süresini tamamlayan oturum olmadı.'
    );
  }

  if (!dbOk) {
    chainHints.push(
      isEn
        ? `⚠️ **Database Error:** Last DB save failed (${db.lastSaveError || 'unknown'}). Check volume permissions!`
        : `⚠️ **Veritabanı Hatası:** Son DB kaydı başarısız (${db.lastSaveError || 'bilinmiyor'}). Disk/klasör yazma iznini kontrol edin!`
    );
  }

  const r = c.reasons || {};
  const returnSkipTotal =
    (r.RETURN_SKIPPED_NOT_IN_VOICE || 0) +
    (r.RETURN_SKIPPED_NOT_GAME_CHANNEL || 0) +
    (r.RETURN_SKIPPED_OTHER_GAME_ACTIVE || 0) +
    (r.RETURN_SKIPPED_OPTED_OUT || 0) +
    (r.RETURN_SKIPPED_NO_PRESENCE || 0);
  const returnErrTotal =
    (r.RETURN_TARGET_NOT_FOUND || 0) +
    (r.RETURN_TARGET_FULL || 0) +
    (r.RETURN_NO_PERMISSION || 0) +
    (r.RETURN_FAILED || 0);

  const lines = [
    isEn ? '🛠️ **Game Activity System Status**' : '🛠️ **Oyun Etkinliği Sistem Durumu**',
    presenceStatusLine,
    membersStatusLine,
    ...permLines,
    cmdLine,
    voiceSummaryLine,
    returnChannelLine,
    manualSummaryLine,
    ...roleLines,
    '━━━━━━━━━━━━━━━━━━━━',
    isEn
      ? `📊 **Active Sessions:** \`${confirmedSessionCount}\` • **Tracking Enabled Members:** \`${trackingOpenCount}\` (Disabled: \`${disabledTrackingCount}\`) • **Last DB Save:** ${dbOk ? '✅ OK' : '⚠️ Failed'}`
      : `📊 **Aktif Oturum:** \`${confirmedSessionCount}\` • **Takibi Açık Üye:** \`${trackingOpenCount}\` (Kapalı: \`${disabledTrackingCount}\`) • **Son DB Kaydı:** ${dbOk ? '✅ Başarılı' : '⚠️ Başarısız'}`,
    isEn
      ? `🔗 **Chain Counters (since startup):**\n` +
        `\`presence=${c.presenceReceived} | processed=${c.presenceProcessed} | playing=${c.presenceWithPlaying} | matched=${c.matchedGame} | roblox=${c.generalRoblox} | unmatched=${c.unmatchedActivity} | ignored=${c.ignoredActivity}\`\n` +
        `\`confirmed=${c.sessionConfirmed} | ended=${c.gamesEnded || 0} | roleAdd=${c.roleAdded} | roleRem=${c.rolesRemoved || 0} (err:${c.roleFailed}) | manual=+${c.manuelVerilen || 0}/-${c.manuelGeriAlinan || 0} | midnight=${c.geceTemizligiAlinan || 0}(err:${c.geceTemizligiBasarisiz || 0}) | checkpoints=${c.checkpointWritten} | dbSave=${c.dbSaveSuccess} (err:${c.dbSaveFailed}) | voiceEvents=${c.voiceChangesReceived} | memberFetch=${c.memberFetchCalls || 0} (skip:${c.memberFetchSkipped || 0}, err:${c.memberFetchErrors || 0}) | MOVED=${c.transfersMoved} | RETURN_MOVED=${r.RETURN_MOVED || 0} (skip:${returnSkipTotal}, err:${returnErrTotal})\`\n` +
        `• **Decision Reasons:** \`${reasonSummary}\``
      : `🔗 **Zincir Sayaçları (açılıştan beri):**\n` +
        `\`presence=${c.presenceReceived} | işlenen=${c.presenceProcessed} | playing=${c.presenceWithPlaying} | eşleşen=${c.matchedGame} | genelRoblox=${c.generalRoblox} | eşleşmeyen=${c.unmatchedActivity} | yoksayılan=${c.ignoredActivity}\`\n` +
        `\`onaylıOturum=${c.sessionConfirmed} | oyunBitti=${c.gamesEnded || 0} | rolVerilen=${c.roleAdded} | rolAlındı=${c.rolesRemoved || 0} (hata:${c.roleFailed}) | manuel=+${c.manuelVerilen || 0}/-${c.manuelGeriAlinan || 0} | gece=${c.geceTemizligiAlinan || 0}(hata:${c.geceTemizligiBasarisiz || 0}) | süreCheckpoint=${c.checkpointWritten} | dbKayıt=${c.dbSaveSuccess} (hata:${c.dbSaveFailed}) | sesOlayı=${c.voiceChangesReceived} | üyeFetch=${c.memberFetchCalls || 0} (atlanan:${c.memberFetchSkipped || 0}, hata:${c.memberFetchErrors || 0}) | MOVED=${c.transfersMoved} | RETURN_MOVED=${r.RETURN_MOVED || 0} (atlanan:${returnSkipTotal}, hata:${returnErrTotal})\`\n` +
        `• **Karar Sebepleri:** \`${reasonSummary}\``,
  ];

  if (chainHints.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━━━', ...chainHints);
  }

  return {
    content: lines.join('\n').slice(0, 1980),
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
    const rawNameClean = sanitizeDiagnosticField(item.raw.name, 90);
    const rawLines = [
      `name: ${rawNameClean}`,
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
        ? `🧱 **Result:** **Roblox (unknown game)** (raw name: \`${rawNameClean}\`) ➜ OTHER GAMES channel`
        : `🧱 **Sonuç:** **Roblox (oyun bilinmiyor)** (ham ad: \`${rawNameClean}\`) ➜ OTHER GAMES kanalı`;
    } else if (item.status === 'ignored') {
      statusLine = isEn
        ? '⏭️ **Result:** Ignored (non-game app)'
        : '⏭️ **Sonuç:** Yoksayıldı (oyun olmayan uygulama)';
    } else {
      statusLine = isEn
        ? `❓ **Result:** No match (raw name: \`${rawNameClean}\`).\n💡 *If the game's name doesn't appear here, Discord does not recognize the game.*`
        : `❓ **Sonuç:** Eşleşmedi (ham ad: \`${rawNameClean}\`).\n💡 *Oyunun adı burada görünmüyorsa Discord oyunu tanımıyor demektir.*`;
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
    const payload = buildSettingsPanelPayload(actorId, lang, null, db, {
      member: interaction.member,
      guild: interaction.guild,
    });
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
    const payload = buildSettingsPanelPayload(actorId, lang, notice, db, {
      member: interaction.member,
      guild: interaction.guild,
    });
    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  }

  // 3. Sahip doğrulamalı ayar butonları: act_toggle_track:<uid>, act_toggle_move:<uid>, act_diag:<uid>, act_why:<uid>, act_sys:<uid>
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
    const cur = typeof tracker.getPrefs === 'function' ? tracker.getPrefs(actorId) : db.getActivityPrefs(actorId);
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

    const payload = buildSettingsPanelPayload(actorId, lang, notice, db, {
      member: interaction.member,
      guild: interaction.guild,
    });
    return interaction.update(payload);
  }

  if (action === 'act_toggle_move') {
    const cur = typeof tracker.getPrefs === 'function' ? tracker.getPrefs(actorId) : db.getActivityPrefs(actorId);
    if (!cur.tracking) {
      const payload = buildSettingsPanelPayload(actorId, lang, null, db, {
        member: interaction.member,
        guild: interaction.guild,
      });
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

    const payload = buildSettingsPanelPayload(actorId, lang, notice, db, {
      member: interaction.member,
      guild: interaction.guild,
    });
    return interaction.update(payload);
  }

  if (action === 'act_ret') {
    const cur = typeof tracker.getPrefs === 'function' ? tracker.getPrefs(actorId) : db.getActivityPrefs(actorId);
    if (!cur.tracking || !cur.autoMove) {
      const payload = buildSettingsPanelPayload(actorId, lang, null, db, {
        member: interaction.member,
        guild: interaction.guild,
      });
      return interaction.update(payload);
    }

    const nextReturn = !(cur.returnToLobby !== false);
    db.setActivityPrefs(actorId, { returnToLobby: nextReturn });

    const notice = nextReturn
      ? isEn
        ? '🔙 **Return to Lounge 1 after game turned on.**'
        : "🔙 **Oyun bitince Salon 1'e dönüş açıldı.**"
      : isEn
        ? '🔕 **Return to Lounge 1 after game turned off.** You will no longer be moved when closing a game.'
        : "🔕 **Oyun bitince Salon 1'e dönüş kapatıldı.** Artık oyunu bıraktığında ses kanalından taşınmayacaksın.";

    const payload = buildSettingsPanelPayload(actorId, lang, notice, db, {
      member: interaction.member,
      guild: interaction.guild,
    });
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

  if (action === 'act_why') {
    const payload = buildWhyNotMovedPayload({ userId: actorId, lang, tracker });
    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  }

  if (action === 'act_sys') {
    if (!hasSystemStatusAuthority(interaction.member)) {
      return interaction.reply({
        content: isEn
          ? '❌ Only members with the **Developer** role can use this button.'
          : '❌ Bu düğmeyi sadece **Developer** rolündekiler kullanabilir.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const payload = buildSystemStatusPayload({
      guild: interaction.guild,
      client: interaction.client,
      lang,
      tracker,
      db,
    });
    return interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral,
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
  hasSystemStatusAuthority,
  getReasonExplanation,
  computeUserActivitySummary,
  buildActivitySummaryPayload,
  buildSettingsPanelPayload,
  buildWhyNotMovedPayload,
  buildSystemStatusPayload,
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
