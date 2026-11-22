/**
 * Mobil Oyuncular İçin /oyun (/game) Slash Komutu
 *
 * KESİN SINIRLAR (Otomatik Oyun Etkinliği Sisteminden Bağımsız):
 * - /oyun komutu ve butonları HİÇBİR ŞEKİLDE üyeyi ses kanalına taşımaz.
 * - Geri sayım veya ses aktarma mesajı üretmez.
 * - Salon 1'e dönüş akışını tetiklemez.
 * - activityTracker içinde oyun oturumu YARATMAZ.
 * - Oynama süresi toplamaz (activityStats'a yazmaz) ve /aktivitem'deki "Şu an oynuyor" satırında görünmez.
 * - Karar izine (lastDecisions) aktarma kodu yazmaz.
 * - Yalnızca seçilen ailenin "Oyun Aktiflik Rolü"nü verir/geri alır ve gece 00:00 (Europe/Istanbul)
 *   temizliği için activityManual kaydını günceller.
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const activityConfig = require('../../activity.config');
const database = require('../utils/database');
const activityTracker = require('../utils/activityTracker');
const { resolveLang } = require('../utils/i18n');

// Kullanıcı + aile başına 2 sn bekleme haritası: Map<`${userId}:${familyKey}`, number>
const manualButtonCooldowns = new Map();

/**
 * Testler için /oyun buton bekleme haritasını sıfırlar.
 */
function resetManualButtonCooldowns() {
  manualButtonCooldowns.clear();
}

/**
 * activity.config.js içindeki FAMILIES sırasına göre (roblox, zula, minecraft, cs2)
 * kullanıcının GÜNCEL rol durumundan /oyun ephemeral panelini üretir (ek UI belleği tutmaz).
 */
function buildManualGamePanelPayload({
  member,
  guild = null,
  lang = 'tr',
  statusLine = null,
  tracker = activityTracker,
  cfg = activityConfig,
  nowMs = null,
}) {
  const isEn = lang === 'en';
  const targetGuild = guild || member?.guild || tracker?.guild || null;
  const uid = String(member?.id || member?.user?.id || '');

  const currentMs = typeof nowMs === 'number' ? nowMs : tracker?.now ? tracker.now() : Date.now();
  const tz = cfg.MANUAL_TIMEZONE || activityConfig.MANUAL_TIMEZONE || 'Europe/Istanbul';
  const nextMidnightFn = cfg.getNextMidnightMsInTimeZone || activityConfig.getNextMidnightMsInTimeZone;
  const nextMidnightUnix = Math.floor(nextMidnightFn(currentMs, tz) / 1000);

  const baseText = isEn
    ? '📱 **Game Role (Mobile)**\n' +
      "Discord can't automatically detect games played on mobile. Press your game's button below to get your activity role right away 🎮\n" +
      '• Press the same button again to remove your role.\n' +
      `• Roles are removed automatically every day at **00:00** (Turkey time (UTC+3)). Next: <t:${nextMidnightUnix}:R>\n` +
      '• This feature does **not** move you to a voice channel and does **not** count playtime.\n' +
      "💻 Playing on PC? Your game is detected automatically — you don't need this."
    : '📱 **Oyun Rolü (Mobil)**\n' +
      'Mobilde oynadığın oyunları Discord otomatik algılayamaz. Oynadığın oyunun butonuna bas, aktiflik rolün hemen verilsin 🎮\n' +
      '• Aynı butona tekrar basarsan rolün geri alınır.\n' +
      `• Roller her gün **00:00**'da (Türkiye saati) otomatik alınır. Sıradaki: <t:${nextMidnightUnix}:R>\n` +
      '• Bu özellik seni ses kanalına **aktarmaz** ve oynama süreni **saymaz**.\n' +
      '💻 Bilgisayardan oynuyorsan oyunun otomatik algılanır; buna ihtiyacın yok.';

  const content = statusLine ? `${baseText}\n\n${statusLine}` : baseText;

  // 4 buton tek satırda; emoji ve adlar doğrudan activity.config.js FAMILIES tanımından okunur
  const row = new ActionRowBuilder();
  for (const [familyKey, fam] of Object.entries(cfg.FAMILIES || {})) {
    const emoji = fam?.emoji || '🎮';
    const labelName = fam?.label || fam?.id || familyKey;
    const roleId = fam?.roleId || null;
    const roleAvailable = Boolean(roleId && targetGuild?.roles?.cache?.has?.(roleId));
    const hasRole = Boolean(roleId && member?.roles?.cache?.has?.(roleId));

    const btn = new ButtonBuilder()
      .setCustomId(`act_gr:${familyKey}:${uid}`)
      .setLabel(hasRole && roleAvailable ? `✅ ${emoji} ${labelName}` : `${emoji} ${labelName}`)
      .setStyle(hasRole && roleAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!roleAvailable);

    row.addComponents(btn);
  }

  return {
    content: content.slice(0, 2000),
    components: [row],
    allowedMentions: { parse: [] },
  };
}

