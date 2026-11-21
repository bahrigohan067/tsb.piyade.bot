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
  normalizeActivityText,
  detectGame,
  diagnosePresence,
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
      // Kuyruğa alınan tüm async mikro görevlerin tamamlanmasını bekle
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
  roleAddError = null,
  moveError = null,
  botRolePos = 50,
} = {}) {
  const roles = new Collection();
  const channels = new Collection();
  const members = new Collection();
  const presences = new Collection();

  const apiLog = {
    roleAdds: [],
    roleRemoves: [],
    moves: [],
    commandMessages: [],
    deletedMessages: [],
  };

  // 4 Aktiflik rolü
  for (const [key, fam] of Object.entries(activityConfig.FAMILIES)) {
    roles.set(fam.roleId, {
      id: fam.roleId,
      name: `${fam.emoji} ${fam.name.tr}`,
      position: 10,
      members: new Collection(),
      familyKey: key,
    });
  }

  // Ses kanalı yardımcı oluşturucu
  function makeVoiceChannel(id, name, { type = ChannelType.GuildVoice, userLimit = 0 } = {}) {
    const ch = {
      id,
      name,
      type,
      userLimit,
      members: new Collection(),
      permissionsFor: () => ({
        has: () => true,
      }),
    };
    channels.set(id, ch);
    return ch;
  }

  // Tüm yapılandırmadaki oyun ses kanalları + ROBLOX_UNKNOWN + Genel lobi + AFK + Stage
  for (const g of activityConfig.GAMES) {
    for (const chId of g.voiceChannelIds) {
      makeVoiceChannel(chId, `🔊 ${g.name}`);
    }
  }
  for (const chId of activityConfig.ROBLOX_UNKNOWN.voiceChannelIds) {
    makeVoiceChannel(chId, '🔊 OTHER GAMES');
  }

  const lobbyChannel = makeVoiceChannel('voice_lobby_1', '🔊 Sohbet');
  const afkChannel = makeVoiceChannel('voice_afk_1', '💤 AFK');
  const stageChannel = makeVoiceChannel('voice_stage_1', '🎙️ Sahne', {
    type: ChannelType.GuildStageVoice,
  });

  // Komut kanalı
  let msgSeq = 1;
  const commandChannel = {
    id: activityConfig.COMMAND_CHANNEL_ID,
    name: 'bot-komut',
    type: ChannelType.GuildText,
    permissionsFor: () => ({
      has: () => true,
    }),
    send: async (payload) => {
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
      has: () => true,
    },
  };

  const guild = {
    id: '1559313292651008040',
    afkChannelId: afkChannel.id,
    roles: { cache: roles },
    channels: { cache: channels },
    members: { cache: members, me: botMember },
    presences: { cache: presences },
  };

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
      voice: {
        channelId: voiceChannel ? voiceChannel.id : null,
        channel: voiceChannel || null,
        setChannel: async (targetId, reason) => {
          if (moveError) throw moveError;
          if (member.voice.channel) {
            member.voice.channel.members.delete(member.id);
          }
          const nextCh = channels.get(targetId) || null;
          member.voice.channelId = nextCh ? nextCh.id : null;
          member.voice.channel = nextCh;
          if (nextCh) nextCh.members.set(member.id, member);
          apiLog.moves.push({ userId: member.id, targetId, reason });
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
// 1. NORMALİZASYON VE OYUN EŞLEŞTİRME TESTLERİ
// =========================================================================

test('1. Normalizasyon ve eşleşme: SCP, ER:LC, Bonk, CS2, TLauncher, Türkçe karakter, placeId, öncelik ve yoksayılanlar', () => {
  // Normalizasyon örnekleri
  assert.equal(normalizeActivityText('SCP: Roleplay'), 'scp roleplay');
  assert.equal(normalizeActivityText('ER:LC'), 'er lc');
  assert.equal(normalizeActivityText('Bonk & Block'), 'bonk block');
  assert.equal(normalizeActivityText('Counter-Strike 2'), 'counter strike 2');
  assert.equal(normalizeActivityText('TLauncher'), 'tlauncher');
  assert.equal(normalizeActivityText('Şampiyon ĞÜÖÇİı — 🥷!'), 'sampiyon guocii');

  const play = (name, extra = {}) => ({ type: ActivityType.Playing, name, ...extra });

  // Tüm belirli oyun eşleşmeleri
  assert.equal(detectGame({ activities: [play('SCP: Roleplay')] })?.gameId, 'scp');
  assert.equal(detectGame({ activities: [play('ER:LC')] })?.gameId, 'erlc');
  assert.equal(detectGame({ activities: [play('Emergency Response: Liberty County')] })?.gameId, 'erlc');
  assert.equal(detectGame({ activities: [play('ERLC')] })?.gameId, 'erlc');
  assert.equal(detectGame({ activities: [play('Bonk & Block')] })?.gameId, 'bonk');
  assert.equal(detectGame({ activities: [play('Counter-Strike 2')] })?.gameId, 'cs2');
  assert.equal(detectGame({ activities: [play('TLauncher')] })?.gameId, 'minecraft');
  assert.equal(detectGame({ activities: [play('Minecraft 1.21')] })?.gameId, 'minecraft');
  assert.equal(detectGame({ activities: [play('ZULA Türkiye')] })?.gameId, 'zula');
  assert.equal(detectGame({ activities: [play('Apeirophobia')] })?.gameId, 'apeirophobia');
  assert.equal(detectGame({ activities: [play('Jail Break!')] })?.gameId, 'jailbreak');

  // 'scp' tek başına eşleşmemeli
  assert.equal(detectGame({ activities: [play('SCP')] }), null);
  assert.equal(detectGame({ activities: [play('SCP: Secret Laboratory')] }), null);

  // 'tsb' equals kuralı: tek başına 'TSB' eşleşir ama 'TSB rehberi' eşleşmez
  assert.equal(detectGame({ activities: [play('TSB')] })?.gameId, 'tsb');
  assert.equal(detectGame({ activities: [play('TSB Rehberi')] }), null);

  // placeId metinde (details / assets.largeText / state) geçince eşleşmeli
  assert.equal(
    detectGame({
      activities: [play('Roblox', { details: 'Playing place 10449761463' })],
    })?.gameId,
    'tsb'
  );
  assert.equal(
    detectGame({
      activities: [play('Roblox', { assets: { largeText: 'https://roblox.com/games/606849621/JB' } })],
    })?.gameId,
    'jailbreak'
  );

  // Yoksayılan etkinlikler (Roblox Studio dahil!)
  for (const ignored of activityConfig.IGNORED_ACTIVITIES) {
    assert.equal(detectGame({ activities: [play(ignored)] }), null, `${ignored} yoksayılmalı`);
  }

  // Playing dışı türler yoksayılır
  assert.equal(
    detectGame({
      activities: [
        { type: ActivityType.Listening, name: 'Counter-Strike 2' },
        { type: ActivityType.Watching, name: 'Roblox' },
        { type: ActivityType.Streaming, name: 'Minecraft' },
        { type: ActivityType.Custom, name: 'TSB' },
      ],
    }),
    null
  );

  // 'Roblox' tek başına -> ROBLOX_UNKNOWN
  const unk = detectGame({ activities: [play('Roblox')] });
  assert.equal(unk?.gameId, 'roblox_unknown');
  assert.equal(unk?.family, 'roblox');
  assert.equal(unk?.isUnknownRoblox, true);

  // Öncelik sırası: belirli Roblox oyunu (3) > zula/minecraft/cs2 (2) > ROBLOX_UNKNOWN (1)
  assert.equal(
    detectGame({
      activities: [play('Roblox'), play('Counter-Strike 2')],
    })?.gameId,
    'cs2'
  );
  assert.equal(
    detectGame({
      activities: [play('Counter-Strike 2'), play('Roblox', { details: 'The Strongest Battlegrounds' })],
    })?.gameId,
    'tsb'
  );

  // Eşit öncelikte en yeni timestamps.start kazanır; yoksa listedeki ilk
  assert.equal(
    detectGame({
      activities: [
        play('CS2', { timestamps: { start: 1000 } }),
        play('Minecraft', { timestamps: { start: 5000 } }),
      ],
    })?.gameId,
    'minecraft'
  );
  assert.equal(
    detectGame({
      activities: [play('Zula'), play('Minecraft')],
    })?.gameId,
    'zula'
  );
});

// =========================================================================
// 2. DURUM MAKİNESİ & ROLLER TESTLERİ
// =========================================================================

test('2. Durum makinesi: CONFIRM_SEC, STOP_GRACE_SEC, oyun değişimi, Roblox içi rol sabitliği, takip kapatma, ayrılma ve sızıntısız zamanlayıcı', async () => {
  const clock = createFakeClock();
  const env = createMockActivityGuild();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

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

  const u1 = env.makeMember('u1');
  const botUser = env.makeMember('bot_99', { bot: true });

  // Bot hesabı tamamen yoksayılır
  tracker.handlePresenceUpdate(null, env.makePresence(botUser, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(20000);
  assert.equal(tracker.sessions.size, 0);
  assert.equal(env.apiLog.roleAdds.length, 0);

  // Kısa etkinlik (<15 sn CONFIRM_SEC) sayılmaz, rol verilmez
  let prev = env.makePresence(u1, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, prev);
  await clock.advanceBy(10000);
  assert.equal(tracker.sessions.get('u1')?.confirmed, false);
  const emptyP = env.makePresence(u1, []);
  tracker.handlePresenceUpdate(prev, emptyP);
  await clock.advanceBy(10000);
  assert.equal(tracker.sessions.has('u1'), false);
  assert.equal(env.apiLog.roleAdds.length, 0);

  // 15 sn kesintisiz TSB -> onaylı oturum + Roblox aktiflik rolü verilir + moveToken true
  const tsbP = env.makePresence(u1, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(emptyP, tsbP);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u1')?.confirmed, true);
  assert.equal(tracker.sessions.get('u1')?.gameId, 'tsb');
  assert.equal(tracker.sessions.get('u1')?.moveToken, true);
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  assert.equal(env.apiLog.roleAdds.length, 1);

  // STOP_GRACE_SEC (60 sn) içinde kesilip aynı oyun geri gelirse rol alınmaz ve oturum sürer
  const gapP = env.makePresence(u1, []);
  tracker.handlePresenceUpdate(tsbP, gapP);
  await clock.advanceBy(30000);
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  const tsbBack = env.makePresence(u1, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(gapP, tsbBack);
  await clock.advanceBy(40000);
  assert.equal(tracker.sessions.get('u1')?.gameId, 'tsb');
  assert.equal(env.apiLog.roleRemoves.length, 0, 'Grace süresi içinde geri gelince rol alınmamalı');

  // Roblox içinde başka oyuna geçiş (tsb -> jailbreak): 15 sn sonra yeni oturum + yeni moveToken, AMA Roblox rolü DEĞİŞTİRİLMEZ!
  tracker.sessions.get('u1').moveToken = false;
  const jbP = env.makePresence(u1, [{ type: ActivityType.Playing, name: 'Jailbreak' }]);
  tracker.handlePresenceUpdate(tsbBack, jbP);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u1')?.gameId, 'jailbreak');
  assert.equal(tracker.sessions.get('u1')?.moveToken, true, 'Oyun değişiminde yeni aktarma hakkı verilmeli');
  assert.equal(env.apiLog.roleAdds.length, 1, 'Aynı aile içinde gereksiz rol add çağrısı olmamalı');
  assert.equal(env.apiLog.roleRemoves.length, 0, 'Aynı aile içinde gereksiz rol remove çağrısı olmamalı');

  // Farklı aileye geçiş (jailbreak [roblox] -> cs2 [cs2]): Roblox rolü alınıp CS2 rolü verilir
  const cs2P = env.makePresence(u1, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]);
  tracker.handlePresenceUpdate(jbP, cs2P);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('u1')?.gameId, 'cs2');
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);

  // Oyun bitince STOP_GRACE_SEC (60 sn) sonunda rol alınır, oturum silinir ve bekleme süresi SAYILMAZ!
  const cs2BeforeStop = database.getUserActivityStats('u1').games.cs2 || 0;
  const stopP = env.makePresence(u1, []);
  tracker.handlePresenceUpdate(cs2P, stopP);
  await clock.advanceBy(60000);
  assert.equal(tracker.sessions.has('u1'), false);
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  const cs2AfterStop = database.getUserActivityStats('u1').games.cs2 || 0;
  // CS2 sadece 15 sn oynanmıştı (60 sn grace kesinlikle eklenmemeli!)
  assert.equal(cs2AfterStop - cs2BeforeStop, 15, 'STOP_GRACE bekleme süresi oynama süresine eklenmemeli');

  // Sunucudan çıkış (handleMemberRemove): süre ve tercihler temizlenir
  database.setActivityPrefs('u1', { autoMove: false });
  tracker.handleMemberRemove(u1);
  assert.deepEqual(database.getUserActivityStats('u1').games, {});
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityPrefs, 'u1'), false);

  await tracker.shutdown();
  assert.equal(clock.activeTimerCount(), 0, 'Kapanış sonrası hiç aktif zamanlayıcı kalmamalı');
});

// =========================================================================
// 3. ROL HATA DAYANIKLILIĞI & AÇILIŞ TEMİZLİĞİ TESTLERİ
// =========================================================================

test('3. Roller: gereksiz API çağrısı yok, 50013 hatasında çökme yok, 2 dk sonra açılış rol temizliği ve takip kapalıya rol yok', async () => {
  const clock = createFakeClock();
  const warnings = [];
  const silentLogger = { log: () => {}, warn: (m) => warnings.push(m), error: () => {} };

  // A. 50013 izin hatasında çökmeden saatlik tek uyarı
  const errEnv = createMockActivityGuild({
    roleAddError: Object.assign(new Error('Missing Permissions'), { code: 50013 }),
  });
  const errTracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  const mErr = errEnv.makeMember('u_err');
  await errTracker.enqueueRoleAdd(mErr, activityConfig.FAMILIES.roblox.roleId, 'roblox', 'test');
  await errTracker.enqueueRoleAdd(mErr, activityConfig.FAMILIES.roblox.roleId, 'roblox', 'test');
  const permLogs = warnings.filter((w) => w.includes('50013'));
  assert.equal(permLogs.length, 1, 'Aynı 50013 hatası saatte en fazla 1 kez loglanmalı');
  await errTracker.shutdown();

  // B. Gereksiz API çağrısı yapmama & açılışta 2 dk sonra pasif rol temizliği & takip kapalıya rol verilmemesi
  const env = createMockActivityGuild();
  const activeGamer = env.makeMember('u_playing', {
    roleIds: [activityConfig.FAMILIES.roblox.roleId],
  });
  env.makePresence(activeGamer, [{ type: ActivityType.Playing, name: 'Apeirophobia' }]);

  const idleHolder = env.makeMember('u_idle', {
    roleIds: [activityConfig.FAMILIES.cs2.roleId],
  });
  // u_idle oyun oynamıyor!

  const optedOutGamer = env.makeMember('u_optout', {
    roleIds: [activityConfig.FAMILIES.zula.roleId],
  });
  database.setActivityPrefs('u_optout', { tracking: false });
  env.makePresence(optedOutGamer, [{ type: ActivityType.Playing, name: 'Zula' }]);

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

  // activeGamer zaten Roblox rolüne sahip -> gereksiz add API çağrısı yapılmamalı, moveToken FALSE olmalı!
  assert.equal(env.apiLog.roleAdds.length, 0, 'Rol zaten varsa gereksiz API add çağrısı olmamalı');
  assert.equal(tracker.sessions.get('u_playing')?.moveToken, false, 'Açılışta mevcut oturumlara aktarma hakkı verilmemeli');
  assert.equal(tracker.sessions.has('u_optout'), false, 'Takibi kapalı üye oturuma alınmamalı');

  // 2 dakika (120 sn) ilerlet -> u_idle ve u_optout'un aktiflik rolleri alınır, u_playing'e dokunulmaz
  await clock.advanceBy(120000);
  assert.equal(activeGamer.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  assert.equal(idleHolder.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), false);
  assert.equal(optedOutGamer.roles.cache.has(activityConfig.FAMILIES.zula.roleId), false);

  await tracker.shutdown();
});

// =========================================================================
// 4. OTOMATİK SES KANALI AKTARIMI TESTLERİ
// =========================================================================

test('4. Ses aktarımı: geri sayım mesajı, 10 sn aktarma + silme, oturumda 1 kez, iptal yetkisi, sese sonradan girme, engelli/dolu kanallar, Minecraft seçimi ve ROBLOX_UNKNOWN', async () => {
  const clock = createFakeClock();
  const warnings = [];
  const silentLogger = { log: () => {}, warn: (m) => warnings.push(m), error: () => {} };
  const env = createMockActivityGuild();

  const tracker = new ActivityTracker({
    config: makeTestConfig({ NO_MOVE_CHANNEL_IDS: ['voice_nomove_99'] }),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  // A. Normal akış: Lobideyken TSB başlar -> 15 sn onay -> geri sayım mesajı (etiket + <t:R> + iptal butonu) -> 10 sn sonra aktarma + mesaj silme
  const p1 = env.makeMember('p1', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(p1, [{ type: ActivityType.Playing, name: 'TSB' }]));
  await clock.advanceBy(15000);

  assert.equal(env.apiLog.commandMessages.length, 1);
  const cdMsg = env.apiLog.commandMessages[0];
  assert.match(cdMsg.content, /<@p1>/);
  assert.match(cdMsg.content, /<t:\d+:R>/);
  assert.deepEqual(cdMsg.allowedMentions, { parse: [], users: ['p1'] });
  const cancelBtn = cdMsg.components[0].toJSON().components[0];
  assert.ok(cancelBtn.custom_id.startsWith('act_cancel:p1:'));
  assert.ok(cancelBtn.custom_id.length <= 100);

  // Başkası iptal butonuna basarsa ephemeral red, geri sayım bozulmaz
  let otherReply = null;
  await tracker.handleCancelTransferButton({
    customId: cancelBtn.custom_id,
    user: { id: 'stranger_99' },
    locale: 'tr',
    reply: async (p) => {
      otherReply = p;
    },
  });
  assert.equal(otherReply.ephemeral, true);
  assert.match(otherReply.content, /sana ait değil/);
  assert.equal(tracker.activeCountdowns.has('p1'), true);

  // 10 sn dolunca TSB ses kanalına taşınır ve geri sayım mesajı silinir
  await clock.advanceBy(10000);
  assert.equal(p1.voice.channelId, '1571912346773885050');
  assert.equal(cdMsg.deleted, true);

  // Aktarma sonrası üye kendisi lobiye dönse bile aynı oturumda TEKRAR aktarma YAPILMAZ
  const { oldState: backOld, newState: backNew } = env.moveMemberVoice(p1, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(backOld, backNew);
  await clock.advanceBy(15000);
  assert.equal(p1.voice.channelId, env.lobbyChannel.id, 'Oturum başına yalnızca 1 kez aktarma yapılmalı');
  assert.equal(env.apiLog.commandMessages.length, 1);

  // B. Sahibi iptal butonuna basınca: aktarma iptal, mesaj güncellenip 5 sn sonra silinir, hak tükenir, eski butona basınca "eskidi"
  const p2 = env.makeMember('p2', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(p2, [{ type: ActivityType.Playing, name: 'Roblox' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.activeCountdowns.get('p2')?.targetChannelId, activityConfig.ROBLOX_UNKNOWN.voiceChannelIds[0], 'ROBLOX_UNKNOWN -> OTHER GAMES kanalı olmalı');
  const p2Msg = env.apiLog.commandMessages[1];
  const p2CancelId = p2Msg.components[0].toJSON().components[0].custom_id;

  let cancelUpdate = null;
  await tracker.handleCancelTransferButton({
    customId: p2CancelId,
    user: p2.user,
    locale: 'tr',
    message: p2Msg,
    update: async (p) => {
      cancelUpdate = p;
    },
  });
  assert.match(cancelUpdate.content, /iptal edildi/);
  assert.equal(tracker.sessions.get('p2')?.moveToken, false);
  await clock.advanceBy(5000);
  assert.equal(p2Msg.deleted, true, 'İptal mesajı 5 sn sonra silinmeli');
  assert.equal(p2.voice.channelId, env.lobbyChannel.id, 'İptal sonrası taşıma yapılmamalı');

  // Eski butona tekrar basınca nazik ephemeral yanıt
  let expiredReply = null;
  await tracker.handleCancelTransferButton({
    customId: p2CancelId,
    user: p2.user,
    locale: 'en-US',
    reply: async (p) => {
      expiredReply = p;
    },
  });
  assert.equal(expiredReply.ephemeral, true);
  assert.match(expiredReply.content, /expired/i);

  // C. Ses dışındayken başlayan oyun -> sonradan sese girince 5 sn sonra geri sayım, 10 sn sonra aktarma
  const p3 = env.makeMember('p3', { voiceChannel: null });
  tracker.handlePresenceUpdate(null, env.makePresence(p3, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('p3')?.moveToken, true, 'Seste değilken hak korunmalı');
  const { oldState: joinOld, newState: joinNew } = env.moveMemberVoice(p3, env.lobbyChannel);
  tracker.handleVoiceStateUpdate(joinOld, joinNew);
  await clock.advanceBy(5000);
  assert.equal(tracker.activeCountdowns.has('p3'), true, 'Sese girdikten 5 sn sonra geri sayım başlamalı');
  await clock.advanceBy(10000);
  assert.equal(p3.voice.channelId, '1571914184860504074');

  // D. AFK ve Stage kanallarından ASLA aktarma yapılmaz
  const pAfk = env.makeMember('pAfk', { voiceChannel: env.afkChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(pAfk, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(25000);
  assert.equal(pAfk.voice.channelId, env.afkChannel.id);

  const pStage = env.makeMember('pStage', { voiceChannel: env.stageChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(pStage, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(25000);
  assert.equal(pStage.voice.channelId, env.stageChannel.id);

  // E. Zaten hedef kanalda olan kullanıcıya aktarma yapılmaz ve token tükenir
  const cs2Ch = env.channels.get('1571915418728271973');
  const pAlready = env.makeMember('pAlready', { voiceChannel: cs2Ch });
  const msgCountBefore = env.apiLog.commandMessages.length;
  tracker.handlePresenceUpdate(null, env.makePresence(pAlready, [{ type: ActivityType.Playing, name: 'CS2' }]));
  await clock.advanceBy(25000);
  assert.equal(env.apiLog.commandMessages.length, msgCountBefore);
  assert.equal(tracker.sessions.get('pAlready')?.moveToken, false);

  // F. Minecraft çoklu kanal seçimi: önce aynı oyunlu onaylı oyuncu olan kanal; tümü doluysa hak korunur
  const mcCh1 = env.channels.get('1571914836248363169');
  const mcCh2 = env.channels.get('1571914899569778698');
  const mcFriend = env.makeMember('mcFriend', { voiceChannel: mcCh2 });
  tracker.sessions.set('mcFriend', {
    userId: 'mcFriend',
    confirmed: true,
    gameId: 'minecraft',
    family: 'minecraft',
    currentlyDetectedGameId: 'minecraft',
    moveToken: false,
  });
  const selectedMc = selectTargetVoiceChannel({
    guild: env.guild,
    gameId: 'minecraft',
    candidateChannelIds: [mcCh1.id, mcCh2.id],
    sessionsMap: tracker.sessions,
    excludeUserId: 'mcNew',
  });
  assert.equal(selectedMc.channel?.id, mcCh2.id, 'Aynı oyunda onaylı oyuncunun olduğu Minecraft kanalı seçilmeli');

  // Tüm hedef kanallar doluysa aktarma yapılmaz ve hak TÜKETİLMEZ
  mcCh1.userLimit = 1;
  env.makeMember('filler1', { voiceChannel: mcCh1 });
  mcCh2.userLimit = 1; // mcFriend zaten orada -> dolu
  const mcWaiting = env.makeMember('mcWaiting', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(mcWaiting, [{ type: ActivityType.Playing, name: 'TLauncher' }]));
  await clock.advanceBy(25000);
  assert.equal(mcWaiting.voice.channelId, env.lobbyChannel.id);
  assert.equal(tracker.sessions.get('mcWaiting')?.moveToken, true, 'Tüm hedef kanallar doluysa aktarma hakkı korunmalı');

  // G. Geri sayım sürerken sesten çıkma -> aktarma yapılmaz ve mesaj silinir
  const pLeave = env.makeMember('pLeave', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(pLeave, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  const leaveCdMsg = tracker.activeCountdowns.get('pLeave')?.message;
  assert.ok(leaveCdMsg);
  const { oldState: lOld, newState: lNew } = env.moveMemberVoice(pLeave, null);
  tracker.handleVoiceStateUpdate(lOld, lNew);
  assert.equal(tracker.activeCountdowns.has('pLeave'), false);
  assert.equal(leaveCdMsg.deleted, true);

  // H. Geri sayım sürerken oyun değişimi -> eski geri sayım silinir, yenisi onaylanınca yeni geri sayım başlar (çift geri sayım yok)
  const pSwitch = env.makeMember('pSwitch', { voiceChannel: env.lobbyChannel });
  const sw1 = env.makePresence(pSwitch, [{ type: ActivityType.Playing, name: 'TSB' }]);
  tracker.handlePresenceUpdate(null, sw1);
  await clock.advanceBy(15000);
  const firstCd = tracker.activeCountdowns.get('pSwitch')?.message;
  assert.ok(firstCd);
  const sw2 = env.makePresence(pSwitch, [{ type: ActivityType.Playing, name: 'Jailbreak' }]);
  tracker.handlePresenceUpdate(sw1, sw2);
  assert.equal(firstCd.deleted, true, 'Oyun değişince eski geri sayım mesajı silinmeli');
  assert.equal(tracker.activeCountdowns.has('pSwitch'), false);
  await clock.advanceBy(15000);
  assert.equal(tracker.activeCountdowns.get('pSwitch')?.gameId, 'jailbreak');
  await clock.advanceBy(10000);
  assert.equal(pSwitch.voice.channelId, '1571913130684973177');

  // I. Geri sayım sürerken kullanıcı KENDİSİ hedef kanala geçerse aktarma YAPILMAZ ve geri sayım mesajı silinir
  const pSelf = env.makeMember('pSelf', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(pSelf, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000);
  const selfCdMsg = tracker.activeCountdowns.get('pSelf')?.message;
  assert.ok(selfCdMsg);
  const movesBeforeSelf = env.apiLog.moves.length;
  const zulaCh = env.channels.get('1571914184860504074');
  const { oldState: sOld, newState: sNew } = env.moveMemberVoice(pSelf, zulaCh);
  tracker.handleVoiceStateUpdate(sOld, sNew);
  await clock.advanceBy(10000);
  assert.equal(selfCdMsg.deleted, true);
  assert.equal(env.apiLog.moves.length, movesBeforeSelf, 'Kendisi hedef kanala geçince bot setChannel çağırmamalı');

  // J. ROBLOX_UNKNOWN -> belirli Roblox oyunu (TSB) değişimi yeni oturum & yeni aktarma hakkı verir, Roblox rolü değişmez
  const pUnkToTsb = env.makeMember('pUnkToTsb', { voiceChannel: env.channels.get(activityConfig.ROBLOX_UNKNOWN.voiceChannelIds[0]) });
  const unkP = env.makePresence(pUnkToTsb, [{ type: ActivityType.Playing, name: 'Roblox' }]);
  tracker.handlePresenceUpdate(null, unkP);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('pUnkToTsb')?.gameId, 'roblox_unknown');
  assert.equal(tracker.sessions.get('pUnkToTsb')?.moveToken, false, 'Zaten OTHER GAMES kanalında olduğu için token tükenmiş olmalı');
  const roleAddsBeforeSwitch = env.apiLog.roleAdds.length;
  const roleRemovesBeforeSwitch = env.apiLog.roleRemoves.length;
  const tsbFromUnk = env.makePresence(pUnkToTsb, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(unkP, tsbFromUnk);
  await clock.advanceBy(15000);
  assert.equal(tracker.sessions.get('pUnkToTsb')?.gameId, 'tsb');
  assert.equal(tracker.activeCountdowns.get('pUnkToTsb')?.targetChannelId, '1571912346773885050');
  assert.equal(env.apiLog.roleAdds.length, roleAddsBeforeSwitch);
  assert.equal(env.apiLog.roleRemoves.length, roleRemovesBeforeSwitch);
  await clock.advanceBy(10000);
  assert.equal(pUnkToTsb.voice.channelId, '1571912346773885050');

  await tracker.shutdown();
});

test('5. Ses aktarım hata yönetimi: komut kanalı yoksa aktarma yok, 40032 sessiz, 50013 saatlik tek uyarı', async () => {
  const clock = createFakeClock();
  const warnings = [];
  const silentLogger = { log: () => {}, warn: (m) => warnings.push(m), error: () => {} };

  // A. Komut kanalı yoksa aktarma yapılmaz
  const noCmdEnv = createMockActivityGuild({ includeCommandChannel: false });
  const t1 = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  t1.guild = noCmdEnv.guild;
  const m1 = noCmdEnv.makeMember('m_nocmd', { voiceChannel: noCmdEnv.lobbyChannel });
  t1.handlePresenceUpdate(null, noCmdEnv.makePresence(m1, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(30000);
  assert.equal(m1.voice.channelId, noCmdEnv.lobbyChannel.id, 'Komut kanalı yoksa iptal şansı verilemediği için aktarma yapılmamalı');
  await t1.shutdown();

  // B. 40032 (sesten çıkmış) sessiz yoksayılır; 50013 saatte 1 kez loglanır
  const err40032Env = createMockActivityGuild({
    moveError: Object.assign(new Error('Target user not connected to voice'), { code: 40032 }),
  });
  const t2 = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  t2.guild = err40032Env.guild;
  const warnCountBefore40032 = warnings.length;
  const m40032 = err40032Env.makeMember('m40032', { voiceChannel: err40032Env.lobbyChannel });
  t2.handlePresenceUpdate(null, err40032Env.makePresence(m40032, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(25000);
  assert.equal(warnings.length, warnCountBefore40032, '40032 hatası sessizce yoksayılmalı');
  await t2.shutdown();

  const err50013Env = createMockActivityGuild({
    moveError: Object.assign(new Error('Missing Permissions'), { code: 50013 }),
  });
  const t3 = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  t3.guild = err50013Env.guild;
  const m50013a = err50013Env.makeMember('m50013a', { voiceChannel: err50013Env.lobbyChannel });
  const m50013b = err50013Env.makeMember('m50013b', { voiceChannel: err50013Env.lobbyChannel });
  t3.handlePresenceUpdate(null, err50013Env.makePresence(m50013a, [{ type: ActivityType.Playing, name: 'Zula' }]));
  t3.handlePresenceUpdate(null, err50013Env.makePresence(m50013b, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(25000);
  const move50013Warns = warnings.filter((w) => w.includes('50013'));
  assert.equal(move50013Warns.length, 1, '50013 ses taşıma hatası saatte en fazla 1 kez loglanmalı');
  await t3.shutdown();
});

// =========================================================================
// 5. SÜRE, AYLIK SIFIRLAMA, KALICILIK, KAPANIŞ & GİZLİLİK TESTLERİ
// =========================================================================

test('6. Süre checkpoint, Europe/Istanbul ay dönümü sıfırlama, tek seferlik duyuru, yeniden başlatma kalıcılığı, SIGTERM kapanış ve geçmiş verisi OLMAMASI', async () => {
  // 2026-11-30 23:59:59 İstanbul = 2026-11-30T20:59:59Z
  assert.equal(database.getCurrentIstanbulMonth(new Date('2026-11-30T20:59:59Z')), '2026-11');
  // 2026-12-01 00:00:00 İstanbul = 2026-11-30T21:00:00Z
  assert.equal(database.getCurrentIstanbulMonth(new Date('2026-11-30T21:00:00Z')), '2026-12');

  const clock = createFakeClock(Date.parse('2026-11-21T12:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockActivityGuild();

  // Tek seferlik ilk duyuru için announcedAt null yap, eski ay olarak 2026-10 koy
  database.data.activityMeta = { announcedAt: null, lastResetMonth: '2026-10' };
  database.data.activityStats = { month: '2026-10', users: { old_user: { games: { cs2: 9999 } } } };
  database.save();

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

  // Açılışta eksik ay sıfırlanmış, önceki ayın tüm verileri silinmiş ve 2 duyuru (sıfırlama + ilk duyuru) gitmiş olmalı
  assert.equal(database.data.activityStats.month, '2026-11');
  assert.deepEqual(database.data.activityStats.users, {}, 'Önceki aya ait HİÇBİR kullanıcı verisi kalmamalı');
  assert.ok(database.getActivityMeta().announcedAt, 'İlk duyuru işaretlenmeli');
  assert.equal(env.apiLog.commandMessages.length, 2);
  assert.deepEqual(env.apiLog.commandMessages[0].allowedMentions, { parse: [] });
  assert.deepEqual(env.apiLog.commandMessages[1].allowedMentions, { parse: [] });

  // İkinci kez checkOneTimeAnnouncement çağrılırsa tekrar duyuru atmaz
  const secondAnn = await tracker.checkOneTimeAnnouncement(env.guild);
  assert.equal(secondAnn.announced, false);

  // Oyun oynama + 60 sn checkpoint biriktirme + kapanışta (shutdown) son kayıt & bekleyen geri sayımı silme
  const gamer = env.makeMember('g_time', { voiceChannel: env.lobbyChannel });
  tracker.handlePresenceUpdate(null, env.makePresence(gamer, [{ type: ActivityType.Playing, name: 'Zula' }]));
  await clock.advanceBy(15000); // Onaylandı + geri sayım başladı
  const pendingMsg = tracker.activeCountdowns.get('g_time')?.message;
  assert.ok(pendingMsg);

  // Kapanış öncesi 5 saniye daha geçti (toplam 20 sn) -> shutdown() çağır
  await clock.advanceBy(5000);
  await tracker.shutdown();

  assert.equal(pendingMsg.deleted, true, 'Kapanışta bekleyen geri sayım mesajı silinmeli');
  assert.equal(database.getUserActivityStats('g_time').games.zula, 20, 'Kapanışta biriken son süre kaydedilmeli');

  // Yeniden başlatma (database.init) kalıcılığı + diskte HİÇBİR geçmiş/zaman çizelgesi kaydı OLMAMASI
  database.setActivityPrefs('pref_user', { autoMove: false });
  database.init();
  assert.equal(database.getUserActivityStats('g_time').games.zula, 20);
  assert.deepEqual(database.getActivityPrefs('pref_user'), { tracking: true, autoMove: false });

  const rawJson = fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8');
  const parsedDisk = JSON.parse(rawJson);
  assert.equal(parsedDisk.activityHistory, undefined);
  assert.equal(parsedDisk.activitySessions, undefined);
  assert.deepEqual(Object.keys(parsedDisk.activityStats), ['month', 'users']);
  assert.deepEqual(Object.keys(parsedDisk.activityStats.users.g_time), ['games']);
  assert.equal(typeof parsedDisk.activityStats.users.g_time.games.zula, 'number');
});

// =========================================================================
// 6. /aktivitem KOMUTU, AYARLARIM, TEŞHİS VE PANEL NOTU TESTLERİ
// =========================================================================

test('7. /aktivitem komutu: kayıtlı/boş/kapalı/canlı, TR/EN, herkese açık, cooldown, Ayarlarım (başkası basınca kendi ayarı), teşhis ve kayıt paneli notu', async () => {
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

  const u1 = env.makeMember('act_u1', {
    displayName: 'Eren @everyone',
    roleIds: [activityConfig.FAMILIES.roblox.roleId],
  });
  const u2 = env.makeMember('act_u2');

  // A. Boş veri (TR)
  let replyPayload = null;
  await aktivitemCmd.execute({
    user: u1.user,
    member: u1,
    locale: 'tr',
    reply: async (p) => {
      replyPayload = p;
    },
  });
  assert.equal(replyPayload.ephemeral, false, '/aktivitem herkese açık olmalı');
  assert.deepEqual(replyPayload.allowedMentions, { parse: [] });
  assert.match(replyPayload.embeds[0].toJSON().description, /henüz kaydedilmiş oyun süren yok/);
  assert.match(replyPayload.embeds[0].toJSON().description, /<t:\d+:D>/);

  // Cooldown kontrolü (30 sn içinde ikinci çağrı ephemeral uyarı)
  let cdReply = null;
  await aktivitemCmd.execute({
    user: u1.user,
    member: u1,
    locale: 'tr',
    reply: async (p) => {
      cdReply = p;
    },
  });
  assert.equal(cdReply.ephemeral, true);
  assert.match(cdReply.content, /sn sonra tekrar dene/);

  // B. Kayıtlı veri + ROBLOX_UNKNOWN + canlı oynuyor satırı (TR & EN)
  database.addActivitySeconds('act_u1', 'tsb', 18720, { immediate: true }); // 5 sa 12 dk
  database.addActivitySeconds('act_u1', 'roblox_unknown', 3600, { immediate: true }); // 1 sa
  tracker.sessions.set('act_u1', {
    userId: 'act_u1',
    confirmed: true,
    gameId: 'tsb',
    family: 'roblox',
    currentlyDetectedGameId: 'tsb',
    since: clock.nowFn() - 23 * 60 * 1000,
    lastAccountedAt: clock.nowFn(),
    lastSeen: clock.nowFn(),
    moveToken: false,
  });

  const trSummary = aktivitemCmd.buildActivitySummaryPayload({
    user: u1.user,
    member: u1,
    lang: 'tr',
    tracker,
    db: database,
  });
  const trDesc = trSummary.embeds[0].toJSON().description;
  assert.match(trDesc, /The Strongest Battlegrounds/);
  assert.match(trDesc, /5 sa 12 dk/);
  assert.match(trDesc, /Roblox \(oyun bilinmiyor\)/);
  assert.match(trDesc, /Şu an oynuyor/);
  assert.match(trDesc, /23 dk/);

  const enSummary = aktivitemCmd.buildActivitySummaryPayload({
    user: u1.user,
    member: u1,
    lang: 'en',
    tracker,
    db: database,
  });
  const enDesc = enSummary.embeds[0].toJSON().description;
  assert.match(enDesc, /5h 12m/);
  assert.match(enDesc, /Roblox \(unknown game\)/);
  assert.match(enDesc, /Currently playing/);

  // C. Ayarlarım butonuna u2 basınca u2'nin KENDİ ayarları ephemeral açılır
  let settingsReply = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_settings',
      user: u2.user,
      member: u2,
      locale: 'tr',
      reply: async (p) => {
        settingsReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(settingsReply.ephemeral, true);
  assert.equal(settingsReply.components[0].toJSON().components[0].custom_id, 'act_toggle_track:act_u2');

  // Başkası u2'nin ayar butonuna basamaz
  let unauthorizedReply = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_toggle_track:act_u2',
      user: u1.user,
      member: u1,
      locale: 'tr',
      reply: async (p) => {
        unauthorizedReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(unauthorizedReply.ephemeral, true);
  assert.match(unauthorizedReply.content, /sana ait değil/);

  // D. u1 takibi kapatınca roller alınır, süre silinir, /aktivitem kapalı mesajı + "Takibi Aç" butonu gösterir
  let toggleUpdate = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_toggle_track:act_u1',
      user: u1.user,
      member: u1,
      locale: 'tr',
      update: async (p) => {
        toggleUpdate = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(u1.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.deepEqual(database.getUserActivityStats('act_u1').games, {});
  assert.equal(toggleUpdate.components[0].toJSON().components[1].disabled, true, 'Takip kapalıyken ses aktarma butonu devre dışı olmalı');

  const closedSummary = aktivitemCmd.buildActivitySummaryPayload({
    user: u1.user,
    member: u1,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(closedSummary.embeds[0].toJSON().description, /Etkinlik takibini kapattın/);
  assert.equal(closedSummary.components[0].toJSON().components[0].custom_id, 'act_enable_track');

  // Tekrar açınca varsayılana döndüğü için activityPrefs kaydı DB'den silinir
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_toggle_track:act_u1',
      user: u1.user,
      member: u1,
      locale: 'tr',
      update: async () => {},
    },
    { tracker, db: database }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityPrefs, 'act_u1'), false);

  // E. Teşhis çıktısı: ham alanlar + eşleşme sonucu, hiçbir şey saklanmaz
  const dbSnapshotBefore = JSON.stringify(database.data);
  env.makePresence(u1, [
    {
      type: ActivityType.Playing,
      name: 'Bilinmeyen Oyun ```@everyone```',
      applicationId: '999888',
      details: 'Lobby',
      state: 'In Match',
      assets: { largeText: 'Map 1' },
    },
  ]);
  let diagReply = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_diag:act_u1',
      user: u1.user,
      member: u1,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        diagReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(diagReply.ephemeral, true);
  assert.match(diagReply.content, /applicationId: 999888/);
  assert.match(diagReply.content, /Discord oyunu tanımıyor demektir/);
  assert.equal(diagReply.content.includes('@everyone'), false, 'Teşhis çıktısında @everyone etkisizleştirilmeli');
  assert.equal(JSON.stringify(database.data), dbSnapshotBefore, 'Teşhis hiçbir veri kaydetmemeli');

  // F. Kayıt paneline eklenen kısa not & buton customId korunması
  const regPanel = createRegisterPanel();
  const panelDesc = regPanel.embeds.map((e) => e.toJSON().description).join('\n');
  assert.match(panelDesc, /\/aktivitem/);
  assert.match(panelDesc, /\/activity/);
  assert.equal(regPanel.components[0].toJSON().components[0].custom_id, 'btn_kayit_ol');
  assert.equal(regPanel.components[0].toJSON().components[1].custom_id, 'btn_kayit_ol_en');

  await tracker.shutdown();
});

// =========================================================================
// 7. PRESENCE INTENT FALLBACK & YAPILANDIRMA DOĞRULAMA TESTLERİ
// =========================================================================

test('8. Presence Intent kapalı senaryosunda bot çökmez, uyarı verir ve GuildPresences olmadan açılır', async () => {
  const intentsFull = buildClientIntents({ includePresenceIntent: true });
  assert.ok(intentsFull.includes(GatewayIntentBits.GuildPresences));
  assert.ok(intentsFull.includes(GatewayIntentBits.GuildVoiceStates));

  const intentsFallback = buildClientIntents({ includePresenceIntent: false });
  assert.equal(intentsFallback.includes(GatewayIntentBits.GuildPresences), false);
  assert.ok(intentsFallback.includes(GatewayIntentBits.GuildVoiceStates));

  const warnings = [];
  const attempts = [];
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
  });

  const result = await loginWithPresenceFallback({
    token: 'fake-token',
    tracker,
    logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    createClientFn: ({ includePresenceIntent }) => {
      attempts.push(includePresenceIntent);
      return {
        activityPresenceDisabled: !includePresenceIntent,
        destroy: () => {},
        login: async () => {
          if (includePresenceIntent) {
            throw new Error('Used disallowed intents');
          }
          return 'ok';
        },
      };
    },
  });

  assert.deepEqual(attempts, [true, false]);
  assert.equal(result.presenceEnabled, false);
  assert.equal(result.client.activityPresenceDisabled, true);
  assert.equal(tracker.isPresenceIntentAvailable(), false);
  assert.ok(warnings.some((w) => w.includes('Presence Intent')));
});

test('9. Yapılandırma doğrulama: eksik alan, tekrarlı ID, eksik kanal/rol ve ses olmayan kanal uyarısı', () => {
  // A. Bozuk statik ayar: tekrarlı ID ve eksik matcher
  const badCfg = {
    ...activityConfig,
    GAMES: [
      {
        id: 'dup1',
        family: 'roblox',
        name: 'Oyun 1',
        voiceChannelIds: ['ch1'],
        matchers: [{ field: 'any', op: 'contains', value: 'oyun1' }],
      },
      {
        id: 'dup1',
        family: 'roblox',
        name: 'Tekrarlı Oyun',
        voiceChannelIds: ['ch1'],
        matchers: [{ field: 'any', op: 'contains', value: 'oyun2' }],
      },
      {
        id: 'broken_no_matchers',
        family: 'roblox',
        name: 'Bozuk',
        voiceChannelIds: ['ch1'],
        matchers: [],
      },
    ],
  };

  const structRes = activityConfig.validateActivityConfigStructure(badCfg, { silent: true });
  assert.equal(structRes.valid, false);
  assert.ok(structRes.errors.some((e) => e.includes('Tekrarlı oyun ID')));
  assert.ok(structRes.disabledGameIds.has('broken_no_matchers'));

  // B. Canlı sunucu doğrulaması: eksik rol, eksik kanal, ses olmayan metin kanalı
  const fakeGuild = {
    roles: { cache: new Collection() }, // Hiç rol yok
    channels: {
      cache: new Collection([
        ['text_not_voice', { id: 'text_not_voice', type: ChannelType.GuildText }],
      ]),
    },
    members: { me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } } },
  };
  const customCfg = {
    ...activityConfig,
    GAMES: [
      {
        id: 'not_voice_game',
        family: 'roblox',
        name: 'Test',
        voiceChannelIds: ['text_not_voice'],
        matchers: [{ field: 'any', op: 'contains', value: 'test' }],
      },
      {
        id: 'missing_ch_game',
        family: 'cs2',
        name: 'Missing',
        voiceChannelIds: ['nonexistent_ch'],
        matchers: [{ field: 'any', op: 'contains', value: 'missing' }],
      },
    ],
  };
  const guildRes = activityConfig.validateActivityConfigWithGuild(fakeGuild, customCfg, { silent: true });
  assert.equal(guildRes.valid, false);
  assert.ok(guildRes.disabledFamilyIds.has('roblox'));
  assert.ok(guildRes.disabledGameIds.has('not_voice_game'));
  assert.ok(guildRes.disabledGameIds.has('missing_ch_game'));
  assert.ok(guildRes.warnings.some((w) => w.includes('normal bir ses kanalı değil')));
});
