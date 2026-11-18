const config = require('../../config');
const database = require('./database');

// Kullanıcı bazlı işlem kilidi (art arda hızlı kanal değişimlerinde sıralama bozulmasın)
const userVoiceQueues = new Map();

/**
 * Aynı kullanıcıya ait ses olaylarını sırayla işler.
 */
function runWithUserVoiceLock(userId, taskFn) {
  const uid = String(userId || '');
  if (!uid) return Promise.resolve();

  const prev = userVoiceQueues.get(uid) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => taskFn())
    .finally(() => {
      if (userVoiceQueues.get(uid) === next) {
        userVoiceQueues.delete(uid);
      }
    });

  userVoiceQueues.set(uid, next);
  return next;
}

/**
 * AFK ses kanalının ID'sini döndürür.
 */
function getAfkVoiceChannelId() {
  return config.CHANNELS?.AFK_VOICE ? String(config.CHANNELS.AFK_VOICE).trim() : null;
}

/**
 * Üyenin ses kanalındaki sunucu susturması (mute) ve sağırlaştırmasını (deaf) tek istekte günceller.
 */
async function applyVoiceMuteAndDeaf(member, voiceState, { mute, deaf, reason, force = false }) {
  if (!member) {
    return { ok: false, error: new Error('Üye nesnesi bulunamadı') };
  }

  const curMute =
    voiceState && typeof voiceState.serverMute === 'boolean'
      ? voiceState.serverMute
      : member.voice?.serverMute;
  const curDeaf =
    voiceState && typeof voiceState.serverDeaf === 'boolean'
      ? voiceState.serverDeaf
      : member.voice?.serverDeaf;

  const needMute = typeof mute === 'boolean' && (force || curMute !== mute);
  const needDeaf = typeof deaf === 'boolean' && (force || curDeaf !== deaf);

  if (!needMute && !needDeaf) {
    return { ok: true, changed: false };
  }

  const patch = {};
  if (needMute) patch.mute = mute;
  if (needDeaf) patch.deaf = deaf;

  try {
    if (typeof member.edit === 'function') {
      await member.edit({ ...patch, reason });
    } else {
      if (needMute && typeof member.voice?.setMute === 'function') {
        await member.voice.setMute(mute, reason);
      }
      if (needDeaf && typeof member.voice?.setDeaf === 'function') {
        await member.voice.setDeaf(deaf, reason);
      }
    }
    return { ok: true, changed: true };
  } catch (err) {
    const msg = String(err?.message || '');
    // Kullanıcı o an ses bağlantısını kesmişse Discord API 40032 hatası döner
    if (err?.code === 40032 || /not connected to voice/i.test(msg)) {
      return { ok: false, notConnected: true, error: err };
    }

    const userTag = member.user?.tag || member.id || 'Bilinmeyen Üye';
    console.warn(`[AFK SES] ${userTag} için ses durumu güncellenemedi (mute=${mute}, deaf=${deaf}): ${msg}`);
    return { ok: false, error: err };
  }
}

/**
 * Tek bir ses durumu değişim olayının (voiceStateUpdate) iç mantığıdır.
 */
async function processVoiceStateTransition(oldState, newState) {
  const afkChannelId = getAfkVoiceChannelId();
  if (!afkChannelId) return { action: 'no_channel_configured' };

  const guild = newState?.guild || oldState?.guild;
  if (config.GUILD_ID && guild?.id && String(guild.id) !== String(config.GUILD_ID)) {
    return { action: 'ignored_other_guild' };
  }

  const userId = newState?.id || oldState?.id || newState?.member?.id || oldState?.member?.id;
  if (!userId) return { action: 'missing_user' };

  const oldChannelId = oldState?.channelId ? String(oldState.channelId) : null;
  const newChannelId = newState?.channelId ? String(newState.channelId) : null;

  let member = newState?.member || oldState?.member || null;
  if (!member && guild?.members) {
    member =
      guild.members.cache?.get?.(userId) ||
      (await guild.members.fetch?.(userId).catch(() => null));
  }

  // 1. DURUM: Üye şu an AFK ses kanalı içinde (yeni girmiş veya içinde iken susturma/sağırlaştırma açılmış)
  if (newChannelId === afkChannelId) {
    database.markAfkMutedUser(userId, afkChannelId, { pendingUnmute: false });

    const res = await applyVoiceMuteAndDeaf(member, newState, {
      mute: true,
      deaf: true,
      reason: 'AFK ses kanalına giriş: otomatik susturma ve sağırlaştırma',
    });

    return {
      action: oldChannelId === afkChannelId ? 're_enforced_afk' : 'entered_afk',
      ...res,
    };
  }

  // 2. DURUM: Üye doğrudan AFK ses kanalından başka bir ses kanalına çıktı
  if (oldChannelId === afkChannelId && newChannelId && newChannelId !== afkChannelId) {
    const hadRecord = database.isAfkMutedUser(userId);
    const curMute = Boolean(newState?.serverMute ?? member?.voice?.serverMute);
    const curDeaf = Boolean(newState?.serverDeaf ?? member?.voice?.serverDeaf);

    if (!curMute && !curDeaf && !hadRecord) {
      return { action: 'left_afk_already_clear', ok: true, changed: false };
    }

    const res = await applyVoiceMuteAndDeaf(member, newState, {
      mute: false,
      deaf: false,
      force: hadRecord && (!curMute || !curDeaf),
      reason: 'AFK ses kanalından çıkış: susturma ve sağırlaştırma kaldırıldı',
    });

    if (res.ok) {
      database.clearAfkMutedUser(userId);
    } else if (res.notConnected) {
      database.markAfkMutedUser(userId, afkChannelId, { pendingUnmute: true });
    }

    return { action: 'left_afk_to_voice', ...res };
  }

  // 3. DURUM: Üye AFK ses kanalındayken ses bağlantısını tamamen kesti (disconnect)
  if (oldChannelId === afkChannelId && !newChannelId) {
    // Discord bağlı değilken mute/deaf kaldırmaya izin vermez; bir sonraki ses kanalı girişinde kaldırmak için işaretle
    database.markAfkMutedUser(userId, afkChannelId, { pendingUnmute: true });
    return { action: 'disconnected_from_afk', ok: true };
  }

  // 4. DURUM: Üye AFK dışındaki bir ses kanalında ve önceden AFK nedeniyle susturulmuş/beklemede görünüyor
  if (newChannelId && newChannelId !== afkChannelId && database.isAfkMutedUser(userId)) {
    const res = await applyVoiceMuteAndDeaf(member, newState, {
      mute: false,
      deaf: false,
      reason: 'AFK sonrası ses kanalına giriş: susturma ve sağırlaştırma kaldırıldı',
    });

    if (res.ok) {
      database.clearAfkMutedUser(userId);
    }

    return { action: 'cleared_pending_unmute', ...res };
  }

  // Normal ses kanallarındaki üyelere (AFK ile ilgisi olmayanlara) ASLA dokunulmaz
  return { action: 'noop' };
}