/**
 * /oyun buton tıklamalarını işler (customId: act_gr:<aile>:<userId>).
 * Not: Bu işleyici ses kanalına aktarma yapmaz, oturum başlatmaz ve süre saymaz.
 */
async function handleManualGameRoleButton(
  interaction,
  { tracker = activityTracker, db = database, cfg = activityConfig } = {}
) {
  const cid = String(interaction.customId || '');
  const lang = resolveLang(interaction);
  const isEn = lang === 'en';
  const actorId = String(interaction.user?.id || '');

  if (!actorId || interaction.user?.bot) return;

  const parts = cid.split(':');
  const prefix = parts[0];
  const familyKey = parts[1];
  const ownerId = parts[2];

  if (parts.length !== 3 || prefix !== 'act_gr' || !familyKey || !ownerId) {
    return interaction.reply({
      content: isEn ? '⚠️ This menu has expired.' : '⚠️ Bu menü eskidi.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  // 1. Sahiplik doğrulaması (ephemeral olsa da sunucu tarafında kontrol edilir)
  if (actorId !== String(ownerId)) {
    return interaction.reply({
      content: isEn ? '❌ This button is not for you.' : '❌ Bu buton sana ait değil.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const fam = cfg.FAMILIES?.[familyKey] || null;
  const guild = interaction.guild || tracker?.guild || null;
  const member = interaction.member || guild?.members?.cache?.get?.(actorId) || null;

  if (!fam || !guild || !member) {
    return interaction.reply({
      content: isEn
        ? '⚠️ This role is currently unavailable, please notify server staff.'
        : '⚠️ Bu rol şu an kullanılamıyor, yetkililere haber ver.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  // 2. Kullanıcı başına, aile başına 2 sn bekleme süresi
  const nowMs = tracker?.now ? tracker.now() : Date.now();
  const cooldownMs = Math.max(0, Number(cfg.TIMINGS?.MANUAL_BUTTON_COOLDOWN_SEC ?? 2) * 1000);
  const cooldownKey = `${actorId}:${familyKey}`;
  const lastAt = manualButtonCooldowns.get(cooldownKey) || 0;
  if (cooldownMs > 0 && lastAt > 0 && nowMs - lastAt < cooldownMs) {
    return interaction.reply({
      content: isEn ? '⏳ Slow down a bit 🙂' : '⏳ Biraz yavaş 🙂',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
  manualButtonCooldowns.set(cooldownKey, nowMs);

  // 3. Rol yapılandırmada veya sunucuda yoksa nazikçe bildir
  const roleId = fam.roleId || null;
  const roleObj = roleId ? guild.roles?.cache?.get?.(roleId) || null : null;
  if (!roleId || !roleObj) {
    return interaction.reply({
      content: isEn
        ? '⚠️ This role is currently unavailable, please notify server staff.'
        : '⚠️ Bu rol şu an kullanılamıyor, yetkililere haber ver.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  // Gece yarısı gün dönümü olduysa önce eski günün temizliğini tamamla
  if (typeof tracker?.runMidnightManualCleanup === 'function') {
    await tracker.runMidnightManualCleanup(guild).catch(() => {});
  }

  const labelName = fam.label || familyKey;
  const hasManualMark = db.hasManualActivityRole(actorId, familyKey);
  const tz = cfg.MANUAL_TIMEZONE || activityConfig.MANUAL_TIMEZONE || 'Europe/Istanbul';
  const todayFn = cfg.getDateStringInTimeZone || activityConfig.getDateStringInTimeZone;
  const todayStr = todayFn(nowMs, tz);

  // 4. Bugün MANUEL işaret YOKSA -> rolü ver (veya zaten varsa sadece işaretle) ve işareti kaydet
  if (!hasManualMark) {
    const alreadyHasRole = Boolean(member.roles?.cache?.has?.(roleId));

    if (!alreadyHasRole) {
      const addRes = await tracker.enqueueRoleAddDetailed(
        member,
        roleId,
        familyKey,
        'Mobil /oyun komutu ile aktiflik rolü verildi'
      );

      if (!addRes?.ok) {
        // Hata durumunda ASLA manuel işaret koyma
        return interaction.reply({
          content: isEn
            ? '⚠️ Could not assign the role, please notify server staff.'
            : '⚠️ Rol verilemedi, yetkililere haber ver.',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      }
    }

    // İşlem başarılı (veya rol zaten vardı): manuel işareti kirli olarak kaydet (checkpoint/SIGTERM ile diske yazılır)
    db.setManualActivityRole(actorId, familyKey, { day: todayStr, immediate: false });
    if (tracker?.counters) {
      tracker.counters.manuelVerilen = (tracker.counters.manuelVerilen || 0) + 1;
    }

    const statusLine = isEn
      ? `✅ Your **${labelName}** role has been added. It will be removed automatically at 00:00.`
      : `✅ **${labelName}** rolün verildi. 00:00'da otomatik alınacak.`;

    const payload = buildManualGamePanelPayload({
      member,
      guild,
      lang,
      statusLine,
      tracker,
      cfg,
      nowMs,
    });
    return interaction.update(payload);
  }

  // 5. Bugün MANUEL işaret VARSA (tekrar basma) -> işareti kaldır; canlı otomatik oturum yoksa rolü de al
  db.removeManualActivityRole(actorId, familyKey, { immediate: false });
  if (tracker?.counters) {
    tracker.counters.manuelGeriAlinan = (tracker.counters.manuelGeriAlinan || 0) + 1;
  }

  const hasLiveAutoSession =
    typeof tracker?.hasLiveConfirmedSessionForFamily === 'function' &&
    tracker.hasLiveConfirmedSessionForFamily(actorId, familyKey);

  let statusLine;
  if (hasLiveAutoSession) {
    statusLine = isEn
      ? `ℹ️ Your game is currently detected, so your **${labelName}** role will be removed when you stop playing.`
      : `ℹ️ Oyunun algılanıyor, **${labelName}** rolün oyunu bırakınca alınacak.`;
  } else {
    if (member.roles?.cache?.has?.(roleId)) {
      await tracker.enqueueRoleRemoveDetailed(
        member,
        roleId,
        familyKey,
        'Mobil /oyun komutu ile aktiflik rolü geri alındı'
      );
    }
    statusLine = isEn
      ? `↩️ Your **${labelName}** role has been removed.`
      : `↩️ **${labelName}** rolün geri alındı.`;
  }

  const payload = buildManualGamePanelPayload({
    member,
    guild,
    lang,
    statusLine,
    tracker,
    cfg,
    nowMs,
  });
  return interaction.update(payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oyun')
    .setNameLocalizations({
      'en-US': 'game',
      'en-GB': 'game',
    })
    .setDescription('Mobilde oynuyorsan oyun aktiflik rolünü al 📱🎮')
    .setDescriptionLocalizations({
      'en-US': 'Playing on mobile? Get your game activity role 📱🎮',
      'en-GB': 'Playing on mobile? Get your game activity role 📱🎮',
    }),

  buildManualGamePanelPayload,
  handleManualGameRoleButton,
  resetManualButtonCooldowns,

  async execute(interaction) {
    if (interaction.user?.bot) return;

    const lang = resolveLang(interaction);
    const isEn = lang === 'en';

    if (!interaction.guild || !interaction.member) {
      return interaction.reply({
        content: isEn
          ? '⚠️ This command can only be used inside a server.'
          : '⚠️ Bu komut yalnızca sunucu içinde kullanılabilir.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const payload = buildManualGamePanelPayload({
      member: interaction.member,
      guild: interaction.guild,
      lang,
    });

    return interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral,
    });
  },
};
