const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ActivityType,
  ChannelType,
  Collection,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require('discord.js');

// Testler için izole geçici veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-activity-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const activityConfig = require('../activity.config');
const database = require('../src/utils/database');
const activityTracker = require('../src/utils/activityTracker');
const aktivitemCmd = require('../src/commands/aktivitem');
const { createRegisterPanel } = require('../src/utils/panel');
const {
  buildClientIntents,
  loginWithPresenceFallback,
} = require('../index');

const {
  ActivityTracker,
  TRANSFER_REASONS,
  normalizeActivityText,
  detectGame,
  selectTargetVoiceChannel,
} = activityTracker;

/**
 * Zamanlayıcıları deterministik ve milisaniyeler içinde test etmek için sahte saat/zamanlayıcı.
 */
function createFakeClock(startMs = 1764000000000) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();

  const setTimeoutFn = (fn, delay = 0) => {
    const id = nextId++;
    const handle = {
      id,
      fn,
      runAt: now + Math.max(0, Number(delay) || 0),
      interval: null,
      unref() {
        return handle;
      },
    };
    timers.set(id, handle);
    return handle;
  };

  const clearTimeoutFn = (handle) => {
    if (handle && typeof handle === 'object') {
      timers.delete(handle.id);
    }
  };

  const setIntervalFn = (fn, delay = 1000) => {
    const id = nextId++;
    const step = Math.max(1, Number(delay) || 1000);
    const handle = {
      id,
      fn,
      runAt: now + step,
      interval: step,
      unref() {
        return handle;
      },
    };
    timers.set(id, handle);
    return handle;
  };

  const clearIntervalFn = clearTimeoutFn;

  async function advanceBy(ms) {
    const target = now + ms;
    while (true) {
      let earliest = null;
      for (const t of timers.values()) {
        if (t.runAt <= target && (!earliest || t.runAt < earliest.runAt)) {
          earliest = t;
        }
      }
      if (!earliest) break;
      now = earliest.runAt;
      if (earliest.interval !== null) {
        earliest.runAt = now + earliest.interval;
      } else {
        timers.delete(earliest.id);
      }
      earliest.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = target;
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    nowFn: () => now,
    setNow: (ms) => {
      now = ms;
    },
    setTimeoutFn,
    clearTimeoutFn,
    setIntervalFn,
    clearIntervalFn,
    advanceBy,
    activeTimerCount: () => timers.size,
  };
}

/**
 * Sahte Discord Sunucu, Roller, Ses Kanalları, Komut Kanalı ve Üye üreticisi.
 */