/**
 * Discord voiceStateUpdate olayını kullanıcı kilidi altında güvenle işler.
 */
async function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState?.id || oldState?.id || newState?.member?.id || oldState?.member?.id;
  if (!userId) return { action: 'missing_user' };

  return runWithUserVoiceLock(userId, () => processVoiceStateTransition(oldState, newState));
}

/**
 * Bot açılışında AFK kanalında halihazırda bulunan üyeleri susturup sağırlaştırır,
 * AFK dışındaki ses kanallarına geçmiş bekleyen üyelerin ise engelini temizler.
 */
async function syncAfkVoiceStatesOnStartup(guild) {
  const afkChannelId = getAfkVoiceChannelId();
  if (!guild || !afkChannelId) {
    return { enforcedCount: 0, clearedCount: 0 };
  }

  let enforcedCount = 0;
  let clearedCount = 0;

  try {
    const afkChannel =
      guild.channels?.cache?.get?.(afkChannelId) ||
      (await guild.channels?.fetch?.(afkChannelId).catch(() => null));

    // 1. Şu an AFK ses kanalında oturan herkesi kontrol et
    if (afkChannel && afkChannel.members) {
      const members = Array.from(afkChannel.members.values());
      for (const member of members) {
        const uid = member?.id;
        if (!uid) continue;

        await runWithUserVoiceLock(uid, async () => {
          database.markAfkMutedUser(uid, afkChannelId, { pendingUnmute: false });
          const res = await applyVoiceMuteAndDeaf(member, member.voice, {
            mute: true,
            deaf: true,
            reason: 'Bot açılışı: AFK ses kanalındaki üye susturuldu ve sağırlaştırıldı',
          });
          if (res.ok && res.changed) {
            enforcedCount += 1;
          }
        });
      }
    }

    // 2. AFK listesinde kayıtlı olup şu an AFK dışında normal bir ses kanalına geçmiş üyeleri temizle
    const trackedIds = database.getAfkMutedUserIds();
    for (const uid of trackedIds) {
      await runWithUserVoiceLock(uid, async () => {
        const member =
          guild.members?.cache?.get?.(uid) ||
          (await guild.members?.fetch?.(uid).catch(() => null));

        if (!member) {
          database.clearAfkMutedUser(uid);
          return;
        }

        const currentVoiceChannelId = member.voice?.channelId ? String(member.voice.channelId) : null;
        if (currentVoiceChannelId === afkChannelId) {
          // Hala AFK kanalında, dokunma (yukarıda zaten eşitlendi)
          return;
        }

        if (currentVoiceChannelId && currentVoiceChannelId !== afkChannelId) {
          const res = await applyVoiceMuteAndDeaf(member, member.voice, {
            mute: false,
            deaf: false,
            reason: 'Bot açılışı: AFK dışı ses kanalındaki üyenin susturma ve sağırlaştırması kaldırıldı',
          });
          if (res.ok) {
            database.clearAfkMutedUser(uid);
            clearedCount += 1;
          }
        } else {
          // Hala hiçbir ses kanalında değil; bir sonraki normal kanal girişinde temizlenmek üzere beklet
          database.markAfkMutedUser(uid, afkChannelId, { pendingUnmute: true });
        }
      });
    }

    if (enforcedCount > 0 || clearedCount > 0) {
      console.log(
        `[AFK SES] Açılış eşitlemesi: ${enforcedCount} üyeye AFK susturma/sağırlaştırma uygulandı, ${clearedCount} üyeden kaldırıldı.`
      );
    }
  } catch (err) {
    console.warn('[AFK SES] Açılış eşitlemesi sırasında hata:', err.message);
  }

  return { enforcedCount, clearedCount };
}

module.exports = {
  getAfkVoiceChannelId,
  applyVoiceMuteAndDeaf,
  handleVoiceStateUpdate,
  syncAfkVoiceStatesOnStartup,
};
