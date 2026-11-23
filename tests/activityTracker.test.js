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
  MessageFlags,
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
  includeReturnChannel = true,
  returnChannelType = ChannelType.GuildVoice,
  returnChannelUserLimit = 0,
  returnChannelCanConnect = true,
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
  const returnChannel = includeReturnChannel
    ? makeVoiceChannel(activityConfig.RETURN_CHANNEL_ID, '🔊 Salon 1', {
        type: returnChannelType,
        userLimit: returnChannelUserLimit,
        canConnect: returnChannelCanConnect,
      })
    : null;
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

  function makePresence(member, activities = [], { status = 'online' } = {}) {
    const p = {
      userId: member.id,
      user: member.user,
      member,
      guild,
      status,
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
    returnChannel,
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
    ...overrides,
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
  const curDay = database.getCurrentIstanbulDay();
  database.data.activityPrefs = {};
  database.data.activityStats = { month: curMonth, users: {} };
  database.data.activityMeta = {
    announcedAt: Date.now(),
    returnAnnouncedAt: Date.now(),
    manualAnnouncedAt: Date.now(),
    voiceRoleAnnouncedAt: Date.now(),
    lastResetMonth: curMonth,
  };
  database.data.activityManual = { day: curDay, users: {} };
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

  // Varsayılan tercih kontrolü: activityPrefs'te kaydı OLMAYAN üye tracking:true, autoMove:true, returnToLobby:true olmalı
  // ROLE_REQUIRES_VOICE=true olduğundan rol alması için ses kanalında (taşınmayan AFK) konumlandırılır
  const uE2E = env.makeMember('u_e2e', { voiceChannel: env.afkChannel });
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityPrefs, 'u_e2e'), false);
  assert.deepEqual(tracker.getPrefs('u_e2e'), { tracking: true, autoMove: true, returnToLobby: true });

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

  // B1: Üye seste değilken oyunu açar -> 20 sn geçer (ROLE_WAITING_FOR_VOICE, hak korunur) -> sese girer -> 3 sn debounce -> rol + 10 sn geri sayım -> taşınır!
  const uB1 = env.makeMember('uB1', { voiceChannel: null });
  tracker.handlePresenceUpdate(null, env.makePresence(uB1, [{ type: ActivityType.Playing, name: 'Roblox Player' }]));
  await clock.advanceBy(20000);
  assert.equal(tracker.getLastDecision('uB1')?.reason, TRANSFER_REASONS.ROLE_WAITING_FOR_VOICE);
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

  // regularMember ses dışındayken Roblox oynar -> ROLE_WAITING_FOR_VOICE karar izi oluşur
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
  assert.equal(tracker.counters.reasons.ROLE_WAITING_FOR_VOICE, 1);
  assert.equal(JSON.stringify(tracker.counters).includes('reg_u1'), false, 'Sayaçlar kullanıcı ID si içermemeli');

  // 1) "⚙️ Ayarlarım" paneli: normal üyede "🛠️ Sistem Durumu" GÖRÜNMEZ, Developer üyede GÖRÜNÜR
  const regSettings = aktivitemCmd.buildSettingsPanelPayload('reg_u1', 'tr', null, database, {
    member: regularMember,
    guild: env.guild,
  });
  const regRow1Btns = regSettings.components[0].toJSON().components;
  const regRow2Btns = regSettings.components[1].toJSON().components;
  assert.equal(regRow1Btns.length, 3);
  assert.equal(regRow1Btns[2].custom_id, 'act_ret:reg_u1');
  assert.equal(regRow2Btns.length, 2);
  assert.equal(regRow2Btns[0].custom_id, 'act_diag:reg_u1');
  assert.equal(regRow2Btns[1].custom_id, 'act_why:reg_u1');

  const devSettings = aktivitemCmd.buildSettingsPanelPayload('dev_u1', 'tr', null, database, {
    member: devMember,
    guild: env.guild,
  });
  const devRow2Btns = devSettings.components[1].toJSON().components;
  assert.equal(devRow2Btns.length, 3);
  assert.equal(devRow2Btns[0].custom_id, 'act_diag:dev_u1');
  assert.equal(devRow2Btns[1].custom_id, 'act_why:dev_u1');
  assert.equal(devRow2Btns[2].custom_id, 'act_sys:dev_u1');

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
  assert.match(whyTr.content, /ROLE_WAITING_FOR_VOICE/);
  assert.match(whyTr.content, /bir ses kanalındayken oyun oynarken verilir/);

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
  assert.match(whyEn.content, /while you're in a voice channel and playing/);

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
  assert.equal(unauthSys.flags, MessageFlags.Ephemeral);
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
  assert.equal(devSys.flags, MessageFlags.Ephemeral);
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

test('9. safeFetchMember korumaları: tek-uçuş (in-flight), 30 sn kullanıcı cooldown, fırtına sınırı, 429 geri çekilme ve Sistem Durumu sayacı', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T18:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  const tracker = new ActivityTracker({
    config: makeTestConfig({
      TIMINGS: {
        MEMBER_FETCH_COOLDOWN_SEC: 30,
        MEMBER_FETCH_STORM_WINDOW_MS: 60000,
        MEMBER_FETCH_STORM_MAX: 3,
        MEMBER_FETCH_429_BACKOFF_MS: 20000,
      },
    }),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  let rawFetchCallCount = 0;
  let shouldThrow429 = false;
  let pendingResolve = null;

  env.guild.members.fetch = async (arg) => {
    rawFetchCallCount += 1;
    if (shouldThrow429) {
      const err = new Error('You are being rate limited');
      err.code = 429;
      err.retryAfter = 20000;
      throw err;
    }
    const uid = Array.isArray(arg?.user) ? String(arg.user[0]) : String(arg);
    if (pendingResolve) {
      await new Promise((r) => {
        pendingResolve = r;
      });
    }
    const fakeMember = {
      id: uid,
      guild: env.guild,
      user: { id: uid, username: `fetched_${uid}`, bot: false },
      presence: null, // Presence boş kalsa bile 30 sn cooldown tekrar fetch'i önlemeli
    };
    return new Collection([[uid, fakeMember]]);
  };

  // 1) Tek-uçuş (in-flight): Aynı üye için eşzamanlı 2 çağrı -> yalnızca 1 ağ isteği atılmalı
  pendingResolve = true;
  const p1 = tracker.safeFetchMember(env.guild, 'uncached_1');
  const p2 = tracker.safeFetchMember(env.guild, 'uncached_1');
  assert.equal(rawFetchCallCount, 1, 'Eşzamanlı çağrılarda tek istek atılmalı');
  assert.equal(tracker.counters.memberFetchCalls, 1);
  assert.equal(tracker.counters.memberFetchSkipped, 1);
  const unblock = pendingResolve;
  pendingResolve = null;
  if (typeof unblock === 'function') unblock();
  const [m1, m2] = await Promise.all([p1, p2]);
  assert.equal(m1?.id, 'uncached_1');
  assert.equal(m2?.id, 'uncached_1');
  assert.equal(env.guild.members.cache.has('uncached_1'), true, 'Sonuç önbelleğe yazılmalı');

  // 2) Kullanıcı başına 30 sn cooldown: presence null olsa bile 30 sn dolmadan aynı üye için tekrar fetch atılmaz
  await tracker.safeFetchMember(env.guild, 'uncached_1');
  assert.equal(rawFetchCallCount, 1, '30 sn dolmadan aynı üye için ikinci fetch atılmamalı');
  assert.equal(tracker.counters.memberFetchSkipped, 2);

  // 3) Fırtına sınırı (MEMBER_FETCH_STORM_MAX = 3): uncached_2 ve uncached_3 çağrılır (toplam 3 oldu), uncached_4 fırtına korumasına takılır
  await tracker.safeFetchMember(env.guild, 'uncached_2');
  await tracker.safeFetchMember(env.guild, 'uncached_3');
  assert.equal(rawFetchCallCount, 3);

  const stormBlocked = await tracker.safeFetchMember(env.guild, 'uncached_4');
  assert.equal(stormBlocked, null);
  assert.equal(rawFetchCallCount, 3, 'Fırtına sınırı aşılınca yeni REST çağrısı atılmamalı');
  assert.equal(tracker.counters.memberFetchSkipped, 3);

  // 4) 1 dakika ilerlet (fırtına penceresi ve 30 sn cooldown sıfırlanır) -> 429 hız sınırı geri çekilmesini test et
  await clock.advanceBy(61000);
  shouldThrow429 = true;
  const rateLimitedRes = await tracker.safeFetchMember(env.guild, 'uncached_5');
  assert.equal(rateLimitedRes, null, '429 hatası bot akışını çökertmemeli');
  assert.equal(tracker.counters.memberFetchErrors, 1);

  // 429 backoff (20 sn) aktifken farklı bir üye için bile ağa gitmeden anında dönmeli
  shouldThrow429 = false;
  const countBeforeBackoffTest = rawFetchCallCount;
  await tracker.safeFetchMember(env.guild, 'uncached_6');
  assert.equal(rawFetchCallCount, countBeforeBackoffTest, '429 geri çekilme süresince yeni fetch atılmamalı');

  // 5) "🛠️ Sistem Durumu" çıktısında kimliksiz üyeFetch sayacı görünmeli
  const sysStatus = aktivitemCmd.buildSystemStatusPayload({
    guild: env.guild,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(sysStatus.content, /üyeFetch=4 \(atlanan:4, hata:1\)/);

  await tracker.shutdown();
});


// =========================================================================
// 6. OYUN BİTİŞİ: HEMEN ROL ALMA + SALON 1'E SESSİZ DÖNÜŞ TESTLERİ (R1-R15)
// =========================================================================

test('R1 & R1b. Oyun kapanınca STOP_GRACE_SEC (5 sn) sonra aile rolü alınır ve OTHER GAMES / tüm oyun kanallarından Salon 1\'e sessizce taşınır', async () => {
  assert.equal(activityConfig.TIMINGS.STOP_GRACE_SEC, 5, 'STOP_GRACE_SEC 5 sn olmalı');
  assert.equal(activityConfig.RETURN_CHANNEL_ID, '1559927197056241816');

  const clock = createFakeClock(Date.parse('2026-11-22T19:00:00Z'));
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

  // R1: OTHER GAMES (1571913882707165216) kanalındayken Roblox oynar -> 35 sn sonra kapatır -> 5 sn grace
  const otherGamesCh = env.channels.get('1571913882707165216');
  const uR1 = env.makeMember('u_r1', { voiceChannel: otherGamesCh });
  const pStart = env.makePresence(uR1, [{ type: ActivityType.Playing, name: 'Roblox Player' }]);
  tracker.handlePresenceUpdate(null, pStart);

  // 15 sn onay + 20 sn daha oyun = toplam 35 sn
  await clock.advanceBy(15000);
  assert.equal(uR1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  await clock.advanceBy(20000);

  const cmdCountBeforeStop = env.apiLog.commandMessages.length;
  const pStop = env.makePresence(uR1, [], { status: 'online' });
  tracker.handlePresenceUpdate(pStart, pStop);

  // 4. saniyede henüz bitiş çalışmamış olmalı
  await clock.advanceBy(4000);
  assert.equal(uR1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  assert.equal(uR1.voice.channelId, '1571913882707165216');

  // 5. saniyede (STOP_GRACE_SEC = 5) rol alınır ve Salon 1'e SESSİZCE taşınır
  await clock.advanceBy(1000);
  assert.equal(uR1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false, 'Roblox aktiflik rolü alınmalı');
  assert.equal(uR1.voice.channelId, activityConfig.RETURN_CHANNEL_ID, 'Salon 1 kanalına taşınmalı');
  assert.equal(tracker.sessions.has('u_r1'), false, 'Oturum temizlenmeli');
  assert.equal(tracker.getLastDecision('u_r1')?.reason, TRANSFER_REASONS.RETURN_MOVED);
  assert.equal(tracker.getLastDecision('u_r1')?.trigger, 'game-ended');
  assert.equal(env.apiLog.commandMessages.length, cmdCountBeforeStop, 'Sessiz taşıma: komut kanalına mesaj atılmamalı');
  // Süre son görülme anına kadar (35 sn) sayılmalı, 5 sn grace EKLENMEMELİ
  assert.equal(database.getUserActivityStats('u_r1').games.roblox_unknown, 35);

  // R1b: TSB, CS2, Zula ve Minecraft kanallarından (2 kanal dahil) Salon 1'e dönüş
  const gameCases = [
    { uid: 'u_tsb', chId: '1571912346773885050', name: 'The Strongest Battlegrounds', fam: 'roblox' },
    { uid: 'u_cs2', chId: '1571915418728271973', name: 'Counter-Strike 2', fam: 'cs2' },
    { uid: 'u_zula', chId: '1571914184860504074', name: 'Zula', fam: 'zula' },
    { uid: 'u_mc1', chId: '1571914836248363169', name: 'Minecraft', fam: 'minecraft' },
    { uid: 'u_mc2', chId: '1571914899569778698', name: 'TLauncher', fam: 'minecraft' },
  ];

  for (const tc of gameCases) {
    const ch = env.channels.get(tc.chId);
    const m = env.makeMember(tc.uid, { voiceChannel: ch });
    const p1 = env.makePresence(m, [{ type: ActivityType.Playing, name: tc.name }]);
    tracker.handlePresenceUpdate(null, p1);
    await clock.advanceBy(15000);
    assert.equal(m.roles.cache.has(activityConfig.FAMILIES[tc.fam].roleId), true);

    const p2 = env.makePresence(m, [], { status: 'online' });
    tracker.handlePresenceUpdate(p1, p2);
    await clock.advanceBy(5000);
    assert.equal(m.roles.cache.has(activityConfig.FAMILIES[tc.fam].roleId), false, `${tc.uid} rolü alınmalı`);
    assert.equal(m.voice.channelId, activityConfig.RETURN_CHANNEL_ID, `${tc.uid} Salon 1'e taşınmalı`);
    assert.equal(tracker.getLastDecision(tc.uid)?.reason, TRANSFER_REASONS.RETURN_MOVED);
  }

  await tracker.shutdown();
});

test('R2. 5 sn\'den kısa etkinlik kesintisinde hiçbir şey olmaz (rol kalır, taşıma yok)', async () => {
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

  const tsbCh = env.channels.get('1571912346773885050');
  const m = env.makeMember('u_r2', { voiceChannel: tsbCh });
  const pPlay = env.makePresence(m, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pPlay);
  await clock.advanceBy(15000);

  // Etkinlik 3 sn kesilir, sonra aynı oyun geri döner
  const pBlip = env.makePresence(m, [], { status: 'online' });
  tracker.handlePresenceUpdate(pPlay, pBlip);
  await clock.advanceBy(3000);

  const pBack = env.makePresence(m, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(pBlip, pBack);
  await clock.advanceBy(10000);

  assert.equal(m.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true, 'Rol korunmalı');
  assert.equal(m.voice.channelId, tsbCh.id, 'Taşıma olmamalı');
  assert.equal(tracker.sessions.get('u_r2')?.confirmed, true);
  assert.equal(env.apiLog.moves.length, 0);

  await tracker.shutdown();
});

test('R3 & R4. Seste değilken (sonradan girse de taşınmaz), oyun dışı kanalda ve zaten Salon 1\'deyken davranış', async () => {
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

  // R3: Sesteyken CS2 rolü alır -> sesten çıkar -> oyun biter -> rol alınır, RETURN_SKIPPED_NOT_IN_VOICE, sonradan oyun kanalına girse de TAŞINMAZ
  const uR3 = env.makeMember('u_r3', { voiceChannel: env.afkChannel });
  const p3a = env.makePresence(uR3, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tracker.handlePresenceUpdate(null, p3a);
  await clock.advanceBy(15000);
  assert.equal(uR3.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);

  // Oyun kapanmadan önce sesten tamamen çıkar (ROLE_REMOVE_ON_VOICE_LEAVE=false olduğundan rol kalır)
  const { oldState: leave3Old, newState: leave3New } = env.moveMemberVoice(uR3, null);
  tracker.handleVoiceStateUpdate(leave3Old, leave3New);

  const p3b = env.makePresence(uR3, [], { status: 'online' });
  tracker.handlePresenceUpdate(p3a, p3b);
  await clock.advanceBy(5000);
  assert.equal(uR3.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(tracker.getLastDecision('u_r3')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NOT_IN_VOICE);
  assert.equal(env.apiLog.moves.length, 0);

  // Sonradan CS2 kanalına girerse taşınmamalı
  const cs2Ch = env.channels.get('1571915418728271973');
  const { oldState: o3, newState: n3 } = env.moveMemberVoice(uR3, cs2Ch);
  tracker.handleVoiceStateUpdate(o3, n3);
  await clock.advanceBy(15000);
  assert.equal(uR3.voice.channelId, cs2Ch.id, 'Sonradan sese girince Salon 1\'e taşınmamalı');
  assert.equal(env.apiLog.moves.length, 0);

  // R4a: Yönetilen oyun kanalı DIŞINDA (lobbyChannel) -> rol alınır, RETURN_SKIPPED_NOT_GAME_CHANNEL
  const uR4a = env.makeMember('u_r4a', { voiceChannel: env.lobbyChannel });
  // İlk aktarma hakkını harcamış/oturumu açılışta gibi kabul edelim veya direkt confirmed kuralım
  tracker.sessions.set('u_r4a', {
    userId: 'u_r4a',
    confirmed: true,
    gameId: 'zula',
    family: 'zula',
    currentlyDetectedGameId: 'zula',
    since: clock.nowFn() - 20000,
    activityStartedAt: clock.nowFn() - 20000,
    lastAccountedAt: clock.nowFn() - 20000,
    lastSeen: clock.nowFn(),
    moveToken: false,
    sweepBlockedForMoveFail: false,
  });
  await uR4a.roles.add(activityConfig.FAMILIES.zula.roleId);
  const p4a1 = env.makePresence(uR4a, [{ type: ActivityType.Playing, name: 'Zula' }]);
  const p4a2 = env.makePresence(uR4a, [], { status: 'online' });
  tracker.handlePresenceUpdate(p4a1, p4a2);
  await clock.advanceBy(5000);
  assert.equal(uR4a.roles.cache.has(activityConfig.FAMILIES.zula.roleId), false);
  assert.equal(uR4a.voice.channelId, env.lobbyChannel.id, 'Oyun dışı kanaldan taşınmamalı');
  assert.equal(tracker.getLastDecision('u_r4a')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NOT_GAME_CHANNEL);

  // R4b: Üye ZATEN Salon 1'de -> rol alınır, hiçbir şey yapılmaz, hata yok
  const uR4b = env.makeMember('u_r4b', { voiceChannel: env.returnChannel });
  tracker.sessions.set('u_r4b', {
    userId: 'u_r4b',
    confirmed: true,
    gameId: 'cs2',
    family: 'cs2',
    currentlyDetectedGameId: 'cs2',
    since: clock.nowFn() - 20000,
    activityStartedAt: clock.nowFn() - 20000,
    lastAccountedAt: clock.nowFn() - 20000,
    lastSeen: clock.nowFn(),
    moveToken: false,
    sweepBlockedForMoveFail: false,
  });
  await uR4b.roles.add(activityConfig.FAMILIES.cs2.roleId);
  const p4b1 = env.makePresence(uR4b, [{ type: ActivityType.Playing, name: 'CS2' }]);
  const p4b2 = env.makePresence(uR4b, [], { status: 'online' });
  tracker.handlePresenceUpdate(p4b1, p4b2);
  await clock.advanceBy(5000);
  assert.equal(uR4b.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(uR4b.voice.channelId, activityConfig.RETURN_CHANNEL_ID);
  assert.equal(env.apiLog.moves.length, 0, 'Zaten Salon 1\'deyken setChannel çağrılmamalı');

  await tracker.shutdown();
});

test('R5. Oyundan oyuna geçiş (A->B, Roblox->CS2, ROBLOX_UNKNOWN->belirli oyun, eşleşmeyen oyun, yoksayılan uygulama)', async () => {
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

  // 1) A -> B (TSB -> Bonk & Block, aynı Roblox ailesi): Salon 1'e dönüş YOK, rol değişmez, Bonk kanalına aktarılır
  const tsbCh = env.channels.get('1571912346773885050');
  const uAB = env.makeMember('u_ab', { voiceChannel: tsbCh });
  const pTsb = env.makePresence(uAB, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pTsb);
  await clock.advanceBy(15000);
  const removesBeforeAB = env.apiLog.roleRemoves.length;

  const pBonk = env.makePresence(uAB, [{ type: ActivityType.Playing, name: 'Bonk & Block' }]);
  tracker.handlePresenceUpdate(pTsb, pBonk);
  await clock.advanceBy(6000); // 5 sn STOP_GRACE geçer ama Salon 1'e dönmemeli!
  assert.equal(uAB.voice.channelId, tsbCh.id, '5 sn geçince Salon 1\'e dönmemeli');
  await clock.advanceBy(9000); // 15 sn CONFIRM tamamlanır -> Bonk geri sayımı başlar
  await clock.advanceBy(10000);
  assert.equal(uAB.voice.channelId, '1571912742116401266', 'Bonk & Block kanalına aktarılmalı');
  assert.equal(env.apiLog.roleRemoves.length, removesBeforeAB, 'Roblox içi geçişte rol alınmamalı');

  // 2) Roblox -> CS2 (farklı aile): Salon 1'e dönüş YOK, CS2 rolü gelir, CS2 kanalına taşınır
  const uRC = env.makeMember('u_rc', { voiceChannel: tsbCh });
  const pRC1 = env.makePresence(uRC, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pRC1);
  await clock.advanceBy(15000);

  const pRC2 = env.makePresence(uRC, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]);
  tracker.handlePresenceUpdate(pRC1, pRC2);
  await clock.advanceBy(15000);
  assert.equal(uRC.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(uRC.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);
  await clock.advanceBy(10000);
  assert.equal(uRC.voice.channelId, '1571915418728271973');

  // 3) ROBLOX_UNKNOWN -> belirli oyun (TSB): Salon 1'e dönüş YOK, OTHER GAMES -> TSB
  const otherCh = env.channels.get('1571913882707165216');
  const uUnk = env.makeMember('u_unk', { voiceChannel: otherCh });
  const pUnk1 = env.makePresence(uUnk, [{ type: ActivityType.Playing, name: 'Roblox Player' }]);
  tracker.handlePresenceUpdate(null, pUnk1);
  await clock.advanceBy(15000);

  const pUnk2 = env.makePresence(uUnk, [
    { type: ActivityType.Playing, name: 'Roblox Player', details: 'The Strongest Battlegrounds' },
  ]);
  tracker.handlePresenceUpdate(pUnk1, pUnk2);
  await clock.advanceBy(15000);
  await clock.advanceBy(10000);
  assert.equal(uUnk.voice.channelId, '1571912346773885050');

  // 4) Desteklenmeyen başka bir Playing oyun (Valorant) açıksa -> eski rol alınır, RETURN_SKIPPED_OTHER_GAME_ACTIVE
  const cs2Ch = env.channels.get('1571915418728271973');
  const uVal = env.makeMember('u_val', { voiceChannel: cs2Ch });
  const pVal1 = env.makePresence(uVal, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tracker.handlePresenceUpdate(null, pVal1);
  await clock.advanceBy(15000);
  const pVal2 = env.makePresence(uVal, [{ type: ActivityType.Playing, name: 'Valorant' }]);
  tracker.handlePresenceUpdate(pVal1, pVal2);
  await clock.advanceBy(5000);
  assert.equal(uVal.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(uVal.voice.channelId, cs2Ch.id);
  assert.equal(tracker.getLastDecision('u_val')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_OTHER_GAME_ACTIVE);

  // 5) Yoksayılan uygulama (OBS Studio) arka planda çalışıyorsa -> oyun bitmiş sayılır, Salon 1'e DÖNER
  const uObs = env.makeMember('u_obs', { voiceChannel: cs2Ch });
  const pObs1 = env.makePresence(uObs, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tracker.handlePresenceUpdate(null, pObs1);
  await clock.advanceBy(15000);
  const pObs2 = env.makePresence(uObs, [{ type: ActivityType.Playing, name: 'OBS Studio' }]);
  tracker.handlePresenceUpdate(pObs1, pObs2);
  await clock.advanceBy(5000);
  assert.equal(uObs.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(uObs.voice.channelId, activityConfig.RETURN_CHANNEL_ID);
  assert.equal(tracker.getLastDecision('u_obs')?.reason, TRANSFER_REASONS.RETURN_MOVED);

  await tracker.shutdown();
});

test('R6 & R7. Görünmez/offline (RETURN_SKIPPED_NO_PRESENCE) ve kullanıcı tercihleri (returnToLobby, autoMove, tracking)', async () => {
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

  const tsbCh = env.channels.get('1571912346773885050');

  // R6a: Durum "offline" (görünmez) -> oturum biter, rol alınır, TAŞIMA YOK (RETURN_SKIPPED_NO_PRESENCE)
  const uInv = env.makeMember('u_inv', { voiceChannel: tsbCh });
  const pInv1 = env.makePresence(uInv, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pInv1);
  await clock.advanceBy(15000);
  assert.equal(uInv.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);

  const pInv2 = env.makePresence(uInv, [], { status: 'offline' });
  tracker.handlePresenceUpdate(pInv1, pInv2);
  await clock.advanceBy(5000);
  assert.equal(uInv.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false, 'Görünmez olunca rol alınmalı');
  assert.equal(uInv.voice.channelId, tsbCh.id, 'Görünmez olunca Salon 1\'e taşınmamalı');
  assert.equal(tracker.getLastDecision('u_inv')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NO_PRESENCE);

  // R6b: presence tamamen null -> oturum biter, rol alınır, TAŞIMA YOK (RETURN_SKIPPED_NO_PRESENCE)
  const uNullP = env.makeMember('u_nullp', { voiceChannel: tsbCh });
  const pNP1 = env.makePresence(uNullP, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pNP1);
  await clock.advanceBy(15000);
  uNullP.presence = null;
  env.guild.presences.cache.delete('u_nullp');
  tracker.processDetectedGame({ userId: 'u_nullp', member: uNullP, guild: env.guild, detected: null });
  await clock.advanceBy(5000);
  assert.equal(uNullP.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(uNullP.voice.channelId, tsbCh.id);
  assert.equal(tracker.getLastDecision('u_nullp')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NO_PRESENCE);

  // R7a: getPrefs varsayılanı returnToLobby: true; false yazılır, true'ya dönünce kayıt silinir
  assert.deepEqual(tracker.getPrefs('u_default'), { tracking: true, autoMove: true, returnToLobby: true });
  database.setActivityPrefs('u_pref_cycle', { returnToLobby: false });
  assert.equal(database.data.activityPrefs.u_pref_cycle.returnToLobby, false);
  // Diskten yeniden yükle
  database.data.activityPrefs = {};
  database.init();
  assert.deepEqual(tracker.getPrefs('u_pref_cycle'), { tracking: true, autoMove: true, returnToLobby: false });
  database.setActivityPrefs('u_pref_cycle', { returnToLobby: true });
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityPrefs, 'u_pref_cycle'), false);

  // R7b: returnToLobby kapalı -> rol alınır, taşıma yok (RETURN_SKIPPED_OPTED_OUT)
  const uOptRet = env.makeMember('u_opt_ret', { voiceChannel: tsbCh });
  database.setActivityPrefs('u_opt_ret', { returnToLobby: false });
  const pOR1 = env.makePresence(uOptRet, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pOR1);
  await clock.advanceBy(15000);
  const pOR2 = env.makePresence(uOptRet, [], { status: 'online' });
  tracker.handlePresenceUpdate(pOR1, pOR2);
  await clock.advanceBy(5000);
  assert.equal(uOptRet.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(uOptRet.voice.channelId, tsbCh.id);
  assert.equal(tracker.getLastDecision('u_opt_ret')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_OPTED_OUT);

  // R7c: autoMove kapalı -> rol alınır, taşıma yok (RETURN_SKIPPED_OPTED_OUT)
  const uOptMove = env.makeMember('u_opt_move', { voiceChannel: tsbCh });
  database.setActivityPrefs('u_opt_move', { autoMove: false });
  const pOM1 = env.makePresence(uOptMove, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pOM1);
  await clock.advanceBy(15000);
  const pOM2 = env.makePresence(uOptMove, [], { status: 'online' });
  tracker.handlePresenceUpdate(pOM1, pOM2);
  await clock.advanceBy(5000);
  assert.equal(uOptMove.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(uOptMove.voice.channelId, tsbCh.id);
  assert.equal(tracker.getLastDecision('u_opt_move')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_OPTED_OUT);

  // R7d: tracking kapalı -> hiçbir işlem yapılmaz
  const uNoTrack = env.makeMember('u_notrack', { voiceChannel: tsbCh });
  database.setActivityPrefs('u_notrack', { tracking: false });
  tracker.handlePresenceUpdate(null, env.makePresence(uNoTrack, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(20000);
  assert.equal(tracker.sessions.has('u_notrack'), false);
  assert.equal(uNoTrack.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);

  await tracker.shutdown();
});

test('R8. Salon 1 yok / dolu / izin yok / 40032 / diğer hata: ilgili RETURN_* kodu, çökme yok, yeniden deneme yok, saatte bir uyarı', async () => {
  const clock = createFakeClock();

  const runReturnCase = async (guildOpts, { fillReturnChannel = false } = {}) => {
    const warns = [];
    const env = createMockActivityGuild(guildOpts);
    if (fillReturnChannel && env.returnChannel) {
      env.makeMember('filler_1', { voiceChannel: env.returnChannel });
    }
    const tracker = new ActivityTracker({
      config: makeTestConfig(),
      db: database,
      nowFn: clock.nowFn,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
      logger: { log: () => {}, warn: (m) => warns.push(m), error: () => {} },
    });
    tracker.guild = env.guild;

    const cs2Ch = env.channels.get('1571915418728271973');
    const m1 = env.makeMember('u_err1', { voiceChannel: cs2Ch });
    const p1 = env.makePresence(m1, [{ type: ActivityType.Playing, name: 'CS2' }]);
    tracker.handlePresenceUpdate(null, p1);
    await clock.advanceBy(15000);
    const p2 = env.makePresence(m1, [], { status: 'online' });
    tracker.handlePresenceUpdate(p1, p2);
    await clock.advanceBy(5000);

    // Aynı hata ikinci kez oluşursa saatte bir uyarı kısıtı çalışmalı
    const m2 = env.makeMember('u_err2', { voiceChannel: cs2Ch });
    const p3 = env.makePresence(m2, [{ type: ActivityType.Playing, name: 'CS2' }]);
    tracker.handlePresenceUpdate(null, p3);
    await clock.advanceBy(15000);
    const p4 = env.makePresence(m2, [], { status: 'online' });
    tracker.handlePresenceUpdate(p3, p4);
    await clock.advanceBy(5000);

    const decision = tracker.getLastDecision('u_err1');
    const movesCount = env.apiLog.moves.length;
    await tracker.shutdown();
    return { decision, warns, movesCount };
  };

  // 1) Salon 1 yok -> RETURN_TARGET_NOT_FOUND, 2 olayda yalnızca 1 uyarı
  const resNotFound = await runReturnCase({ includeReturnChannel: false });
  assert.equal(resNotFound.decision?.reason, TRANSFER_REASONS.RETURN_TARGET_NOT_FOUND);
  assert.equal(resNotFound.warns.length, 1, 'Aynı sebep için uyarı saatte bir yazılmalı');
  assert.equal(resNotFound.movesCount, 0);

  // 2) Salon 1 dolu -> RETURN_TARGET_FULL
  const resFull = await runReturnCase({ returnChannelUserLimit: 1 }, { fillReturnChannel: true });
  assert.equal(resFull.decision?.reason, TRANSFER_REASONS.RETURN_TARGET_FULL);
  assert.equal(resFull.warns.length, 1);

  // 3) İzin yok (MoveMembers yok) -> RETURN_NO_PERMISSION
  const resNoPerm = await runReturnCase({ botHasMovePermission: false });
  assert.equal(resNoPerm.decision?.reason, TRANSFER_REASONS.RETURN_NO_PERMISSION);
  assert.equal(resNoPerm.warns.length, 1);

  // 4) API 50013 hatası -> RETURN_NO_PERMISSION, yeniden deneme yok
  const err50013 = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  const res50013 = await runReturnCase({ moveError: err50013 });
  assert.equal(res50013.decision?.reason, TRANSFER_REASONS.RETURN_NO_PERMISSION);
  assert.equal(res50013.warns.length, 1);

  // 5) API 40032 hatası -> sessizce RETURN_SKIPPED_NOT_IN_VOICE (uyarı logu yok)
  const err40032 = Object.assign(new Error('Target user is not connected to voice'), { code: 40032 });
  const res40032 = await runReturnCase({ moveError: err40032 });
  assert.equal(res40032.decision?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NOT_IN_VOICE);
  assert.equal(res40032.warns.length, 0);

  // 6) Diğer beklenmeyen hata -> RETURN_FAILED, yeniden deneme yok
  const err500 = Object.assign(new Error('Internal Server Error'), { code: 500 });
  const res500 = await runReturnCase({ moveError: err500 });
  assert.equal(res500.decision?.reason, TRANSFER_REASONS.RETURN_FAILED);
  assert.equal(res500.warns.length, 1);
});

test('R9. Bot yeniden başlar: açılış kimseyi taşımaz; yüklenen oturumda oyun bitince normal bitiş akışı çalışır', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  const cs2Ch = env.channels.get('1571915418728271973');
  const uSeed = env.makeMember('u_seed_end', { voiceChannel: cs2Ch });
  const pSeed = env.makePresence(uSeed, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]);

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

  // Açılışta hiç kimse taşınmamalı
  assert.equal(env.apiLog.moves.length, 0);
  assert.equal(tracker.sessions.get('u_seed_end')?.confirmed, true);
  assert.equal(uSeed.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);

  // Sonradan oyun bitince normal bitiş akışı rolü alıp Salon 1'e taşımalı
  const pStop = env.makePresence(uSeed, [], { status: 'online' });
  tracker.handlePresenceUpdate(pSeed, pStop);
  await clock.advanceBy(5000);
  assert.equal(uSeed.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(uSeed.voice.channelId, activityConfig.RETURN_CHANNEL_ID);
  assert.equal(tracker.getLastDecision('u_seed_end')?.reason, TRANSFER_REASONS.RETURN_MOVED);

  await tracker.shutdown();
});

test('R10. Kaçan presenceUpdate sweep ile 30 sn içinde yakalanır; 5 dk rol temizliği yalnız role.members\'tan alır ve taşımaz', async () => {
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
  await tracker.initForGuild(env.guild);

  // 1) Kaçan presenceUpdate: üye TSB kanalında, presence'ı boşaldı ama handlePresenceUpdate ÇAĞRILMADI
  const tsbCh = env.channels.get('1571912346773885050');
  const uMissed = env.makeMember('u_missed', { voiceChannel: tsbCh });
  const pStart = env.makePresence(uMissed, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pStart);
  await clock.advanceBy(15000);
  assert.equal(uMissed.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);

  // presenceUpdate olmadan canlı presence boşalır
  env.makePresence(uMissed, [], { status: 'online' });

  // t=15s -> 15 sn sonra (t=30s) ilk sweep çalıştığında bitiş zamanlayıcısı başlar (sweep doğrudan taşımaz!)
  await clock.advanceBy(15000);
  assert.equal(uMissed.voice.channelId, tsbCh.id, 'Sweep doğrudan Salon 1\'e taşımamalı');
  // 5 sn grace dolunca (t=35s) endSession rolü alır ve Salon 1'e taşır
  await clock.advanceBy(5000);
  assert.equal(uMissed.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(uMissed.voice.channelId, activityConfig.RETURN_CHANNEL_ID);
  assert.equal(tracker.getLastDecision('u_missed')?.reason, TRANSFER_REASONS.RETURN_MOVED);

  // 2) 5 dakikalık periyodik rol temizliği
  const movesBeforeCleanup = env.apiLog.moves.length;
  const zulaRoleId = activityConfig.FAMILIES.zula.roleId;
  const zulaCh = env.channels.get('1571914184860504074');

  // uStale: Zula rolü var, oturumu yok, online ve oyun oynamıyor -> rol ALINMALI, TAŞINMAMALI
  const uStale = env.makeMember('u_stale', { voiceChannel: zulaCh, roleIds: [zulaRoleId] });
  env.makePresence(uStale, [], { status: 'online' });

  // uOfflineRole: Zula rolü var, oturumu yok, offline -> belirsiz -> rol ALINMAMALI
  const uOfflineRole = env.makeMember('u_offrole', { voiceChannel: zulaCh, roleIds: [zulaRoleId] });
  env.makePresence(uOfflineRole, [], { status: 'offline' });

  // uNoPresRole: Zula rolü var, oturumu yok, presence null -> belirsiz -> rol ALINMAMALI
  const uNoPresRole = env.makeMember('u_nopresrole', { voiceChannel: zulaCh, roleIds: [zulaRoleId] });

  const cleanRes = await tracker.runPeriodicRoleCleanup(env.guild);
  assert.equal(cleanRes.removedCount, 1);
  assert.equal(uStale.roles.cache.has(zulaRoleId), false, 'Pasif rol alınmalı');
  assert.equal(uStale.voice.channelId, zulaCh.id, 'Periyodik temizlik Salon 1\'e taşımamalı');
  assert.equal(uOfflineRole.roles.cache.has(zulaRoleId), true, 'Offline üyenin rolüne dokunulmamalı');
  assert.equal(uNoPresRole.roles.cache.has(zulaRoleId), true, 'Presence olmayan üyenin rolüne dokunulmamalı');
  assert.equal(env.apiLog.moves.length, movesBeforeCleanup, 'Rol temizliği hiç taşıma yapmamalı');

  await tracker.shutdown();
});

test('R11 & R12. Salon 1\'e dönüş sonrası oyun yeniden açılınca yeni hak, bot taşıması tekrar tetiklemez; eşzamanlı endSession tek sefer ve öncelikli idempotent rol alma', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

  let trackerRef = null;
  const env = createMockActivityGuild({
    simulateVoiceEventOnBotMove: true,
    onBotMoveVoiceEvent: (o, n) => trackerRef?.handleVoiceStateUpdate(o, n),
  });

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
  trackerRef = tracker;
  tracker.guild = env.guild;

  // R11: TSB kanalında oyun biter -> Salon 1'e taşınır -> voiceStateUpdate yoksayılır -> oyun tekrar açılır -> yeni hakla TSB kanalına döner
  const tsbCh = env.channels.get('1571912346773885050');
  const uCycle = env.makeMember('u_cycle', { voiceChannel: tsbCh });
  const p1 = env.makePresence(uCycle, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, p1);
  await clock.advanceBy(15000);

  const p2 = env.makePresence(uCycle, [], { status: 'online' });
  tracker.handlePresenceUpdate(p1, p2);
  await clock.advanceBy(5000);
  assert.equal(uCycle.voice.channelId, activityConfig.RETURN_CHANNEL_ID);
  assert.equal(tracker.voiceDebounceTimers.has('u_cycle'), false, 'Botun Salon 1 taşıması yeni debounce başlatmamalı');

  // Üye Salon 1'deyken oyunu yeniden açar -> yeni oturum + yeni moveToken -> 15 sn onay + 10 sn geri sayım -> TSB'ye geri taşınır!
  const p3 = env.makePresence(uCycle, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(p2, p3);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u_cycle')?.moveToken, true);
  assert.equal(tracker.getLastDecision('u_cycle')?.reason, TRANSFER_REASONS.COUNTDOWN_PENDING);
  await clock.advanceBy(10000);
  assert.equal(uCycle.voice.channelId, tsbCh.id);
  assert.equal(tracker.getLastDecision('u_cycle')?.reason, TRANSFER_REASONS.MOVED);

  // R12a: Eşzamanlı endSession çağrıları tek sefer çalışır
  const cs2Ch = env.channels.get('1571915418728271973');
  const uLock = env.makeMember('u_lock', { voiceChannel: cs2Ch });
  const pL1 = env.makePresence(uLock, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tracker.handlePresenceUpdate(null, pL1);
  await clock.advanceBy(15000);

  env.makePresence(uLock, [], { status: 'online' });
  const endedBefore = tracker.counters.gamesEnded;
  const movesBefore = env.apiLog.moves.length;
  const removesBefore = env.apiLog.roleRemoves.length;

  await Promise.all([
    tracker.endSession('u_lock', { memberHint: uLock, guildHint: env.guild }),
    tracker.endSession('u_lock', { memberHint: uLock, guildHint: env.guild }),
    tracker.endSession('u_lock', { memberHint: uLock, guildHint: env.guild }),
  ]);

  assert.equal(tracker.counters.gamesEnded - endedBefore, 1, 'Aynı oturum yalnızca 1 kez bitmeli');
  assert.equal(env.apiLog.moves.length - movesBefore, 1, 'Yalnızca 1 kez Salon 1\'e taşınmalı');
  assert.equal(env.apiLog.roleRemoves.length - removesBefore, 1, 'Rol kaldırma tek sefer ve idempotent olmalı');

  // R12b: Rol kuyruğu yüksek öncelik testi (priority: true normal işlerin önüne geçer)
  const order = [];
  const pq = new activityTracker.RateLimitedQueue({
    maxConcurrency: 1,
    gapMs: 0,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    nowFn: clock.nowFn,
  });
  let releaseFirst;
  const firstGate = new Promise((r) => {
    releaseFirst = r;
  });
  const firstDone = pq.enqueue(async () => {
    order.push('running');
    await firstGate;
  });
  const normalTask = pq.enqueue(async () => order.push('normal'), { priority: false });
  const highTask = pq.enqueue(async () => order.push('high_remove'), { priority: true });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirst();
  await Promise.all([firstDone, normalTask, highTask]);
  assert.deepEqual(order, ['running', 'high_remove', 'normal']);

  await tracker.shutdown();
});

test('R13. Ayarlarım (≤5 düğme/satır, act_ret kalıcı/sahip/devre dışı, TR/EN), 🧪 RETURN_* açıklamaları, 🛠️ RETURN_CHANNEL_ID doğrulaması ve panel notu', async () => {
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

  const userM = env.makeMember('u_ui');
  const otherM = env.makeMember('u_other');
  const devM = env.makeMember('u_dev', { roleIds: [config.ROLES.DEVELOPER] });

  // 1) Düğme dizilimi (her satırda ≤5 düğme) ve TR/EN metinler
  const panelTr = aktivitemCmd.buildSettingsPanelPayload('u_ui', 'tr', null, database, {
    member: userM,
    guild: env.guild,
  });
  assert.equal(panelTr.components.length, 2);
  assert.ok(panelTr.components[0].toJSON().components.length <= 5);
  assert.ok(panelTr.components[1].toJSON().components.length <= 5);
  assert.match(panelTr.content, /Oyunu kapattığında oyun rolün alınır/);
  assert.equal(panelTr.components[0].toJSON().components[2].custom_id, 'act_ret:u_ui');
  assert.match(panelTr.components[0].toJSON().components[2].label, /Salon 1'e Dön: ✅ Açık/);

  const panelEn = aktivitemCmd.buildSettingsPanelPayload('u_ui', 'en', null, database, {
    member: userM,
    guild: env.guild,
  });
  assert.match(panelEn.content, /When you close your game your game role is removed/);
  assert.match(panelEn.components[0].toJSON().components[2].label, /Return to Lounge 1 after game: ✅ On/);

  // 2) Başkası basarsa reddedilir, ayar değişmez
  let otherReply = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_ret:u_ui',
      user: otherM.user,
      member: otherM,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        otherReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(otherReply.ephemeral, true);
  assert.equal(tracker.getPrefs('u_ui').returnToLobby, true);

  // 3) Sahibi basar -> kapanır ve yeniden başlatmada (database.init) kalıcı olur
  let updatedPanel = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_ret:u_ui',
      user: userM.user,
      member: userM,
      guild: env.guild,
      locale: 'tr',
      update: async (p) => {
        updatedPanel = p;
      },
    },
    { tracker, db: database }
  );
  assert.match(updatedPanel.components[0].toJSON().components[2].label, /❌ Kapalı/);
  database.data.activityPrefs = {};
  database.init();
  assert.equal(tracker.getPrefs('u_ui').returnToLobby, false, 'returnToLobby diskten geri yüklenmeli');

  // 4) autoMove kapalıyken act_ret düğmesi devre dışı (disabled) ve metinde açıklama var
  database.setActivityPrefs('u_ui', { autoMove: false });
  const disabledPanel = aktivitemCmd.buildSettingsPanelPayload('u_ui', 'tr', null, database, {
    member: userM,
    guild: env.guild,
  });
  assert.equal(disabledPanel.components[0].toJSON().components[2].disabled, true);
  assert.match(disabledPanel.content, /devre dışıdır/);

  // 5) 🧪 tüm RETURN_* açıklamaları (TR & EN) ve genel başlık
  const returnReasons = [
    TRANSFER_REASONS.RETURN_MOVED,
    TRANSFER_REASONS.RETURN_SKIPPED_NOT_IN_VOICE,
    TRANSFER_REASONS.RETURN_SKIPPED_NOT_GAME_CHANNEL,
    TRANSFER_REASONS.RETURN_SKIPPED_OTHER_GAME_ACTIVE,
    TRANSFER_REASONS.RETURN_SKIPPED_OPTED_OUT,
    TRANSFER_REASONS.RETURN_SKIPPED_NO_PRESENCE,
    TRANSFER_REASONS.RETURN_TARGET_NOT_FOUND,
    TRANSFER_REASONS.RETURN_TARGET_FULL,
    TRANSFER_REASONS.RETURN_NO_PERMISSION,
    TRANSFER_REASONS.RETURN_FAILED,
  ];
  for (const code of returnReasons) {
    tracker.recordDecision('u_ui', { trigger: 'game-ended', result: 'skipped', reason: code, game: 'CS2' });
    const whyTr = aktivitemCmd.buildWhyNotMovedPayload({ userId: 'u_ui', lang: 'tr', tracker });
    const whyEn = aktivitemCmd.buildWhyNotMovedPayload({ userId: 'u_ui', lang: 'en', tracker });
    assert.match(whyTr.content, /Son Karar/);
    assert.match(whyEn.content, /Last Decision/);
    assert.ok(whyTr.content.includes(code));
    assert.ok(!whyTr.content.includes('Sebep kodu:'), `${code} için TR açıklama tanımlı olmalı`);
    assert.ok(!whyEn.content.includes('Reason code:'), `${code} için EN açıklama tanımlı olmalı`);
  }

  // 6) 🛠️ Sistem Durumu: Salon 1 geçerli (✅) ve eksik/izin yok (⚠️) + kimliksiz RETURN sayaçları
  const sysOk = aktivitemCmd.buildSystemStatusPayload({
    guild: env.guild,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(sysOk.content, /✅ \*\*Dönüş Kanalı \(Salon 1\):\*\*/);
  assert.match(sysOk.content, /RETURN_MOVED=/);
  assert.match(sysOk.content, /oyunBitti=/);
  assert.match(sysOk.content, /rolAlındı=/);

  const missingRetEnv = createMockActivityGuild({ includeReturnChannel: false });
  const sysWarn = aktivitemCmd.buildSystemStatusPayload({
    guild: missingRetEnv.guild,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(sysWarn.content, /⚠️ \*\*Dönüş Kanalı \(Salon 1\):\*\*/);

  // Developer panelinde Satır 2'de 3 düğme olmalı (≤5)
  const devPanel = aktivitemCmd.buildSettingsPanelPayload('u_dev', 'tr', null, database, {
    member: devM,
    guild: env.guild,
  });
  assert.equal(devPanel.components[1].toJSON().components.length, 3);

  // Kayıt paneli notu Salon 1 dönüşünü de kapsamalı, customId'ler korunmalı
  const regPanel = createRegisterPanel();
  const regDesc = regPanel.embeds.map((e) => e.toJSON().description).join('\n');
  assert.match(regDesc, /Salon 1/);
  assert.match(regDesc, /Lounge 1/);
  assert.equal(regPanel.components[0].toJSON().components[0].custom_id, 'btn_kayit_ol');
  assert.equal(regPanel.components[0].toJSON().components[1].custom_id, 'btn_kayit_ol_en');

  await tracker.shutdown();
});

test('R14 & R15. Tek seferlik dönüş duyurusu (etiketsiz, hata durumunda tekrar dener) ve gizlilik / kalıcı veri + konsol log kontrolü', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T20:00:00Z'));
  const loggedLines = [];
  const captureLogger = {
    log: (m) => loggedLines.push(String(m)),
    warn: (m) => loggedLines.push(String(m)),
    error: (m) => loggedLines.push(String(m)),
  };

  // R14a: Gönderim başarısız olursa returnAnnouncedAt İŞARETLENMEZ, sonra tekrar denenir
  const curMonth = database.getCurrentIstanbulMonth();
  database.data.activityMeta = {
    announcedAt: Date.now(),
    returnAnnouncedAt: null,
    manualAnnouncedAt: Date.now(),
    voiceRoleAnnouncedAt: Date.now(),
    lastResetMonth: curMonth,
  };
  database.save();

  const failEnv = createMockActivityGuild({ commandChannelCanSend: false });
  const tFail = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: captureLogger,
  });
  const failRes = await tFail.checkOneTimeReturnAnnouncement(failEnv.guild);
  assert.equal(failRes.announced, false);
  assert.equal(database.getActivityMeta().returnAnnouncedAt, null, 'Başarısız gönderimde işaretlenmemeli');
  await tFail.shutdown();

  // R14b: Komut kanalı erişilebilir olunca tek sefer gider, kimseyi etiketlemez, diskte kalıcı olur
  const okEnv = createMockActivityGuild();
  const tOk = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: captureLogger,
  });
  await tOk.initForGuild(okEnv.guild);
  assert.equal(okEnv.apiLog.commandMessages.length, 1);
  assert.deepEqual(okEnv.apiLog.commandMessages[0].allowedMentions, { parse: [] });
  assert.match(okEnv.apiLog.commandMessages[0].content, /Salon 1'e aktarılırsın/);
  assert.match(okEnv.apiLog.commandMessages[0].content, /Lounge 1/);
  assert.ok(typeof database.getActivityMeta().returnAnnouncedAt === 'number');

  // Diskten yeniden yükle ve tekrar çağır -> ikinci kez gönderilmemeli
  database.data.activityMeta = { announcedAt: null, returnAnnouncedAt: null, lastResetMonth: '1999-01' };
  database.init();
  assert.ok(typeof database.getActivityMeta().returnAnnouncedAt === 'number', 'returnAnnouncedAt diskte kalıcı olmalı');
  const secondRes = await tOk.checkOneTimeReturnAnnouncement(okEnv.guild);
  assert.equal(secondRes.announced, false);
  assert.equal(okEnv.apiLog.commandMessages.length, 1, 'Duyuru ikinci kez gönderilmemeli');

  // R15: Oyun + bitiş + saatlik log sonrası diskte geçmiş/karar izi ve loglarda kullanıcı kimliği OLMAMALI
  const tsbCh = okEnv.channels.get('1571912346773885050');
  const uPriv = okEnv.makeMember('999888777666', { voiceChannel: tsbCh });
  const p1 = okEnv.makePresence(uPriv, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tOk.handlePresenceUpdate(null, p1);
  await clock.advanceBy(15000);
  const p2 = okEnv.makePresence(uPriv, [], { status: 'online' });
  tOk.handlePresenceUpdate(p1, p2);
  await clock.advanceBy(5000);

  tOk.logCounterSummary('test özeti');
  const lastLog = loggedLines[loggedLines.length - 1];
  assert.match(lastLog, /oyunBitti=1/);
  assert.match(lastLog, /rolAlındı=1/);
  assert.match(lastLog, /RETURN_MOVED=1/);
  assert.equal(loggedLines.join('\n').includes('999888777666'), false, 'Konsol loglarında kullanıcı ID olmamalı');

  database.save();
  const diskJson = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  assert.equal(diskJson.lastDecisions, undefined);
  assert.equal(diskJson.counters, undefined);
  assert.equal(diskJson.activityHistory, undefined);
  assert.equal(diskJson.activitySessions, undefined);
  assert.equal(diskJson.returnHistory, undefined);
  assert.ok(diskJson.activityPrefs && diskJson.activityStats && diskJson.activityMeta);

  await tOk.shutdown();
});