function createMockActivityGuild({
  includeCommandChannel = true,
  commandChannelCanSend = true,
  botHasMovePermission = true,
  roleAddError = null,
  moveError = null,
  botRolePos = 50,
  simulateVoiceEventOnBotMove = false,
  onBotMoveVoiceEvent = null,
} = {}) {
  const roles = new Collection();
  const channels = new Collection();
  const members = new Collection();
  const presences = new Collection();
  const voiceStates = new Collection();

  const apiLog = {
    roleAdds: [],
    roleRemoves: [],
    moves: [],
    commandMessages: [],
    deletedMessages: [],
  };

  // 4 Aktiflik rolü + Developer rolü
  for (const [key, fam] of Object.entries(activityConfig.FAMILIES)) {
    roles.set(fam.roleId, {
      id: fam.roleId,
      name: `${fam.emoji} ${fam.name.tr}`,
      position: 10,
      members: new Collection(),
      familyKey: key,
    });
  }
  roles.set(config.ROLES.DEVELOPER, {
    id: config.ROLES.DEVELOPER,
    name: '💻| DEVELOPER',
    position: 45,
    members: new Collection(),
  });

  function makeVoiceChannel(id, name, { type = ChannelType.GuildVoice, userLimit = 0, canConnect = true } = {}) {
    const ch = {
      id,
      name,
      type,
      userLimit,
      members: new Collection(),
      permissionsFor: () => ({
        has: (perm) => {
          if (!canConnect && (perm === PermissionFlagsBits.Connect || perm === PermissionFlagsBits.ViewChannel)) {
            return false;
          }
          return true;
        },
      }),
    };
    channels.set(id, ch);
    return ch;
  }

  for (const g of activityConfig.GAMES) {
    for (const chId of g.voiceChannelIds) {
      makeVoiceChannel(chId, `🔊 ${g.name}`);
    }
  }
  for (const chId of activityConfig.ROBLOX_UNKNOWN.voiceChannelIds) {
    makeVoiceChannel(chId, '🔊 OTHER GAMES');
  }

  const lobbyChannel = makeVoiceChannel('voice_lobby_1', '🔊 Sohbet 1');
  const lobbyChannel2 = makeVoiceChannel('voice_lobby_2', '🔊 Sohbet 2');
  const afkChannel = makeVoiceChannel('voice_afk_1', '💤 AFK');
  const stageChannel = makeVoiceChannel('voice_stage_1', '🎙️ Sahne', {
    type: ChannelType.GuildStageVoice,
  });

  let msgSeq = 1;
  const commandChannel = {
    id: activityConfig.COMMAND_CHANNEL_ID,
    name: 'bot-komut',
    type: ChannelType.GuildText,
    permissionsFor: () => ({
      has: (perm) => {
        if (!commandChannelCanSend && perm === PermissionFlagsBits.SendMessages) {
          return false;
        }
        return true;
      },
    }),
    send: async (payload) => {
      if (!commandChannelCanSend) {
        const err = new Error('Missing Access');
        err.code = 50013;
        throw err;
      }
      const msg = {
        id: `cmd_msg_${msgSeq++}`,
        content: payload.content,
        components: payload.components || [],
        allowedMentions: payload.allowedMentions,
        deleted: false,
        editedPayloads: [],
        delete: async () => {
          msg.deleted = true;
          apiLog.deletedMessages.push(msg.id);
        },
        edit: async (p) => {
          msg.editedPayloads.push(p);
          if (p.content !== undefined) msg.content = p.content;
        },
      };
      apiLog.commandMessages.push(msg);
      return msg;
    },
  };
  if (includeCommandChannel) {
    channels.set(commandChannel.id, commandChannel);
  }

  const botMember = {
    id: 'bot_self_id',
    roles: { highest: { position: botRolePos } },
    permissions: {
      has: (perm) => {
        if (!botHasMovePermission && perm === PermissionFlagsBits.MoveMembers) {
          return false;
        }
        return true;
      },
    },
  };

  const guild = {
    id: '1559313292651008040',
    afkChannelId: afkChannel.id,
    roles: { cache: roles },
    channels: { cache: channels },
    members: {
      cache: members,
      me: botMember,
      fetch: async (arg) => {
        if (typeof arg === 'string') return members.get(arg) || null;
        if (arg && Array.isArray(arg.user)) {
          const col = new Collection();
          for (const uid of arg.user) {
            const m = members.get(String(uid));
            if (m) col.set(String(uid), m);
          }
          return col;
        }
        return null;
      },
    },
    presences: { cache: presences },
    voiceStates: { cache: voiceStates },
  };

  function syncVoiceStateCache(member) {
    if (member.voice.channelId) {
      voiceStates.set(member.id, {
        id: member.id,
        channelId: member.voice.channelId,
        channel: member.voice.channel,
        member,
        guild,
      });
    } else {
      voiceStates.delete(member.id);
    }
  }

  function makeMember(id, { bot = false, voiceChannel = null, roleIds = [], displayName = null } = {}) {
    const roleMap = new Collection();
    for (const rid of roleIds) {
      const rObj = roles.get(rid) || { id: rid, name: rid, members: new Collection() };
      roleMap.set(rid, rObj);
    }

    const member = {
      id: String(id),
      guild,
      displayName: displayName || `Oyuncu_${id}`,
      user: {
        id: String(id),
        username: `user_${id}`,
        globalName: displayName || `Oyuncu_${id}`,
        bot,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/a.png`,
      },
      presence: null,
      permissions: {
        has: () => false,
      },
      voice: {
        channelId: voiceChannel ? voiceChannel.id : null,
        channel: voiceChannel || null,
        setChannel: async (targetId, reason) => {
          if (moveError) throw moveError;
          const prevChannel = member.voice.channel;
          const oldState = {
            id: member.id,
            member,
            guild,
            channelId: prevChannel ? prevChannel.id : null,
            channel: prevChannel,
          };
          if (prevChannel) {
            prevChannel.members.delete(member.id);
          }
          const nextCh = channels.get(targetId) || null;
          member.voice.channelId = nextCh ? nextCh.id : null;
          member.voice.channel = nextCh;
          if (nextCh) nextCh.members.set(member.id, member);
          syncVoiceStateCache(member);
          apiLog.moves.push({ userId: member.id, targetId, reason });

          if (simulateVoiceEventOnBotMove && typeof onBotMoveVoiceEvent === 'function') {
            const newState = {
              id: member.id,
              member,
              guild,
              channelId: member.voice.channelId,
              channel: member.voice.channel,
            };
            onBotMoveVoiceEvent(oldState, newState);
          }
        },
      },
      roles: {
        cache: roleMap,
        add: async (roleId, reason) => {
          if (roleAddError) throw roleAddError;
          const rObj = roles.get(roleId) || { id: roleId, name: roleId, members: new Collection() };
          roleMap.set(roleId, rObj);
          if (rObj.members) rObj.members.set(member.id, member);
          apiLog.roleAdds.push({ userId: member.id, roleId, reason });
        },
        remove: async (roleId, reason) => {
          roleMap.delete(roleId);
          const rObj = roles.get(roleId);
          if (rObj?.members) rObj.members.delete(member.id);
          apiLog.roleRemoves.push({ userId: member.id, roleId, reason });
        },
      },
    };

    for (const rid of roleIds) {
      const rObj = roles.get(rid);
      if (rObj?.members) rObj.members.set(member.id, member);
    }
    if (voiceChannel) {
      voiceChannel.members.set(member.id, member);
    }
    syncVoiceStateCache(member);
    members.set(member.id, member);
    return member;
  }

  function makePresence(member, activities = []) {
    const p = {
      userId: member.id,
      user: member.user,
      member,
      guild,
      activities,
    };
    member.presence = p;
    presences.set(member.id, p);
    return p;
  }

  function moveMemberVoice(member, nextChannel) {
    const oldState = {
      id: member.id,
      member,
      guild,
      channelId: member.voice.channelId,
      channel: member.voice.channel,
    };
    if (member.voice.channel) {
      member.voice.channel.members.delete(member.id);
    }
    member.voice.channelId = nextChannel ? nextChannel.id : null;
    member.voice.channel = nextChannel || null;
    if (nextChannel) {
      nextChannel.members.set(member.id, member);
    }
    syncVoiceStateCache(member);
    const newState = {
      id: member.id,
      member,
      guild,
      channelId: member.voice.channelId,
      channel: member.voice.channel,
    };
    return { oldState, newState };
  }

  return {
    guild,
    roles,
    channels,
    lobbyChannel,
    lobbyChannel2,
    afkChannel,
    stageChannel,
    commandChannel,
    apiLog,
    makeMember,
    makePresence,
    moveMemberVoice,
  };
}

function makeTestConfig(overrides = {}) {
  return {
    ...activityConfig,
    TIMINGS: {
      ...activityConfig.TIMINGS,
      ROLE_QUEUE_GAP_MS: 0,
      MOVE_QUEUE_GAP_MS: 0,
      ...(overrides.TIMINGS || {}),
    },
    ...(overrides.NO_MOVE_CHANNEL_IDS ? { NO_MOVE_CHANNEL_IDS: overrides.NO_MOVE_CHANNEL_IDS } : {}),
  };
}

test.beforeEach(() => {
  const curMonth = database.getCurrentIstanbulMonth();
  database.data.activityPrefs = {};
  database.data.activityStats = { month: curMonth, users: {} };
  database.data.activityMeta = { announcedAt: Date.now(), lastResetMonth: curMonth };
  database.data.languagePrefs = {};
  database.data.localeHints = {};
  database.save();
  aktivitemCmd.resetActivityCooldowns();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

// =========================================================================
// 0. ZORUNLU UÇTAN UCA ZİNCİR TESTİ VE VARSAYILAN TERCİH TESTİ
// =========================================================================

test('0. ZORUNLU Uçtan Uca Zincir: [presenceUpdate: "Roblox" / "Roblox Player"] -> CONFIRM_SEC -> rol -> checkpoint -> DB kaydet/yeniden yükle -> /aktivitem çıktısı', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T10:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  await tracker.initForGuild(env.guild);

  // Varsayılan tercih kontrolü: activityPrefs'te kaydı OLMAYAN üye tracking:true, autoMove:true olmalı
  const uE2E = env.makeMember('u_e2e');
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityPrefs, 'u_e2e'), false);
  assert.deepEqual(tracker.getPrefs('u_e2e'), { tracking: true, autoMove: true });

  // 1) "Roblox Player" etkinliği gelir
  const pRoblox = env.makePresence(uE2E, [{ type: ActivityType.Playing, name: 'Roblox Player' }]);
  tracker.handlePresenceUpdate(null, pRoblox);

  // 2) CONFIRM_SEC (15 sn) geçer -> oturum onaylanır ve Roblox aile rolü verilir
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u_e2e')?.confirmed, true);
  assert.equal(tracker.sessions.get('u_e2e')?.gameId, 'roblox_unknown');
  assert.equal(uE2E.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);

  // 3) CHECKPOINT_SEC (60 sn) geçer -> t=60 sn'de ilk checkpoint çalışır (60 sn yazılır), t=75 sn'de kapanışta 75 sn olur
  await clock.advanceBy(60000);
  assert.equal(database.getUserActivityStats('u_e2e').games.roblox_unknown, 60);
  assert.equal(tracker.counters.checkpointWritten >= 1, true);
  assert.equal(tracker.counters.dbSaveSuccess >= 1, true);

  // 4) Bot yeniden başlatma simülasyonu: shutdown() kalan 15 sn'yi de yazar (toplam 75 sn), database.init() ile diskten tekrar yükle
  await tracker.shutdown();
  database.data.activityStats = { month: '1999-01', users: {} }; // belleği boz
  database.init(); // diskten geri yükle
  assert.equal(database.getUserActivityStats('u_e2e').games.roblox_unknown, 75, 'Diskten yeniden yüklenince süre korunmalı');

  // 5) /aktivitem çıktısı bu süreyi ("1 dk" ve "Roblox (oyun bilinmiyor)") göstermeli
  let aktivitemReply = null;
  await aktivitemCmd.execute({
    user: uE2E.user,
    member: uE2E,
    locale: 'tr',
    reply: async (p) => {
      aktivitemReply = p;
    },
  });
  const embedDesc = aktivitemReply.embeds[0].toJSON().description;
  assert.match(embedDesc, /Roblox \(oyun bilinmiyor\)/);
  assert.match(embedDesc, /1 dk/);
});

// =========================================================================
// 1. NORMALİZASYON VE ROBLOX / OYUN EŞLEŞTİRME TESTLERİ
// =========================================================================

test('1. Normalizasyon ve eşleşme: Roblox Player/Beta, SCP, ER:LC, Bonk, CS2, TLauncher, placeId, öncelik ve yoksayılanlar', () => {
  assert.equal(normalizeActivityText('SCP: Roleplay'), 'scp roleplay');
  assert.equal(normalizeActivityText('ER:LC'), 'er lc');
  assert.equal(normalizeActivityText('Bonk & Block'), 'bonk block');
  assert.equal(normalizeActivityText('Counter-Strike 2'), 'counter strike 2');
  assert.equal(normalizeActivityText('TLauncher'), 'tlauncher');
  assert.equal(normalizeActivityText('Şampiyon ĞÜÖÇİı — 🥷!'), 'sampiyon guocii');

  const play = (name, extra = {}) => ({ type: ActivityType.Playing, name, ...extra });

  // Genel Roblox: "Roblox", "ROBLOX", "Roblox Player", "Roblox Beta" -> roblox_unknown
  assert.equal(detectGame({ activities: [play('Roblox')] })?.gameId, 'roblox_unknown');
  assert.equal(detectGame({ activities: [play('ROBLOX')] })?.gameId, 'roblox_unknown');
  assert.equal(detectGame({ activities: [play('Roblox Player')] })?.gameId, 'roblox_unknown');
  assert.equal(detectGame({ activities: [play('Roblox Beta')] })?.gameId, 'roblox_unknown');

  // Roblox Studio ASLA roblox_unknown olmamalı, yoksayılmalı!
  assert.equal(detectGame({ activities: [play('Roblox Studio')] }), null);
  assert.equal(detectGame({ activities: [play('Roblox Studio Beta')] }), null);

  // Belirli Roblox oyunu, etkinlik adı "Roblox Player" olsa bile details/state eşleşirse önce gelir
  assert.equal(
    detectGame({
      activities: [play('Roblox Player', { details: 'The Strongest Battlegrounds' })],
    })?.gameId,
    'tsb'
  );

  // Tüm belirli oyunlar
  assert.equal(detectGame({ activities: [play('SCP: Roleplay')] })?.gameId, 'scp');
  assert.equal(detectGame({ activities: [play('ER:LC')] })?.gameId, 'erlc');
  assert.equal(detectGame({ activities: [play('Bonk & Block')] })?.gameId, 'bonk');
  assert.equal(detectGame({ activities: [play('Counter-Strike 2')] })?.gameId, 'cs2');
  assert.equal(detectGame({ activities: [play('TLauncher')] })?.gameId, 'minecraft');
  assert.equal(detectGame({ activities: [play('ZULA Türkiye')] })?.gameId, 'zula');
  assert.equal(detectGame({ activities: [play('Apeirophobia')] })?.gameId, 'apeirophobia');
  assert.equal(detectGame({ activities: [play('Jail Break!')] })?.gameId, 'jailbreak');

  // 'scp' tek başına eşleşmemeli
  assert.equal(detectGame({ activities: [play('SCP')] }), null);
  // 'tsb' equals
  assert.equal(detectGame({ activities: [play('TSB')] })?.gameId, 'tsb');
  assert.equal(detectGame({ activities: [play('TSB Rehberi')] }), null);
});

// =========================================================================
// 2. SENARYO A, B, C, D: SES AKTARIMI VE TETİKLEYİCİLER
// =========================================================================

test('2. Senaryo A (A1, A2, A3): Üye sesteyken Roblox / Roblox Player / Belirli oyun oynamaya başlar', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  // A1: Sesteyken "Roblox" -> 15 sn onay -> 10 sn geri sayım -> OTHER GAMES (1571913882707165216) + hak tüketilir
  const uA1 = env.makeMember('uA1', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(uA1, [{ type: ActivityType.Playing, name: 'Roblox' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.getLastDecision('uA1')?.reason, TRANSFER_REASONS.COUNTDOWN_PENDING);
  await clock.advanceBy(10000);
  assert.equal(uA1.voice.channelId, '1571913882707165216');
  assert.equal(tracker.sessions.get('uA1')?.moveToken, false);
  assert.equal(tracker.getLastDecision('uA1')?.reason, TRANSFER_REASONS.MOVED);

  // A2: Sesteyken "Roblox Player" -> yine OTHER GAMES'e taşınır
  const uA2 = env.makeMember('uA2', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(uA2, [{ type: ActivityType.Playing, name: 'Roblox Player' }]));
  await clock.advanceBy(15000);
  await clock.advanceBy(10000);
  assert.equal(uA2.voice.channelId, '1571913882707165216');
  assert.equal(tracker.getLastDecision('uA2')?.reason, TRANSFER_REASONS.MOVED);

  // A3: Belirli oyun ("The Strongest Battlegrounds") -> TSB kanalına (1571912346773885050) taşınır
  const uA3 = env.makeMember('uA3', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(uA3, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]));
  await clock.advanceBy(15000);
  await clock.advanceBy(10000);
  assert.equal(uA3.voice.channelId, '1571912346773885050');

  await tracker.shutdown();
});

test('3. Senaryo B (B1, B2, B3): ÖNCE oyunu açıp SONRA ses kanalına girme, null presence fallback ve WAITING_CONFIRM', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  // B1: Üye seste değilken oyunu açar -> 20 sn geçer -> sese girer -> 3 sn debounce -> 10 sn geri sayım -> taşınır!
  const uB1 = env.makeMember('uB1', { voiceChannel: null });
  tracker.handlePresenceUpdate(null, env.makePresence(uB1, [{ type: ActivityType.Playing, name: 'Roblox Player' }]));
  await clock.advanceBy(20000);
  assert.equal(tracker.getLastDecision('uB1')?.reason, TRANSFER_REASONS.NOT_IN_VOICE);
  assert.equal(tracker.sessions.get('uB1')?.moveToken, true, 'Seste değilken hak tüketilmemeli');

  const { oldState: b1Old, newState: b1New } = env.moveMemberVoice(uB1, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(b1Old, b1New);
  await clock.advanceBy(3000); // 3 sn VOICE_DEBOUNCE_SEC
  assert.equal(tracker.getLastDecision('uB1')?.reason, TRANSFER_REASONS.COUNTDOWN_PENDING);
  assert.equal(tracker.getLastDecision('uB1')?.trigger, 'voice-join');
  await clock.advanceBy(10000); // 10 sn COUNTDOWN_SEC
  assert.equal(uB1.voice.channelId, '1571913882707165216');
  assert.equal(tracker.getLastDecision('uB1')?.reason, TRANSFER_REASONS.MOVED);

  // B2: member.presence null olduğunda: oturum da yoksa NO_PRESENCE_DATA döner ve hata fırlatmaz
  const uNoPres = env.makeMember('uNoPres', { voiceChannel: null });
  uNoPres.presence = null;
  env.guild.presences.cache.delete('uNoPres');
  const { oldState: npOld, newState: npNew } = env.moveMemberVoice(uNoPres, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(npOld, npNew);
  await clock.advanceBy(3000);
  assert.equal(tracker.getLastDecision('uNoPres')?.reason, TRANSFER_REASONS.NO_PRESENCE_DATA);

  // B3: Oyun CONFIRM_SEC (15 sn) dolmadan (5. saniyede) sese girilirse -> WAITING_CONFIRM, kalan süre dolunca otomatik taşınır!
  const uB3 = env.makeMember('uB3', { voiceChannel: null });
  tracker.handlePresenceUpdate(null, env.makePresence(uB3, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(5000); // Henüz 5 sn oldu
  const { oldState: b3Old, newState: b3New } = env.moveMemberVoice(uB3, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(b3Old, b3New);
  await clock.advanceBy(3000); // Toplam 8 sn oldu -> henüz 15 sn dolmadı!
  assert.equal(tracker.getLastDecision('uB3')?.reason, TRANSFER_REASONS.WAITING_CONFIRM);

  // Kalan 7 sn dolunca (toplam 15 sn) otomatik geri sayım başlar ve 10 sn sonra taşınır
  await clock.advanceBy(7000);
  assert.equal(tracker.getLastDecision('uB3')?.reason, TRANSFER_REASONS.COUNTDOWN_PENDING);
  await clock.advanceBy(10000);
  assert.equal(uB3.voice.channelId, '1571914184860504074');

  await tracker.shutdown();
});

test('4. Senaryo C & D: Kanaldan kanala elle geçiş (hak varken vs TOKEN_SPENT) ve Bot yeniden başlatma (sesteyse hak yok, ses dışındaysa hak var)', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  // D: Bot açılışında uInVoice zaten seste, uOutVoice ses dışında
  const uInVoice = env.makeMember('uInVoice', { voiceChannel: env.lobbyChannel });
  env.makePresence(uInVoice, [{ type: ActivityType.Playing, name: 'CS2' }]);

  const uOutVoice = env.makeMember('uOutVoice', { voiceChannel: null });
  env.makePresence(uOutVoice, [{ type: ActivityType.Playing, name: 'Zula' }]);

  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  await tracker.initForGuild(env.guild);

  // Açılışta HİÇBİR üye taşınmamış olmalı
  assert.equal(env.apiLog.moves.length, 0, 'Açılışta hiçbir üye taşınmamalı');
  assert.equal(tracker.sessions.get('uInVoice')?.moveToken, false, 'Açılışta seste olan üyenin hakkı tükenmiş sayılmalı');
  assert.equal(tracker.sessions.get('uOutVoice')?.moveToken, true, 'Açılışta ses dışında olan üyenin hakkı korunmalı');

  // uInVoice başka bir lobiye elle geçse bile hakkı tükenmiş olduğundan TOKEN_SPENT döner ve taşınmaz
  const { oldState: ivOld, newState: ivNew } = env.moveMemberVoice(uInVoice, env.lobbyChannel2);
  tracker.handleVoiceStateUpdate(ivOld, ivNew);
  await clock.advanceBy(3000);
  assert.equal(tracker.getLastDecision('uInVoice')?.reason, TRANSFER_REASONS.TOKEN_SPENT);
  assert.equal(uInVoice.voice.channelId, env.lobbyChannel2.id);

  // uOutVoice sonradan sese girince hakkı olduğu için taşınır!
  const { oldState: ovOld, newState: ovNew } = env.moveMemberVoice(uOutVoice, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(ovOld, ovNew);
  await clock.advanceBy(3000);
  await clock.advanceBy(10000);
  assert.equal(uOutVoice.voice.channelId, '1571914184860504074');

  // Senaryo C: uOutVoice taşındıktan sonra kendi isteğiyle Lobi 1'e dönerse aynı oturumda tekrar taşınmaz (TOKEN_SPENT)
  const { oldState: cOld, newState: cNew } = env.moveMemberVoice(uOutVoice, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(cOld, cNew);
  await clock.advanceBy(3000);
  assert.equal(tracker.getLastDecision('uOutVoice')?.reason, TRANSFER_REASONS.TOKEN_SPENT);
  assert.equal(uOutVoice.voice.channelId, env.lobbyChannel.id);

  // Senaryo C (hak varken kanaldan kanala geçiş): AFK'dayken oyun başlayan üye normal kanala geçince taşınır
  const uFromAfk = env.makeMember('uFromAfk', { voiceChannel: env.afkChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(uFromAfk, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.getLastDecision('uFromAfk')?.reason, TRANSFER_REASONS.EXCLUDED_CHANNEL);
  assert.equal(tracker.sessions.get('uFromAfk')?.moveToken, true, 'AFK kanalında hak tüketilmemeli');

  const { oldState: afkOld, newState: afkNew } = env.moveMemberVoice(uFromAfk, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(afkOld, afkNew);
  await clock.advanceBy(3000);
  assert.equal(tracker.getLastDecision('uFromAfk')?.trigger, 'voice-switch');
  await clock.advanceBy(10000);
  assert.equal(uFromAfk.voice.channelId, '1571915418728271973');

  await tracker.shutdown();
});

// =========================================================================
// 3. SENARYO E, F, G, H, I: GERİ SAYIM, BOT MOVE IGNORE, YEDEK TARAMA VE MINECRAFT
// =========================================================================

test('5. Senaryo E, F, G, H, I: Geri sayımda sesten çıkınca hak korunması, iptal, botun kendi taşımasını yoksayma, 30 sn yedek tarama ve Minecraft', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

  let trackerRef = null;
  const env = createMockActivityGuild({
    simulateVoiceEventOnBotMove: true,
    onBotMoveVoiceEvent: (oldS, newS) => {
      // Bot setChannel yaptığında Discord'un ürettiği voiceStateUpdate olayını simüle et
      trackerRef?.handleVoiceStateUpdate(oldS, newS);
    },
  });

  const tracker = new ActivityTracker({
    config: makeTestConfig({ NO_MOVE_CHANNEL_IDS: ['voice_nomove_custom'] }),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  trackerRef = tracker;
  tracker.guild = env.guild;

  // E1: Geri sayımda sesten çıkma -> LEFT_VOICE_DURING_COUNTDOWN, hak TÜKETİLMEZ, tekrar sese girince yeni geri sayım başlar!
  const uLeave = env.makeMember('uLeave', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(uLeave, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.activeCountdowns.has('uLeave'), true);

  // Geri sayımın 4. saniyesinde sesten çıkar
  await clock.advanceBy(4000);
  const { oldState: l1, newState: l2 } = env.moveMemberVoice(uLeave, null);
  tracker.handleVoiceStateUpdate(l1, l2);
  assert.equal(tracker.getLastDecision('uLeave')?.reason, TRANSFER_REASONS.LEFT_VOICE_DURING_COUNTDOWN);
  assert.equal(tracker.sessions.get('uLeave')?.moveToken, true, 'Geri sayımda sesten çıkınca hak tüketilmemeli!');

  // Tekrar sese girince yeni geri sayım başlar ve taşınır (+ G: Bot taşıyınca voiceStateUpdate tekrar tetiklenmez!)
  const { oldState: r1, newState: r2 } = env.moveMemberVoice(uLeave, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(r1, r2);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('uLeave'), true);
  await clock.advanceBy(10000);
  assert.equal(uLeave.voice.channelId, '1571914184860504074');
  assert.equal(tracker.voiceDebounceTimers.has('uLeave'), false, 'Botun kendi taşıması yeni debounce başlatmamalı');

  // G2: Eşzamanlı iki evaluateTransfer çağrısı tek geri sayım açmalı
  const uConcurrent = env.makeMember('uConcurrent', { voiceChannel: env.lobbyChannel });
  env.makePresence(uConcurrent, [
    { type: ActivityType.Playing, name: 'CS2', timestamps: { start: clock.nowFn() - 30000 } },
  ]);
  const msgCountBeforeConc = env.apiLog.commandMessages.length;
  await Promise.all([
    tracker.evaluateTransfer(uConcurrent, 'voice-join'),
    tracker.evaluateTransfer(uConcurrent, 'sweep'),
  ]);
  assert.equal(env.apiLog.commandMessages.length - msgCountBeforeConc, 1, 'Çift geri sayım mesajı atılmamalı');
  await clock.advanceBy(10000);

  // H: Yedek tarama (runSweep, 30 sn): kaçırılan olayı yakalar, ses dışındakileri dolaşmaz
  const uSweep = env.makeMember('uSweep', { voiceChannel: env.lobbyChannel });
  const uOffline = env.makeMember('uOffline', { voiceChannel: null });
  tracker.sessions.set('uSweep', {
    userId: 'uSweep',
    confirmed: true,
    gameId: 'zula',
    family: 'zula',
    currentlyDetectedGameId: 'zula',
    since: clock.nowFn() - 60000,
    activityStartedAt: clock.nowFn() - 60000,
    lastAccountedAt: clock.nowFn(),
    lastSeen: clock.nowFn(),
    moveToken: true,
    sweepBlockedForMoveFail: false,
  });
  env.makePresence(uSweep, [{ type: ActivityType.Playing, name: 'Zula' }]);
  tracker.sessions.set('uOffline', {
    userId: 'uOffline',
    confirmed: true,
    gameId: 'zula',
    family: 'zula',
    currentlyDetectedGameId: 'zula',
    since: clock.nowFn() - 60000,
    activityStartedAt: clock.nowFn() - 60000,
    lastAccountedAt: clock.nowFn(),
    lastSeen: clock.nowFn(),
    moveToken: true,
    sweepBlockedForMoveFail: false,
  });

  const sweepRes = await tracker.runSweep(env.guild);
  assert.equal(sweepRes.evaluated, 1, 'Sadece seste olan uSweep değerlendirilmeli, uOffline dolaşılmamalı');
  assert.equal(tracker.getLastDecision('uSweep')?.trigger, 'sweep');
  assert.equal(tracker.getLastDecision('uOffline'), null);
  await clock.advanceBy(10000);
  assert.equal(uSweep.voice.channelId, '1571914184860504074');

  // E2: Komut kanalına mesaj gönderme izni yoksa -> COMMAND_CHANNEL_UNAVAILABLE ve hak tüketilmez
  const noSendEnv = createMockActivityGuild({ commandChannelCanSend: false });
  const tNoSend = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tNoSend.guild = noSendEnv.guild;
  const uNoSend = noSendEnv.makeMember('uNoSend', { voiceChannel: noSendEnv.lobbyChannel });
  tNoSend.handlePresenceUpdate(null, noSendEnv.makePresence(uNoSend, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  assert.equal(tNoSend.getLastDecision('uNoSend')?.reason, TRANSFER_REASONS.COMMAND_CHANNEL_UNAVAILABLE);
  assert.equal(tNoSend.sessions.get('uNoSend')?.moveToken, true);
  await tNoSend.shutdown();

  await tracker.shutdown();
});

// =========================================================================
// 4. SAYAÇLAR, KARAR İZİ (30 DK TTL), "NEDEN AKTARILMADIM?" VE "SİSTEM DURUMU"
// =========================================================================

test('6. Sayaçlar, karar izi 30 dk TTL, 🧪 Neden aktarılmadım?, 🛠️ Sistem Durumu yetki kontrolü ve diskte karar izi/geçmiş olmaması', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T15:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  await tracker.initForGuild(env.guild);

  const regularMember = env.makeMember('reg_u1');
  const devMember = env.makeMember('dev_u1', { roleIds: [config.ROLES.DEVELOPER] });

  // regularMember ses dışındayken Roblox oynar -> NOT_IN_VOICE karar izi oluşur
  tracker.handlePresenceUpdate(
    null,
    env.makePresence(regularMember, [{ type: ActivityType.Playing, name: 'Roblox Player' }])
  );
  await clock.advanceBy(15000);

  // Sayaçlarda kullanıcı kimliği OLMAMALI ve halkalar artmış olmalı
  assert.equal(tracker.counters.presenceReceived, 1);
  assert.equal(tracker.counters.presenceProcessed, 1);
  assert.equal(tracker.counters.presenceWithPlaying, 1);
  assert.equal(tracker.counters.generalRoblox, 1);
  assert.equal(tracker.counters.sessionConfirmed, 1);
  assert.equal(tracker.counters.reasons.NOT_IN_VOICE, 1);
  assert.equal(JSON.stringify(tracker.counters).includes('reg_u1'), false, 'Sayaçlar kullanıcı ID si içermemeli');

  // 1) "⚙️ Ayarlarım" paneli: normal üyede "🛠️ Sistem Durumu" GÖRÜNMEZ, Developer üyede GÖRÜNÜR
  const regSettings = aktivitemCmd.buildSettingsPanelPayload('reg_u1', 'tr', null, database, {
    member: regularMember,
    guild: env.guild,
  });
  const regRow2Btns = regSettings.components[1].toJSON().components;
  assert.equal(regRow2Btns.length, 1);
  assert.equal(regRow2Btns[0].custom_id, 'act_why:reg_u1');

  const devSettings = aktivitemCmd.buildSettingsPanelPayload('dev_u1', 'tr', null, database, {
    member: devMember,
    guild: env.guild,
  });
  const devRow2Btns = devSettings.components[1].toJSON().components;
  assert.equal(devRow2Btns.length, 2);
  assert.equal(devRow2Btns[0].custom_id, 'act_why:dev_u1');
  assert.equal(devRow2Btns[1].custom_id, 'act_sys:dev_u1');

  // 2) "🧪 Neden aktarılmadım?" (TR ve EN)
  let whyTr = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_why:reg_u1',
      user: regularMember.user,
      member: regularMember,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        whyTr = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(whyTr.ephemeral, true);
  assert.match(whyTr.content, /NOT_IN_VOICE/);
  assert.match(whyTr.content, /Bir ses kanalında değildin/);

  let whyEn = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_why:reg_u1',
      user: regularMember.user,
      member: regularMember,
      guild: env.guild,
      locale: 'en-US',
      reply: async (p) => {
        whyEn = p;
      },
    },
    { tracker, db: database }
  );
  assert.match(whyEn.content, /You were not in a voice channel/);

  // 3) 30 dakika (DECISION_TTL_MIN) geçince karar izi bellekten silinir
  await clock.advanceBy(30 * 60 * 1000 + 1000);
  assert.equal(tracker.getLastDecision('reg_u1'), null);

  // 4) "🛠️ Sistem Durumu": yetkisiz basarsa ephemeral red; Developer basarsa Presence Intent ve sayaçları gösterir
  let unauthSys = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_sys:reg_u1',
      user: regularMember.user,
      member: regularMember,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        unauthSys = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(unauthSys.ephemeral, true);
  assert.match(unauthSys.content, /Developer/);

  let devSys = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_sys:dev_u1',
      user: devMember.user,
      member: devMember,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        devSys = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(devSys.ephemeral, true);
  assert.match(devSys.content, /Bot presence alıyor/);
  assert.match(devSys.content, /Zincir Sayaçları/);
  assert.equal(devSys.content.includes('reg_u1'), false, 'Sistem durumunda kullanıcı kimliği bulunmamalı');

  // Presence Intent kapalıyken Sistem Durumu açıkça "❌ Bot presence OLMADAN çalışıyor" yazmalı
  tracker.setPresenceEnabled(false);
  const disabledSys = aktivitemCmd.buildSystemStatusPayload({
    guild: env.guild,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(disabledSys.content, /Bot presence OLMADAN çalışıyor/);
  tracker.setPresenceEnabled(true);

  // 5) Diskteki database.json içinde karar izi, sayaç veya oyun geçmişi OLMAMALI
  database.save();
  const diskData = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  assert.equal(diskData.lastDecisions, undefined);
  assert.equal(diskData.counters, undefined);
  assert.equal(diskData.activityHistory, undefined);

  await tracker.shutdown();
});

// =========================================================================
// 5. AYLIK SIFIRLAMA GÜVENLİĞİ, /aktivitem BOŞ DURUM İPUCU, INTENT & CONFIG
// =========================================================================

test('7. Aylık sıfırlama aynı ayda veriyi silmez, ay dönümünde siler; /aktivitem boş durumda teşhis ipucu gösterir', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T12:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });

  // Veri yazıldıktan hemen sonra checkMonthlyReset çağrıldığında aynı ay içinde veriyi SİLMEMELİ!
  database.data.activityStats.month = '2026-11';
  database.addActivitySeconds('u_keep', 'cs2', 600, { immediate: true });
  const sameMonthCheck = await tracker.checkMonthlyReset(env.guild, new Date('2026-11-22T12:10:00Z'));
  assert.equal(sameMonthCheck.reset, false);
  assert.equal(database.getUserActivityStats('u_keep').games.cs2, 600, 'Aynı ay içinde kontrol veriyi silmemeli');

  // Ay dönümünde (2026-12-01 İstanbul = 2026-11-30T21:00:00Z) sıfırlamalı
  const nextMonthCheck = await tracker.checkMonthlyReset(env.guild, new Date('2026-11-30T21:00:00Z'));
  assert.equal(nextMonthCheck.reset, true);
  assert.equal(database.data.activityStats.month, '2026-12');
  assert.deepEqual(database.data.activityStats.users, {});

  // /aktivitem boş durum ipucu kontrolü
  const uEmpty = env.makeMember('uEmpty');
  const emptySummary = aktivitemCmd.buildActivitySummaryPayload({
    user: uEmpty.user,
    member: uEmpty,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(emptySummary.embeds[0].toJSON().description, /Botun Gördüğü Etkinlik/);

  // Kayıt paneli notu
  const regPanel = createRegisterPanel();
  const panelDesc = regPanel.embeds.map((e) => e.toJSON().description).join('\n');
  assert.match(panelDesc, /\/aktivitem/);

  await tracker.shutdown();
});

test('8. Presence Intent kapalı fallback ve yapılandırma doğrulama', async () => {
  const intentsFull = buildClientIntents({ includePresenceIntent: true });
  assert.ok(intentsFull.includes(GatewayIntentBits.GuildPresences));
  assert.ok(intentsFull.includes(GatewayIntentBits.GuildVoiceStates));

  const warnings = [];
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
  });

  const result = await loginWithPresenceFallback({
    token: 'fake-token',
    tracker,
    logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    createClientFn: ({ includePresenceIntent }) => ({
      activityPresenceDisabled: !includePresenceIntent,
      destroy: () => {},
      login: async () => {
        if (includePresenceIntent) throw new Error('Used disallowed intents');
        return 'ok';
      },
    }),
  });
  assert.equal(result.presenceEnabled, false);
  assert.equal(tracker.isPresenceIntentAvailable(), false);

  const badCfg = {
    ...activityConfig,
    GAMES: [
      { id: 'dup', family: 'roblox', name: '1', voiceChannelIds: ['1'], matchers: [{ op: 'contains', value: 'a' }] },
      { id: 'dup', family: 'roblox', name: '2', voiceChannelIds: ['1'], matchers: [{ op: 'contains', value: 'b' }] },
    ],
  };
  const structRes = activityConfig.validateActivityConfigStructure(badCfg, { silent: true });
  assert.equal(structRes.valid, false);
});
