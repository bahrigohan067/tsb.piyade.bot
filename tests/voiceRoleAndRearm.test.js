const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ActivityType,
  ChannelType,
  Collection,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

// Testler için izole geçici veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-voice-role-rearm-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const activityConfig = require('../activity.config');
const database = require('../src/utils/database');
const activityTracker = require('../src/utils/activityTracker');
const aktivitemCmd = require('../src/commands/aktivitem');
const oyunCmd = require('../src/commands/oyun');

const { ActivityTracker, TRANSFER_REASONS } = activityTracker;

/**
 * Deterministik sahte saat ve zamanlayıcı yardımcısı.
 */
function createFakeClock(startMs = Date.parse('2026-11-23T15:00:00Z')) {
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
    setTimeoutFn,
    clearTimeoutFn,
    setIntervalFn,
    clearIntervalFn,
    advanceBy,
  };
}

/**
 * Sahte Discord Sunucusu (roller, ses kanalları, komut kanalı ve üyeler).
 */
function createMockGuild({
  commandChannelCanSend = true,
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
  };

  for (const [, fam] of Object.entries(activityConfig.FAMILIES)) {
    roles.set(fam.roleId, {
      id: fam.roleId,
      name: `${fam.emoji} ${fam.name.tr}`,
      position: 10,
      members: new Collection(),
    });
  }
  roles.set(config.ROLES.DEVELOPER, {
    id: config.ROLES.DEVELOPER,
    name: '💻| DEVELOPER',
    position: 45,
    members: new Collection(),
  });

  function makeVoiceChannel(id, name, type = ChannelType.GuildVoice) {
    const ch = {
      id,
      name,
      type,
      userLimit: 0,
      members: new Collection(),
      permissionsFor: () => ({ has: () => true }),
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
  const returnChannel = makeVoiceChannel(activityConfig.RETURN_CHANNEL_ID, '🔊 Salon 1');
  const lobbyChannel = makeVoiceChannel('voice_lobby_1', '🔊 Sohbet 1');
  const lobbyChannel2 = makeVoiceChannel('voice_lobby_2', '🔊 Sohbet 2');
  const afkChannel = makeVoiceChannel('voice_afk_1', '💤 AFK');

  let msgSeq = 1;
  const commandChannel = {
    id: activityConfig.COMMAND_CHANNEL_ID,
    name: 'bot-komut',
    type: ChannelType.GuildText,
    permissionsFor: () => ({
      has: (p) => !(p === PermissionFlagsBits.SendMessages && !commandChannelCanSend),
    }),
    send: async (payload) => {
      if (!commandChannelCanSend) {
        const err = new Error('Missing Access');
        err.code = 50013;
        throw err;
      }
      const msg = {
        id: `cmd_${msgSeq++}`,
        content: payload.content,
        components: payload.components || [],
        allowedMentions: payload.allowedMentions,
        deleted: false,
        delete: async () => {
          msg.deleted = true;
        },
      };
      apiLog.commandMessages.push(msg);
      return msg;
    },
  };
  channels.set(commandChannel.id, commandChannel);

  const guild = {
    id: '1559313292651008040',
    afkChannelId: afkChannel.id,
    roles: { cache: roles },
    channels: { cache: channels },
    members: {
      cache: members,
      me: {
        id: 'bot_id',
        roles: { highest: { position: 50 } },
        permissions: { has: () => true },
      },
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

  function syncVoiceState(member) {
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

  function makeMember(id, { roleIds = [], voiceChannel = null, bot = false } = {}) {
    const roleMap = new Collection();
    for (const rid of roleIds) {
      const rObj = roles.get(rid) || { id: rid, name: rid, members: new Collection() };
      roleMap.set(rid, rObj);
    }

    const member = {
      id: String(id),
      guild,
      displayName: `User_${id}`,
      user: {
        id: String(id),
        username: `user_${id}`,
        globalName: `User_${id}`,
        bot,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/a.png`,
      },
      presence: null,
      permissions: { has: () => false },
      voice: {
        channelId: voiceChannel ? voiceChannel.id : null,
        channel: voiceChannel || null,
        setChannel: async (targetId, reason) => {
          const prev = member.voice.channel;
          const oldState = {
            id: member.id,
            member,
            guild,
            channelId: prev ? prev.id : null,
            channel: prev,
          };
          if (prev) prev.members.delete(member.id);
          const next = channels.get(targetId) || null;
          member.voice.channelId = next ? next.id : null;
          member.voice.channel = next;
          if (next) next.members.set(member.id, member);
          syncVoiceState(member);
          apiLog.moves.push({ userId: member.id, targetId, reason });
          if (simulateVoiceEventOnBotMove && typeof onBotMoveVoiceEvent === 'function') {
            onBotMoveVoiceEvent(oldState, {
              id: member.id,
              member,
              guild,
              channelId: member.voice.channelId,
              channel: member.voice.channel,
            });
          }
        },
      },
      roles: {
        cache: roleMap,
        add: async (roleId, reason) => {
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
    syncVoiceState(member);
    members.set(member.id, member);
    return member;
  }

  function makePresence(member, activities = [], { status = 'online' } = {}) {
    const p = { userId: member.id, user: member.user, member, guild, status, activities };
    member.presence = p;
    presences.set(member.id, p);
    return p;
  }

  function moveVoice(member, nextChannel) {
    const oldState = {
      id: member.id,
      member,
      guild,
      channelId: member.voice.channelId,
      channel: member.voice.channel,
    };
    if (member.voice.channel) member.voice.channel.members.delete(member.id);
    member.voice.channelId = nextChannel ? nextChannel.id : null;
    member.voice.channel = nextChannel || null;
    if (nextChannel) nextChannel.members.set(member.id, member);
    syncVoiceState(member);
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
    returnChannel,
    lobbyChannel,
    lobbyChannel2,
    afkChannel,
    apiLog,
    makeMember,
    makePresence,
    moveVoice,
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
  };
}

function makeTracker(clock, overrides = {}, logger = { log: () => {}, warn: () => {}, error: () => {} }) {
  return new ActivityTracker({
    config: makeTestConfig(overrides),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger,
  });
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
  oyunCmd.resetManualButtonCooldowns();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

// =========================================================================
// V1, V2, V3, V4: SES ŞARTLI ROL VERME VE GERİ SAYIM KURALLARI
// =========================================================================

test('V1 & V2. Ses dışında oyun açılınca rol VERİLMEZ (ROLE_WAITING_FOR_VOICE); sese girince 3 sn sonra rol verilir + geri sayım -> taşınır', async () => {
  const clock = createFakeClock();
  const env = createMockGuild();
  const tracker = makeTracker(clock);
  tracker.guild = env.guild;

  // V1: Ses dışında TSB açılır -> 15 sn CONFIRM sonrası rol YOK, geri sayım YOK, karar izi ROLE_WAITING_FOR_VOICE
  const u = env.makeMember('u_v12', { voiceChannel: null });
  tracker.handlePresenceUpdate(null, env.makePresence(u, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]));
  await clock.advanceBy(15000);

  assert.equal(tracker.sessions.get('u_v12')?.confirmed, true);
  assert.equal(u.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false, 'Ses dışında rol verilmemeli');
  assert.equal(tracker.activeCountdowns.has('u_v12'), false, 'Ses dışında geri sayım olmamalı');
  assert.equal(env.apiLog.commandMessages.length, 0);
  assert.equal(tracker.getLastDecision('u_v12')?.reason, TRANSFER_REASONS.ROLE_WAITING_FOR_VOICE);

  // V2: Üye herhangi bir ses kanalına (lobbyChannel) girer -> 3 sn sonra rol verilir ve 10 sn geri sayımla TSB kanalına taşınır
  const { oldState, newState } = env.moveVoice(u, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(oldState, newState);
  await clock.advanceBy(3000);
  assert.equal(u.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true, 'Sese girince rol verilmeli');
  assert.equal(tracker.activeCountdowns.has('u_v12'), true, 'Geri sayım başlamalı');

  await clock.advanceBy(10000);
  assert.equal(u.voice.channelId, '1571912346773885050', 'TSB kanalına taşınmalı');
  assert.equal(tracker.getLastDecision('u_v12')?.reason, TRANSFER_REASONS.MOVED);

  await tracker.shutdown();
});

test('V3 & V4. Sesteyken oyun açma + sese oyunda değilken girme (sıfır geri sayım/rol) -> sonra oyun açma', async () => {
  const clock = createFakeClock();
  const env = createMockGuild();
  const tracker = makeTracker(clock);
  tracker.guild = env.guild;

  // V3: Sesteyken CS2 açılır -> 15 sn onayda rol + geri sayım + 10 sn sonra CS2 kanalına taşıma
  const u3 = env.makeMember('u_v3', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(u3, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]));
  await clock.advanceBy(15000);
  assert.equal(u3.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);
  assert.equal(tracker.activeCountdowns.has('u_v3'), true);
  await clock.advanceBy(10000);
  assert.equal(u3.voice.channelId, '1571915418728271973');

  // V4: Üye sese girer ama oyunda DEĞİL -> hiçbir geri sayım/mesaj/rol (NOT_PLAYING)
  const u4 = env.makeMember('u_v4', { voiceChannel: null });
  env.makePresence(u4, [], { status: 'online' });
  const msgCountBeforeV4 = env.apiLog.commandMessages.length;
  const { oldState, newState } = env.moveVoice(u4, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(oldState, newState);
  await clock.advanceBy(5000);
  assert.equal(tracker.activeCountdowns.has('u_v4'), false);
  assert.equal(env.apiLog.commandMessages.length, msgCountBeforeV4);
  assert.equal(u4.roles.cache.size, 0);
  assert.equal(tracker.getLastDecision('u_v4')?.reason, TRANSFER_REASONS.NOT_PLAYING);

  // Sonra Zula açar -> 15 sn onayda rol + geri sayım + taşıma
  tracker.handlePresenceUpdate(
    u4.presence,
    env.makePresence(u4, [{ type: ActivityType.Playing, name: 'Zula' }])
  );
  await clock.advanceBy(15000);
  assert.equal(u4.roles.cache.has(activityConfig.FAMILIES.zula.roleId), true);
  assert.equal(tracker.activeCountdowns.has('u_v4'), true);
  await clock.advanceBy(10000);
  assert.equal(u4.voice.channelId, '1571914184860504074');

  await tracker.shutdown();
});

// =========================================================================
// V5, V6, V7, V8, V9, V10: SESTEN DÜŞÜNCE YENİDEN AKTARMA (REARM) VE SINIRLAR
// =========================================================================

test('V5, V6, V7 & V9. Sesten düşüp girince yeniden aktarma, iptalin kalıcı olması, kanal değiştirmenin silahlandırmaması ve hedef kanala dönüş', async () => {
  const clock = createFakeClock();
  const env = createMockGuild();
  const tracker = makeTracker(clock);
  tracker.guild = env.guild;

  const zulaChId = '1571914184860504074';
  const zulaCh = env.channels.get(zulaChId);

  // V5: Taşındıktan sonra sesten TAMAMEN düşer (channel -> null), oyun sürüyor -> REARMED_AFTER_DISCONNECT -> tekrar girince 3 sn + 10 sn yeniden taşınır
  const u5 = env.makeMember('u_v5', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(u5, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  await clock.advanceBy(10000);
  assert.equal(u5.voice.channelId, zulaChId);
  assert.equal(tracker.sessions.get('u_v5')?.moveState, 'moved');

  // 35 sn geçsin (REARM_MIN_GAP_SEC aşılır) sonra sesten tamamen düşsün
  await clock.advanceBy(35000);
  const disc5 = env.moveVoice(u5, null);
  tracker.handleVoiceStateUpdate(disc5.oldState, disc5.newState);
  assert.equal(tracker.sessions.get('u_v5')?.moveState, 'unspent');
  assert.equal(tracker.sessions.get('u_v5')?.rearmCount, 1);
  assert.equal(tracker.getLastDecision('u_v5')?.reason, TRANSFER_REASONS.REARMED_AFTER_DISCONNECT);

  // Başka bir kanala girer -> 3 sn debounce -> 10 sn geri sayım -> Zula kanalına tekrar taşınır!
  const join5 = env.moveVoice(u5, env.lobbyChannel2);
  tracker.handleVoiceStateUpdate(join5.oldState, join5.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v5'), true);
  await clock.advanceBy(10000);
  assert.equal(u5.voice.channelId, zulaChId);

  // V7: Taşındıktan sonra elle kanaldan kanala geçer (disconnect YOK) -> yeniden aktarma YOK (TOKEN_SPENT)
  const sw7 = env.moveVoice(u5, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(sw7.oldState, sw7.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v5'), false);
  assert.equal(tracker.getLastDecision('u_v5')?.reason, TRANSFER_REASONS.TOKEN_SPENT);

  // V9: Düşer -> rearmed -> doğrudan hedef kanal olan Zula'ya geri girer -> ALREADY_IN_TARGET, geri sayım yok, moveState = 'inTarget'
  await clock.advanceBy(35000);
  const disc9 = env.moveVoice(u5, null);
  tracker.handleVoiceStateUpdate(disc9.oldState, disc9.newState);
  assert.equal(tracker.sessions.get('u_v5')?.moveState, 'unspent');
  const joinTarget9 = env.moveVoice(u5, zulaCh);
  tracker.handleVoiceStateUpdate(joinTarget9.oldState, joinTarget9.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v5'), false);
  assert.equal(tracker.getLastDecision('u_v5')?.reason, TRANSFER_REASONS.ALREADY_IN_TARGET);
  assert.equal(tracker.sessions.get('u_v5')?.moveState, 'inTarget');

  // V6: İptal ettikten sonra düşüp girer -> geri sayım YOK (iptal kalıcı!), karar izi TOKEN_SPENT
  const u6 = env.makeMember('u_v6', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(u6, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  const cd6 = tracker.activeCountdowns.get('u_v6');
  assert.ok(cd6);

  await tracker.handleCancelTransferButton({
    customId: `act_cancel:u_v6:${cd6.token}`,
    user: u6.user,
    locale: 'tr',
    update: async () => {},
  });
  assert.equal(tracker.sessions.get('u_v6')?.moveState, 'cancelled');

  // Düşer ve tekrar girer -> yeniden silahlanmaz!
  await clock.advanceBy(40000);
  const disc6 = env.moveVoice(u6, null);
  tracker.handleVoiceStateUpdate(disc6.oldState, disc6.newState);
  assert.equal(tracker.sessions.get('u_v6')?.moveState, 'cancelled', 'İptal oturum boyunca kalıcı olmalı');

  const join6 = env.moveVoice(u6, env.lobbyChannel2);
  tracker.handleVoiceStateUpdate(join6.oldState, join6.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v6'), false);
  assert.equal(tracker.getLastDecision('u_v6')?.reason, TRANSFER_REASONS.TOKEN_SPENT);

  await tracker.shutdown();
});

test('V8 & V10. REARM_MIN_GAP_SEC (30 sn) + otomatik tekrar değerlendirme, REARM_MAX_PER_SESSION (3) limiti, yeni oturum sıfırlama ve geri sayımda düşüp girme', async () => {
  const clock = createFakeClock();
  const env = createMockGuild();
  const tracker = makeTracker(clock);
  tracker.guild = env.guild;

  const cs2ChId = '1571915418728271973';

  // V8: İlk taşıma t=15s -> geri sayım t=15s'de başlar, t=25s'de taşınır
  const u8 = env.makeMember('u_v8', { voiceChannel: env.lobbyChannel });
  const pCs2 = env.makePresence(u8, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tracker.handlePresenceUpdate(null, pCs2);
  await clock.advanceBy(15000); // t=15s: Countdown #0
  await clock.advanceBy(10000); // t=25s: moved
  assert.equal(u8.voice.channelId, cs2ChId);

  // Hemen t=27s'de düşüp girer (son geri sayımdan sadece 15 sn geçti < 30 sn!) -> REARM_RATE_LIMITED!
  await clock.advanceBy(2000); // t=27s
  const d1 = env.moveVoice(u8, null);
  tracker.handleVoiceStateUpdate(d1.oldState, d1.newState);
  assert.equal(tracker.sessions.get('u_v8')?.rearmCount, 1);

  const j1 = env.moveVoice(u8, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(j1.oldState, j1.newState);
  await clock.advanceBy(3000); // t=30s (son geri sayım t=15s idi -> 15s < 30s!)
  assert.equal(tracker.getLastDecision('u_v8')?.reason, TRANSFER_REASONS.REARM_RATE_LIMITED);
  assert.equal(tracker.activeCountdowns.has('u_v8'), false);

  // Kalan 15 sn dolunca (t=45s) otomatik yeniden değerlendirme devreye girip geri sayım başlatır -> t=55s'de taşınır!
  await clock.advanceBy(15000); // t=45s: Countdown #1
  assert.equal(tracker.activeCountdowns.has('u_v8'), true, 'REARM_MIN_GAP_SEC dolunca otomatik geri sayım başlamalı');
  await clock.advanceBy(10000); // t=55s: moved
  assert.equal(u8.voice.channelId, cs2ChId);

  // Rearm #2 (30 sn arayla)
  await clock.advanceBy(35000);
  const d2 = env.moveVoice(u8, null);
  tracker.handleVoiceStateUpdate(d2.oldState, d2.newState);
  assert.equal(tracker.sessions.get('u_v8')?.rearmCount, 2);
  const j2 = env.moveVoice(u8, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(j2.oldState, j2.newState);
  await clock.advanceBy(3000);
  await clock.advanceBy(10000);
  assert.equal(u8.voice.channelId, cs2ChId);

  // Rearm #3 (son hak)
  await clock.advanceBy(35000);
  const d3 = env.moveVoice(u8, null);
  tracker.handleVoiceStateUpdate(d3.oldState, d3.newState);
  assert.equal(tracker.sessions.get('u_v8')?.rearmCount, 3);
  const j3 = env.moveVoice(u8, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(j3.oldState, j3.newState);
  await clock.advanceBy(3000);
  await clock.advanceBy(10000);
  assert.equal(u8.voice.channelId, cs2ChId);

  // 4. düşüş -> sınır (3) doldu -> REARM_LIMIT_REACHED, yeniden silahlanma YOK!
  await clock.advanceBy(35000);
  const d4 = env.moveVoice(u8, null);
  tracker.handleVoiceStateUpdate(d4.oldState, d4.newState);
  assert.equal(tracker.getLastDecision('u_v8')?.reason, TRANSFER_REASONS.REARM_LIMIT_REACHED);
  assert.equal(tracker.sessions.get('u_v8')?.moveState, 'moved');

  const j4 = env.moveVoice(u8, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(j4.oldState, j4.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v8'), false);
  assert.equal(tracker.getLastDecision('u_v8')?.reason, TRANSFER_REASONS.TOKEN_SPENT);

  // Yeni oyun oturumu (Zula'ya geçiş) -> rearmCount ve moveState sıfırlanır!
  tracker.handlePresenceUpdate(pCs2, env.makePresence(u8, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u_v8')?.rearmCount, 0);
  assert.equal(tracker.activeCountdowns.has('u_v8'), true);
  await clock.advanceBy(10000);
  assert.equal(u8.voice.channelId, '1571914184860504074');

  // V10: Geri sayım sürerken düşüp girer -> eski iptal (hak tükenmez), yeni girişte tek geri sayım, çift mesaj yok
  const u10 = env.makeMember('u_v10', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(u10, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.activeCountdowns.has('u_v10'), true);
  const firstMsg = tracker.activeCountdowns.get('u_v10').message;

  await clock.advanceBy(3000);
  const leave10 = env.moveVoice(u10, null);
  tracker.handleVoiceStateUpdate(leave10.oldState, leave10.newState);
  assert.equal(firstMsg.deleted, true, 'Eski geri sayım mesajı silinmeli');
  assert.equal(tracker.sessions.get('u_v10')?.moveState, 'unspent', 'Geri sayımda düşmek hakkı tüketmemeli');

  const rejoin10 = env.moveVoice(u10, env.lobbyChannel2);
  tracker.handleVoiceStateUpdate(rejoin10.oldState, rejoin10.newState);
  await clock.advanceBy(3000);
  assert.equal(tracker.activeCountdowns.has('u_v10'), true, 'Yeni girişte yeni geri sayım başlamalı');
  await clock.advanceBy(10000);
  assert.equal(u10.voice.channelId, cs2ChId);

  await tracker.shutdown();
});

// =========================================================================
// V11, V12, V13, V14, V15, V16: ROL KURALLARI, AÇILIŞ, SWEEP, /oyun, GERİ DÖNÜŞ ANAHTARI
// =========================================================================

test('V11 & V12. ROLE_REMOVE_ON_VOICE_LEAVE (false vs true + manuel /oyun koruması) ve /oyun ses şartından muafiyeti', async () => {
  const clock = createFakeClock();
  const env = createMockGuild();
  const cs2Role = activityConfig.FAMILIES.cs2.roleId;
  const robloxRole = activityConfig.FAMILIES.roblox.roleId;

  // V11a: ROLE_REMOVE_ON_VOICE_LEAVE: false (varsayılan) -> sesten çıkınca rol kalır, oyun bitince alınır ve Salon 1'e taşınmaz
  const tDefault = makeTracker(clock, { ROLE_REMOVE_ON_VOICE_LEAVE: false });
  tDefault.guild = env.guild;
  const u11a = env.makeMember('u_v11a', { voiceChannel: env.afkChannel });
  const p1 = env.makePresence(u11a, [{ type: ActivityType.Playing, name: 'CS2' }]);
  tDefault.handlePresenceUpdate(null, p1);
  await clock.advanceBy(15000);
  assert.equal(u11a.roles.cache.has(cs2Role), true);

  const l11a = env.moveVoice(u11a, null);
  tDefault.handleVoiceStateUpdate(l11a.oldState, l11a.newState);
  await clock.advanceBy(1000);
  assert.equal(u11a.roles.cache.has(cs2Role), true, 'Varsayılan false iken sesten çıkınca rol kalmalı');

  tDefault.handlePresenceUpdate(p1, env.makePresence(u11a, [], { status: 'online' }));
  await clock.advanceBy(5000);
  assert.equal(u11a.roles.cache.has(cs2Role), false, 'Oyun bitince rol alınmalı');
  assert.equal(tDefault.getLastDecision('u_v11a')?.reason, TRANSFER_REASONS.RETURN_SKIPPED_NOT_IN_VOICE);
  await tDefault.shutdown();

  // V11b: ROLE_REMOVE_ON_VOICE_LEAVE: true -> sesten çıkınca otomatik CS2 rolü alınır AMA manuel /oyun Roblox rolü ALINMAZ!
  const tRemove = makeTracker(clock, { ROLE_REMOVE_ON_VOICE_LEAVE: true });
  tRemove.guild = env.guild;
  const u11b = env.makeMember('u_v11b', { voiceChannel: env.afkChannel, roleIds: [robloxRole] });
  database.setManualActivityRole('u_v11b', 'roblox', { immediate: true });
  tRemove.handlePresenceUpdate(null, env.makePresence(u11b, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  assert.equal(u11b.roles.cache.has(cs2Role), true);

  const l11b = env.moveVoice(u11b, null);
  tRemove.handleVoiceStateUpdate(l11b.oldState, l11b.newState);
  await clock.advanceBy(1000);
  assert.equal(u11b.roles.cache.has(cs2Role), false, 'ROLE_REMOVE_ON_VOICE_LEAVE=true iken otomatik rol alınmalı');
  assert.equal(u11b.roles.cache.has(robloxRole), true, 'Manuel /oyun rolüne dokunulmamalı');
  await tRemove.shutdown();

  // V12: /oyun manuel rolü ses kanalında OLMADAN verilir ve 00:00 temizliği çalışır
  const tMob = makeTracker(clock);
  tMob.guild = env.guild;
  const uMob = env.makeMember('u_v12_mob', { voiceChannel: null });
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_v12_mob',
      user: uMob.user,
      member: uMob,
      guild: env.guild,
      locale: 'tr',
      update: async () => {},
    },
    { tracker: tMob, db: database }
  );
  assert.equal(uMob.roles.cache.has(robloxRole), true, '/oyun ses kanalına bakmadan rol vermeli');
  assert.equal(database.hasManualActivityRole('u_v12_mob', 'roblox'), true);
  await tMob.shutdown();
});

test('V13, V14, V15 & V16. Açılış, sweep, 5 dk temizlik koruması, tracking/autoMove/bot-move ve ROLE_REQUIRES_VOICE: false', async () => {
  const clock = createFakeClock();
  const cs2Role = activityConfig.FAMILIES.cs2.roleId;
  const zulaRole = activityConfig.FAMILIES.zula.roleId;
  const robloxRole = activityConfig.FAMILIES.roblox.roleId;

  // V13: Açılışta seste oynayana rol verilir (taşınmaz); seste olmayan oynayana rol VERİLMEZ; mevcut rolü olan kimseden rol ALINMAZ!
  const env13 = createMockGuild();
  const uInVoice = env13.makeMember('u_s_in', { voiceChannel: env13.lobbyChannel, roleIds: [zulaRole] });
  env13.makePresence(uInVoice, [{ type: ActivityType.Playing, name: 'CS2' }]);
  const uOutVoice = env13.makeMember('u_s_out', { voiceChannel: null });
  env13.makePresence(uOutVoice, [{ type: ActivityType.Playing, name: 'CS2' }]);
  const uKeepRole = env13.makeMember('u_s_keep', { voiceChannel: null, roleIds: [robloxRole] });
  env13.makePresence(uKeepRole, [{ type: ActivityType.Playing, name: 'Roblox Player' }]);

  const t13 = makeTracker(clock);
  await t13.initForGuild(env13.guild);
  assert.equal(env13.apiLog.moves.length, 0, 'Açılışta hiç kimse taşınmamalı');
  assert.equal(uInVoice.roles.cache.has(cs2Role), true, 'Seste ve oynayan üyeye eksik rol sessizce verilmeli');
  assert.equal(uInVoice.roles.cache.has(zulaRole), true, 'Açılışta mevcut rollerden hiçbiri alınmamalı');
  assert.equal(uOutVoice.roles.cache.has(cs2Role), false, 'Seste olmayan oynayana açılışta rol verilmemeli');
  assert.equal(uKeepRole.roles.cache.has(robloxRole), true, 'Mevcut rolü olan üyeden rol alınmamalı');

  // V14: Sweep seste, oynayan, rolü eksik üyeye rol verir; bekleyen geri sayımı olana çift geri sayım başlatmaz;
  // 5 dk temizlik seste olmayan ama oynayan ve rolü olan üyeden (uKeepRole) rolü ALMAZ!
  await uInVoice.roles.remove(cs2Role);
  assert.equal(uInVoice.roles.cache.has(cs2Role), false);
  await t13.runSweep(env13.guild);
  assert.equal(uInVoice.roles.cache.has(cs2Role), true, 'Sweep seste oynayan üyenin eksik rolünü tamamlamalı');

  // Bekleyen geri sayım varken sweep ikinci geri sayım açmaz
  const uCd = env13.makeMember('u_v14_cd', { voiceChannel: env13.lobbyChannel });
  t13.handlePresenceUpdate(null, env13.makePresence(uCd, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  assert.equal(t13.activeCountdowns.has('u_v14_cd'), true);
  const msgsBeforeSweep = env13.apiLog.commandMessages.length;
  await t13.runSweep(env13.guild);
  assert.equal(env13.apiLog.commandMessages.length, msgsBeforeSweep, 'Sweep çift geri sayım açmamalı');

  // 5 dakikalık temizlik seste olmayan ama oynayan ve rolü olan uKeepRole'den rolü ALMAZ
  await t13.runPeriodicRoleCleanup(env13.guild);
  assert.equal(uKeepRole.roles.cache.has(robloxRole), true, '5 dk temizlik oynayan ve rolü olan üyeden rolü almamalı');
  await t13.shutdown();

  // V15: tracking/autoMove kapalı + botun kendi taşıması yeniden silahlanma tetiklemez
  let t15Ref = null;
  const env15 = createMockGuild({
    simulateVoiceEventOnBotMove: true,
    onBotMoveVoiceEvent: (o, n) => t15Ref?.handleVoiceStateUpdate(o, n),
  });
  const t15 = makeTracker(clock);
  t15Ref = t15;
  t15.guild = env15.guild;

  const uNoTrack = env15.makeMember('u_nt', { voiceChannel: env15.lobbyChannel });
  database.setActivityPrefs('u_nt', { tracking: false });
  t15.handlePresenceUpdate(null, env15.makePresence(uNoTrack, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(20000);
  assert.equal(uNoTrack.roles.cache.has(cs2Role), false);
  assert.equal(t15.activeCountdowns.has('u_nt'), false);

  const uNoMove = env15.makeMember('u_nm', { voiceChannel: env15.lobbyChannel });
  database.setActivityPrefs('u_nm', { autoMove: false });
  t15.handlePresenceUpdate(null, env15.makePresence(uNoMove, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  assert.equal(t15.activeCountdowns.has('u_nm'), false);
  const discNm = env15.moveVoice(uNoMove, null);
  t15.handleVoiceStateUpdate(discNm.oldState, discNm.newState);
  assert.equal(t15.counters.reasons.REARMED_AFTER_DISCONNECT, 0, 'autoMove kapalıyken yeniden silahlanma olmamalı');

  // Botun kendi taşıması yeniden silahlanma tetiklemez
  const uBotMove = env15.makeMember('u_bm', { voiceChannel: env15.lobbyChannel });
  t15.handlePresenceUpdate(null, env15.makePresence(uBotMove, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  await clock.advanceBy(10000);
  assert.equal(uBotMove.voice.channelId, '1571915418728271973');
  assert.equal(t15.sessions.get('u_bm')?.moveState, 'moved');
  assert.equal(t15.sessions.get('u_bm')?.rearmCount, 0, 'Botun kendi taşıması yeniden silahlanma tetiklememeli');
  await t15.shutdown();

  // V16: ROLE_REQUIRES_VOICE: false -> eski davranış (rol oyun onaylanınca, sesten bağımsız; NOT_IN_VOICE)
  const env16 = createMockGuild();
  const t16 = makeTracker(clock, { ROLE_REQUIRES_VOICE: false });
  t16.guild = env16.guild;
  const u16 = env16.makeMember('u_v16', { voiceChannel: null });
  t16.handlePresenceUpdate(null, env16.makePresence(u16, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(15000);
  assert.equal(u16.roles.cache.has(cs2Role), true, 'ROLE_REQUIRES_VOICE=false iken ses dışında da rol verilmeli');
  assert.equal(t16.getLastDecision('u_v16')?.reason, TRANSFER_REASONS.NOT_IN_VOICE);
  await t16.shutdown();
});

// =========================================================================
// V17: KARAR İZİ, TR/EN METİNLER, SİSTEM DURUMU, DUYURU VE GİZLİLİK
// =========================================================================

test('V17. 🧪 TR/EN metinleri, ⚙️ Ayarlarım, 🛠️ Sistem Durumu ayarları/sayaçları, tek seferlik duyuru ve sıfır ekstra kalıcı veri', async () => {
  const clock = createFakeClock();
  const logs = [];
  const logger = { log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: () => {} };

  // 1) Tek seferlik duyuru: hata durumunda işaretlenmez, sonra gönderilir ve ikinci kez gitmez
  database.data.activityMeta.voiceRoleAnnouncedAt = null;
  database.save();

  const failEnv = createMockGuild({ commandChannelCanSend: false });
  const tFail = makeTracker(clock, {}, logger);
  const failRes = await tFail.checkOneTimeVoiceRoleAnnouncement(failEnv.guild);
  assert.equal(failRes.announced, false);
  assert.equal(database.getActivityMeta().voiceRoleAnnouncedAt, null);
  await tFail.shutdown();

  const env = createMockGuild();
  const tracker = makeTracker(clock, {}, logger);
  await tracker.initForGuild(env.guild);
  assert.equal(env.apiLog.commandMessages.length, 1);
  assert.deepEqual(env.apiLog.commandMessages[0].allowedMentions, { parse: [] });
  assert.match(env.apiLog.commandMessages[0].content, /bir ses kanalındayken oyun oynadığında verilir/);
  assert.match(env.apiLog.commandMessages[0].content, /while you're in a voice channel and playing/);
  assert.ok(typeof database.getActivityMeta().voiceRoleAnnouncedAt === 'number');

  // Diskten yeniden yükle -> voiceRoleAnnouncedAt korunur ve tekrar gönderilmez
  database.data.activityMeta.voiceRoleAnnouncedAt = null;
  database.init();
  assert.ok(typeof database.getActivityMeta().voiceRoleAnnouncedAt === 'number');
  const secondAnn = await tracker.checkOneTimeVoiceRoleAnnouncement(env.guild);
  assert.equal(secondAnn.announced, false);
  assert.equal(env.apiLog.commandMessages.length, 1);

  // 2) 🧪 yeni 4 sebep kodunun TR ve EN açıklamaları
  const newReasons = [
    TRANSFER_REASONS.ROLE_WAITING_FOR_VOICE,
    TRANSFER_REASONS.REARMED_AFTER_DISCONNECT,
    TRANSFER_REASONS.REARM_LIMIT_REACHED,
    TRANSFER_REASONS.REARM_RATE_LIMITED,
  ];
  for (const code of newReasons) {
    tracker.recordDecision('u_text', { trigger: 'voice-disconnect', result: 'rearmed', reason: code, game: 'CS2' });
    const trOut = aktivitemCmd.buildWhyNotMovedPayload({ userId: 'u_text', lang: 'tr', tracker });
    const enOut = aktivitemCmd.buildWhyNotMovedPayload({ userId: 'u_text', lang: 'en', tracker });
    assert.ok(trOut.content.includes(code));
    assert.ok(!trOut.content.includes('Sebep kodu:'));
    assert.ok(!enOut.content.includes('Reason code:'));
  }

  // 3) ⚙️ Ayarlarım TR/EN metinleri ve ≤5 düğme/satır
  const devM = env.makeMember('u_dev_v17', { roleIds: [config.ROLES.DEVELOPER] });
  const setTr = aktivitemCmd.buildSettingsPanelPayload('u_dev_v17', 'tr', null, database, { member: devM, guild: env.guild });
  assert.match(setTr.content, /Oyun rolün, bir ses kanalındayken oyun oynadığında verilir; oyunu bırakınca alınır/);
  assert.match(setTr.content, /Sesten düşersen tekrar girdiğinde/);
  assert.ok(setTr.components.every((row) => row.toJSON().components.length <= 5));

  const setEn = aktivitemCmd.buildSettingsPanelPayload('u_dev_v17', 'en', null, database, { member: devM, guild: env.guild });
  assert.match(setEn.content, /Your game role is given while you're in a voice channel and playing/);
  assert.match(setEn.content, /If you get disconnected from voice/);

  // 4) 🛠️ Sistem Durumu: yeni ayar değerleri + 4 yeni kimliksiz sayaç + ≤2000 karakter
  const sysTr = aktivitemCmd.buildSystemStatusPayload({ guild: env.guild, lang: 'tr', tracker, db: database });
  assert.ok(sysTr.content.length <= 2000);
  assert.match(sysTr.content, /ROLE_REQUIRES_VOICE=true/);
  assert.match(sysTr.content, /REMOVE_ON_LEAVE=false/);
  assert.match(sysTr.content, /REARM=true \(max:3, ara:30sn\)/);
  assert.match(sysTr.content, /ROLE_WAITING_FOR_VOICE=1/);
  assert.match(sysTr.content, /REARMED_AFTER_DISCONNECT=1/);
  assert.match(sysTr.content, /REARM_LIMIT_REACHED=1/);
  assert.match(sysTr.content, /REARM_RATE_LIMITED=1/);
  assert.equal(sysTr.content.includes('u_text'), false, 'Sistem Durumu kullanıcı kimliği içermemeli');

  // 5) Saatlik konsol satırı yeni sayaçları içerir ve kullanıcı kimliği içermez; diskte ekstra kalıcı alan yok
  tracker.logCounterSummary('test');
  const lastLog = logs[logs.length - 1];
  assert.match(lastLog, /rolSesBekliyor=1/);
  assert.match(lastLog, /rearm=1\(limit:1,hız:1\)/);
  assert.equal(logs.join('\n').includes('u_text'), false);

  database.save();
  const disk = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  assert.equal(disk.rearmCounts, undefined);
  assert.equal(disk.moveStates, undefined);
  assert.equal(disk.lastDecisions, undefined);
  assert.equal(disk.activityHistory, undefined);
  assert.ok(typeof disk.activityMeta.voiceRoleAnnouncedAt === 'number');

  await tracker.shutdown();
});
