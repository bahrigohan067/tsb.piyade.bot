/**
 * İstatistik Katmanı, Süre Güvenceleri, Roblox Aile Gruplama, Sözleşme ve Sistem Durumu Testleri
 * Kapsam: T1–T5, S1–S11, G1–G8, C1, D1–D3
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  Collection,
  Events,
  ActivityType,
  ChannelType,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require('discord.js');

// İzole geçici veritabanı dizini (mevcut data/database.json'a ASLA dokunulmaz)
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-stats-duration-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-stats-contract-secret';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const activityConfig = require('../activity.config');
const database = require('../src/utils/database');
const { ActivityTracker } = require('../src/utils/activityTracker');
const activityTrackerSingleton = require('../src/utils/activityTracker');
const statsRoutes = require('../src/api/routes/stats');
const guildMemberRemoveEvent = require('../src/events/guildMemberRemove');
const aktivitemCommand = require('../src/commands/aktivitem');
const { createApp } = require('../src/api/server');
const { createConfiguredClient } = require('../index');

// Sabit başlangıç saati: 2026-11-15 12:00:00 Europe/Istanbul (15 Kasım 2026, ayın ortası)
const BASE_NOW_MS = Date.parse('2026-11-15T12:00:00+03:00');

function createFakeClock(startMs = BASE_NOW_MS) {
  let current = startMs;
  const timers = new Map();
  let nextId = 1;

  return {
    now: () => current,
    setNow: (ms) => {
      current = ms;
    },
    advance: async (ms) => {
      const target = current + ms;
      while (true) {
        let earliest = null;
        for (const [id, entry] of timers.entries()) {
          if (entry.runAt <= target && (!earliest || entry.runAt < earliest.runAt)) {
            earliest = { id, ...entry };
          }
        }
        if (!earliest) break;
        current = earliest.runAt;
        timers.delete(earliest.id);
        await earliest.fn();
      }
      current = target;
    },
    setTimeout: (fn, delay) => {
      const id = nextId++;
      timers.set(id, { fn, runAt: current + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
}

function makePlayingPresence({
  userId,
  name = 'Roblox',
  details = '',
  state = '',
  status = 'online',
  timestamps = null,
  guild = null,
  member = null,
}) {
  return {
    userId: String(userId),
    status,
    guild,
    member,
    user: member?.user || { id: String(userId), bot: false },
    activities: name
      ? [
          {
            type: ActivityType.Playing,
            name,
            details: details || undefined,
            state: state || undefined,
            timestamps: timestamps || undefined,
          },
        ]
      : [],
  };
}

function makeMockMember({
  id,
  username = `user_${id}`,
  registered = true,
  isBot = false,
  isDeveloper = false,
  presence = null,
}) {
  const roleMap = new Collection();
  roleMap.set(config.GUILD_ID, { id: config.GUILD_ID, name: '@everyone', position: 0 });
  if (registered) {
    roleMap.set(config.ROLES.REGISTERED_MEMBER, {
      id: config.ROLES.REGISTERED_MEMBER,
      name: 'Kayıtlı',
      position: 10,
    });
  }
  if (isDeveloper) {
    roleMap.set(config.ROLES.DEVELOPER, {
      id: config.ROLES.DEVELOPER,
      name: 'DEVELOPER',
      position: 50,
    });
  }

  const member = {
    id: String(id),
    displayName: username,
    user: {
      id: String(id),
      username,
      bot: isBot,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    roles: {
      cache: roleMap,
      highest: { position: isDeveloper ? 50 : registered ? 10 : 0 },
      add: async () => {},
      remove: async () => {},
    },
    voice: { channelId: null, channel: null },
    presence,
  };
  if (presence) {
    presence.member = member;
    presence.user = member.user;
  }
  return member;
}

function makeVoiceChannel(id, name = `vc_${id}`) {
  return {
    id: String(id),
    name,
    type: ChannelType.GuildVoice,
    userLimit: 0,
    members: new Collection(),
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true }),
  };
}

function createMockGuild({ members = [], presences = [], fetchFn = null, botHighestPos = 80 } = {}) {
  const memberCache = new Collection();
  for (const m of members) memberCache.set(m.id, m);

  const presenceCache = new Collection();
  for (const p of presences) presenceCache.set(p.userId, p);
  for (const m of members) {
    if (m.presence) presenceCache.set(m.id, m.presence);
  }

  const rolesCache = new Collection();
  for (const fam of Object.values(activityConfig.FAMILIES)) {
    rolesCache.set(fam.roleId, { id: fam.roleId, name: fam.nameTr || fam.name, position: 20 });
  }

  const channelsCache = new Collection();
  channelsCache.set(activityConfig.COMMAND_CHANNEL_ID, {
    id: activityConfig.COMMAND_CHANNEL_ID,
    name: 'komutlar',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    send: async () => {},
  });
  for (const game of activityConfig.GAMES) {
    for (const cid of game.voiceChannelIds || []) {
      channelsCache.set(cid, makeVoiceChannel(cid, game.name));
    }
  }
  for (const cid of activityConfig.ROBLOX_UNKNOWN.voiceChannelIds || []) {
    channelsCache.set(cid, makeVoiceChannel(cid, 'OTHER GAMES'));
  }
  channelsCache.set(activityConfig.RETURN_CHANNEL_ID, makeVoiceChannel(activityConfig.RETURN_CHANNEL_ID, 'Salon 1'));

  const guild = {
    id: config.GUILD_ID,
    ownerId: '999000',
    members: {
      cache: memberCache,
      me: {
        id: 'bot_me',
        roles: { highest: { position: botHighestPos } },
        permissions: {
          has: (bit) =>
            bit === PermissionFlagsBits.ManageRoles || bit === PermissionFlagsBits.MoveMembers,
        },
      },
      fetch:
        fetchFn ||
        (async (target) => {
          const uid = typeof target === 'string' ? target : target?.user?.[0];
          const found = memberCache.get(String(uid));
          if (!found) {
            const err = new Error('Unknown Member');
            err.code = 10007;
            throw err;
          }
          return found;
        }),
    },
    presences: { cache: presenceCache },
    voiceStates: { cache: new Collection() },
    roles: { cache: rolesCache },
    channels: { cache: channelsCache },
  };

  for (const m of members) {
    m.guild = guild;
    if (m.presence) {
      m.presence.guild = guild;
      m.presence.member = m;
    }
  }
  for (const p of presences) {
    p.guild = guild;
  }

  return guild;
}

function resetDb(month = '2026-11') {
  database.data.registrations = [];
  database.data.activityPrefs = {};
  database.data.activityStats = { month, users: {} };
  database.data.activityAllTime = { since: BASE_NOW_MS, games: {} };
  database.data.activityManual = { day: '2026-11-15', users: {} };
  database.data.activityMeta = {
    announcedAt: BASE_NOW_MS,
    returnAnnouncedAt: BASE_NOW_MS,
    manualAnnouncedAt: BASE_NOW_MS,
    voiceRoleAnnouncedAt: BASE_NOW_MS,
    lastResetMonth: month,
  };
  database.save();
  statsRoutes.clearSummaryCache();
  statsRoutes.clearTopGamesCache();
  statsRoutes.clearMemberLookupCache();
}

function createIsolatedTracker(clock, { customConfig = null, logger = null } = {}) {
  const silentLogger = logger || { log: () => {}, warn: () => {}, error: () => {} };
  return new ActivityTracker({
    db: database,
    config: customConfig || activityConfig,
    nowFn: () => clock.now(),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
    logger: silentLogger,
  });
}

test.after(() => {
  activityTrackerSingleton.sessions.clear();
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (_) {}
});

// ============================================================================
// AKTİF SAYI TESTLERİ (T1–T5)
// ============================================================================

test('T1) 20 kayıtlı/aday üye: 5 ayrılmış, 3 takibi kapalı, 2 bot/kayıtsız, 4 süresi 0, 6 geçerli aktif -> activeThisMonth === 6', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const membersInGuild = [];

  // 6 geçerli aktif kayıtlı üye (>= 1 dk, sunucuda, insan, takip açık)
  for (let i = 1; i <= 6; i++) {
    const uid = `10000000000000000${i}`;
    database.data.registrations.push({ discordId: uid, name: `Active${i}` });
    database.data.activityStats.users[uid] = { games: { tsb: 180 } };
    membersInGuild.push(makeMockMember({ id: uid, registered: true }));
  }

  // 5 sunucudan ayrılmış kayıtlı üye (cache'te yok, fetch 10007 Unknown Member döner)
  for (let i = 1; i <= 5; i++) {
    const uid = `20000000000000000${i}`;
    database.data.registrations.push({ discordId: uid, name: `Left${i}` });
    database.data.activityStats.users[uid] = { games: { cs2: 600 } };
  }

  // 3 takibi kapalı kayıtlı üye
  for (let i = 1; i <= 3; i++) {
    const uid = `30000000000000000${i}`;
    database.data.registrations.push({ discordId: uid, name: `OptOut${i}` });
    database.data.activityPrefs[uid] = { tracking: false, autoMove: false };
    database.data.activityStats.users[uid] = { games: { minecraft: 900 } };
    membersInGuild.push(makeMockMember({ id: uid, registered: true }));
  }

  // 2 bot / kayıtsız üye (1 bot + 1 kayıtsız insan)
  const botUid = '400000000000000001';
  const unregUid = '400000000000000002';
  database.data.activityStats.users[botUid] = { games: { cs2: 600 } };
  database.data.activityStats.users[unregUid] = { games: { cs2: 600 } };
  membersInGuild.push(makeMockMember({ id: botUid, registered: true, isBot: true }));
  membersInGuild.push(makeMockMember({ id: unregUid, registered: false, isBot: false }));

  // 4 süresi 0 (veya MIN_ACTIVE_MINUTES altında) kayıtlı üye
  for (let i = 1; i <= 4; i++) {
    const uid = `50000000000000000${i}`;
    database.data.registrations.push({ discordId: uid, name: `Zero${i}` });
    if (i <= 2) {
      database.data.activityStats.users[uid] = { games: { zula: 0 } };
    } else if (i === 3) {
      database.data.activityStats.users[uid] = { games: { zula: 30 } }; // < 60 sn (MIN_ACTIVE_MINUTES=1)
    }
    membersInGuild.push(makeMockMember({ id: uid, registered: true }));
  }

  database.save();

  const guild = createMockGuild({ members: membersInGuild });
  const lookupState = { cache: new Map(), cooldowns: new Map() };
  const summary = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState,
  });

  assert.equal(summary.activeThisMonth, 6);
  assert.equal(summary.playingNow, 0);
  assert.equal(summary.uncertainCount, 0);

  // guildMemberRemove ayrılan üyenin kendi activityStats kaydını temizlemeli
  const leavingUid = '100000000000000001';
  guildMemberRemoveEvent.execute({ id: leavingUid, user: { id: leavingUid } });
  assert.equal(database.data.activityStats.users[leavingUid], undefined);
  assert.equal(database.data.activityStats.users['100000000000000002'].games.tsb, 180);
});

test('T2) Bir üyenin 3+ farklı oyun/aile anahtarı olsa da activeThisMonth içinde TEK kez sayılır', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '111111111111111111';

  database.data.registrations.push({ discordId: uid, name: 'MultiGamer' });
  database.data.activityStats.users[uid] = {
    games: {
      roblox_unknown: 300,
      tsb: 400,
      minecraft: 500,
      cs2: 600,
      zula: 200,
    },
  };
  database.save();

  const guild = createMockGuild({ members: [makeMockMember({ id: uid, registered: true })] });
  const summary = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState: { cache: new Map(), cooldowns: new Map() },
  });

  assert.equal(summary.activeThisMonth, 1);
});

test('T3) Bayat oturum playingNow içine girmez; presence yoksa uncertainCount artar; canlı onaylı oturum sayılır', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);

  const liveUid = '211111111111111111';
  const staleUid = '222222222222222222';
  const noPresenceUid = '233333333333333333';

  for (const uid of [liveUid, staleUid, noPresenceUid]) {
    database.data.registrations.push({ discordId: uid, name: `Player_${uid.slice(-2)}` });
  }
  database.save();

  const liveMember = makeMockMember({
    id: liveUid,
    registered: true,
    presence: makePlayingPresence({ userId: liveUid, name: 'Minecraft' }),
  });
  const staleMember = makeMockMember({
    id: staleUid,
    registered: true,
    presence: makePlayingPresence({ userId: staleUid, name: null, status: 'online' }),
  });
  const noPresenceMember = makeMockMember({
    id: noPresenceUid,
    registered: true,
    presence: null,
  });

  const now = clock.now();
  for (const [uid, gid, fam] of [
    [liveUid, 'minecraft', 'minecraft'],
    [staleUid, 'cs2', 'cs2'],
    [noPresenceUid, 'tsb', 'roblox'],
  ]) {
    tracker.sessions.set(uid, {
      userId: uid,
      gameId: gid,
      family: fam,
      confirmed: true,
      currentlyDetectedGameId: gid,
      since: now - 300_000,
      lastAccountedAt: now - 60_000,
      lastCheckpointAt: now - 60_000,
      lastSeen: now,
    });
  }

  const guild = createMockGuild({ members: [liveMember, staleMember, noPresenceMember] });
  const summary = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: now,
    lookupState: { cache: new Map(), cooldowns: new Map() },
  });

  assert.equal(summary.playingNow, 1, 'Sadece canlı presence ile doğrulanmış oturum sayılmalı');
  assert.equal(summary.uncertainCount, 1, 'Presence verisi olmayan oturum uncertainCount içine girmeli');
  assert.equal(summary.activeThisMonth, 1, 'Bayat ve belirsiz oturumlar activeThisMonth içine eklenmemeli');
});

test('T4) /oyun manuel rolü olan ama oturumu/süresi olmayan üye activeThisMonth ve playingNow içine girmez', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '311111111111111111';

  database.data.registrations.push({ discordId: uid, name: 'MobilePlayer' });
  // /oyun komutu yalnızca activityManual tablosuna yazar, activityStats'a yazmaz
  database.setManualActivityRole(uid, 'roblox', { day: '2026-11-15', immediate: true });

  const guild = createMockGuild({ members: [makeMockMember({ id: uid, registered: true })] });
  const summary = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState: { cache: new Map(), cooldowns: new Map() },
  });

  assert.equal(summary.activeThisMonth, 0);
  assert.equal(summary.playingNow, 0);
});

test('T5) Önbellekte olmayan üyelerde fetch sınırı (SAYIM_MEMBER_LOOKUP_CAP=25), kullanıcı beklemesi (10 dk) ve geçici fetch hatası koruması çalışır', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);

  for (let i = 1; i <= 30; i++) {
    const uid = `6000000000000000${String(i).padStart(2, '0')}`;
    database.data.registrations.push({ discordId: uid, name: `Remote${i}` });
    database.data.activityStats.users[uid] = { games: { cs2: 300 } };
  }
  database.save();

  const fetchCalls = [];
  const guild = createMockGuild({
    members: [],
    fetchFn: async (uid) => {
      assert.equal(typeof uid, 'string', 'Toplu guild.members.fetch({ limit }) ASLA çağrılmamalı');
      fetchCalls.push(uid);
      const idx = Number(uid.slice(-2));
      if (idx <= 20) return makeMockMember({ id: uid, registered: true });
      if (idx <= 22) throw new Error('503 Service Unavailable');
      const err = new Error('Unknown Member');
      err.code = 10007;
      throw err;
    },
  });

  const lookupState = { cache: new Map(), cooldowns: new Map() };

  // 1. Tur: en fazla 25 fetch (20 aktif + 2 geçici hata + 3 ayrılmış + 5 cap aşımı belirsiz)
  const first = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState,
  });

  assert.equal(fetchCalls.length, activityConfig.SAYIM_MEMBER_LOOKUP_CAP);
  assert.equal(first.activeThisMonth, 20);
  assert.equal(first.uncertainCount, 7);

  // 2. Tur (1 dk sonra): İlk 23 saatlik önbellekten (0 fetch), 2 hatalı 10 dk cooldown'da, kalan 5 fetch edilir
  fetchCalls.length = 0;
  clock.setNow(clock.now() + 60_000);
  const second = await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState,
  });

  assert.equal(fetchCalls.length, 5);
  assert.equal(second.activeThisMonth, 20);
  assert.equal(second.uncertainCount, 2);

  // 3. Tur (11 dk sonra): 10 dk cooldown doldu, 2 hatalı üye tekrar denenebilir
  fetchCalls.length = 0;
  clock.setNow(clock.now() + 11 * 60_000);
  await statsRoutes.computeServerStatsSummary({
    guild,
    db: database,
    tracker,
    nowMs: clock.now(),
    lookupState,
  });
  assert.equal(fetchCalls.length, 2);
});

// ============================================================================
// SÜRE TESTLERİ (S1–S11)
// ============================================================================

test('S1) Delta esaslı toplama: 10 checkpoint sonunda toplam süre tam gerçek geçen süreye eşit (kümülatif katlama YOK)', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '710000000000000001';
  const member = makeMockMember({
    id: uid,
    presence: makePlayingPresence({ userId: uid, name: 'Minecraft' }),
  });
  const guild = createMockGuild({ members: [member] });
  tracker.guild = guild;

  await tracker.handlePresenceUpdate(null, member.presence);
  await clock.advance(activityConfig.TIMINGS.CONFIRM_SEC * 1000);
  // İlk checkpoint (onay süresini sıfırlayalım ki sonraki 10 checkpoint'in her biri tam 60 sn eklesin)
  tracker.runCheckpoint();
  const afterInitialConfirm = database.getUserMonthlyTotalSeconds(uid);
  assert.equal(afterInitialConfirm, activityConfig.TIMINGS.CONFIRM_SEC);

  for (let i = 1; i <= 10; i++) {
    await clock.advance(60_000);
    tracker.runCheckpoint();
    assert.equal(
      database.getUserMonthlyTotalSeconds(uid) - afterInitialConfirm,
      i * 60,
      `${i}. checkpoint sonunda yalnızca delta (+60 sn) eklenmiş olmalı`
    );
  }

  const totalRealElapsedSec = Math.floor((clock.now() - BASE_NOW_MS) / 1000);
  assert.equal(database.getUserMonthlyTotalSeconds(uid), totalRealElapsedSec);
});

test('S2) Bot 30 dk kapalı kalırsa o 30 dk eklenmez; açılışta saat açılıştan başlar; büyük boşluk kırpılır ve sayaç artar', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '720000000000000001';

  const member = makeMockMember({
    id: uid,
    presence: makePlayingPresence({
      userId: uid,
      name: 'Counter-Strike 2',
      timestamps: { start: clock.now() - 30 * 60_000 },
    }),
  });
  const guild = createMockGuild({ members: [member] });
  await tracker.initForGuild(guild);

  assert.equal(database.getUserMonthlyTotalSeconds(uid), 0, 'Açılışta geçmiş 30 dk eklenmemeli');
  const seeded = tracker.sessions.get(uid);
  assert.ok(seeded && seeded.confirmed);
  assert.equal(seeded.lastCheckpointAt, clock.now());

  // Olay döngüsü / saat 30 dk sıçrarsa -> MAX_DELTA_SEC (120 sn) ile kırpılır, boşluk kırpıldı artar
  clock.setNow(clock.now() + 30 * 60_000);
  tracker.runCheckpoint();

  assert.equal(
    database.getUserMonthlyTotalSeconds(uid),
    activityConfig.TIMINGS.MAX_DELTA_SEC,
    '30 dk boşluk MAX_DELTA_SEC (120 sn) ile kırpılmalı'
  );
  assert.equal(tracker.counters.gapClamped, 1);
});

test('S3) Aynı üye için aynı anda iki oturum (roblox_unknown + tsb): saniye başına yalnızca BİR oyuna süre yazılır', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '730000000000000001';

  // (a) Discord presence'ında hem Roblox hem TSB birlikte gelirse detectGame tek oyun (tsb) seçer
  const dualPresence = {
    userId: uid,
    status: 'online',
    activities: [
      { type: ActivityType.Playing, name: 'Roblox' },
      { type: ActivityType.Playing, name: 'The Strongest Battlegrounds' },
    ],
  };
  const detected = activityTrackerSingleton.detectGame(dualPresence, activityConfig, new Set());
  assert.equal(detected.gameId, 'tsb');

  // (b) Hata durumunda aynı kullanıcı için iki çakışan oturum listeye girse bile _flushSessionsList yalnızca en son başlayana yazar
  const t0 = clock.now();
  const oldSession = {
    userId: uid,
    gameId: 'roblox_unknown',
    family: 'roblox',
    confirmed: true,
    currentlyDetectedGameId: 'roblox_unknown',
    since: t0 - 60_000,
    lastAccountedAt: t0,
    lastCheckpointAt: t0,
  };
  const newerSession = {
    userId: uid,
    gameId: 'tsb',
    family: 'roblox',
    confirmed: true,
    currentlyDetectedGameId: 'tsb',
    since: t0 - 10_000,
    lastAccountedAt: t0,
    lastCheckpointAt: t0,
  };

  clock.setNow(t0 + 60_000);
  tracker._flushSessionsList([oldSession, newerSession], clock.now());

  const totalSec = database.getUserMonthlyTotalSeconds(uid);
  assert.equal(totalSec, 60, '60 sn gerçek sürede toplam 60 sn\'yi aşamaz');
  assert.equal(database.data.activityStats.users[uid].games.tsb, 60, 'En son başlayan oturuma yazılmalı');
  assert.equal(database.data.activityStats.users[uid].games.roblox_unknown || 0, 0);
  assert.ok(tracker.counters.doubleCountBlocked >= 1, 'Çift sayım engellendi sayacı artmalı');
});

test('S4) Oyun değişimi A -> B: süre ikiye bölünür, çift sayım yok', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '740000000000000001';

  const member = makeMockMember({
    id: uid,
    presence: makePlayingPresence({ userId: uid, name: 'Minecraft' }),
  });
  const guild = createMockGuild({ members: [member] });
  tracker.guild = guild;

  await tracker.handlePresenceUpdate(null, member.presence);
  await clock.advance(activityConfig.TIMINGS.CONFIRM_SEC * 1000);
  await clock.advance(60_000);

  // CS2'ye geçiş
  const cs2Presence = makePlayingPresence({
    userId: uid,
    name: 'Counter-Strike 2',
    guild,
    member,
  });
  member.presence = cs2Presence;
  await tracker.handlePresenceUpdate(null, cs2Presence);
  await clock.advance(activityConfig.TIMINGS.CONFIRM_SEC * 1000);
  await clock.advance(60_000);
  tracker.runCheckpoint();

  const games = database.data.activityStats.users[uid]?.games || {};
  const mcSec = games.minecraft || 0;
  const cs2Sec = games.cs2 || 0;
  const totalElapsed = Math.floor((clock.now() - BASE_NOW_MS) / 1000);

  assert.ok(mcSec >= 60, `Minecraft en az 60 sn olmalı (alınan: ${mcSec})`);
  assert.ok(cs2Sec >= 60, `CS2 en az 60 sn olmalı (alınan: ${cs2Sec})`);
  assert.ok(mcSec + cs2Sec <= totalElapsed, `Toplam (${mcSec + cs2Sec}) gerçek süreyi (${totalElapsed}) aşmamalı`);
});

test('S5) Discord timestamps.start (2 saat önce) süreye eklenmez; yalnızca onayda kullanılır', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '750000000000000001';
  const twoHoursAgo = clock.now() - 2 * 3600 * 1000;

  const member = makeMockMember({
    id: uid,
    presence: makePlayingPresence({
      userId: uid,
      name: 'Zula',
      timestamps: { start: twoHoursAgo },
    }),
  });
  const guild = createMockGuild({ members: [member] });
  tracker.guild = guild;

  await tracker.handlePresenceUpdate(null, member.presence);
  await clock.advance(activityConfig.TIMINGS.CONFIRM_SEC * 1000);

  const session = tracker.sessions.get(uid);
  assert.ok(session && session.confirmed, 'Oturum onaylanmalı');
  assert.equal(session.activityStartedAt, twoHoursAgo, 'timestamps.start yalnızca etkinlik başlangıç bilgisi/onay için saklanır');
  assert.equal(session.lastCheckpointAt, BASE_NOW_MS, 'Süre saati botun ilk gözlem anından başlar, 2 saat öncesinden DEĞİL');

  await clock.advance(60_000);
  tracker.runCheckpoint();
  assert.equal(
    database.getUserMonthlyTotalSeconds(uid),
    activityConfig.TIMINGS.CONFIRM_SEC + 60,
    'Geçmiş 2 saat (7200 sn) süreye ASLA eklenmemeli; yalnızca botun gözlemlediği 75 sn sayılmalı'
  );
});

test('S6) STOP_GRACE_SEC bekleme süresi toplama dahil edilmez', async () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '760000000000000001';

  const member = makeMockMember({
    id: uid,
    presence: makePlayingPresence({
      userId: uid,
      name: 'Minecraft',
      timestamps: { start: clock.now() - 60_000 }, // anında onay
    }),
  });
  const guild = createMockGuild({ members: [member] });
  tracker.guild = guild;

  await tracker.handlePresenceUpdate(null, member.presence);
  await clock.advance(40_000); // Tam 40 sn oynandı

  // Oyunu kapattı -> STOP_GRACE_SEC (5 sn) bekleme başlar
  const emptyPresence = makePlayingPresence({ userId: uid, name: null, guild, member });
  const prevPresence = member.presence;
  member.presence = emptyPresence;
  await tracker.handlePresenceUpdate(prevPresence, emptyPresence);

  // STOP_GRACE_SEC (5 sn) geçsin
  await clock.advance((activityConfig.TIMINGS.STOP_GRACE_SEC + 2) * 1000);

  assert.equal(
    database.getUserMonthlyTotalSeconds(uid),
    40,
    'STOP_GRACE_SEC (5 sn) süreye dahil edilmemeli; yalnızca oyun bırakılana kadar geçen 40 sn sayılmalı'
  );
});

test('S7) Ay dönümünde yarım kalan oturum eski ve yeni aya tam sınırda bölünür (kayıp yok, çift yazım yok)', async () => {
  const beforeMidnightMs = Date.parse('2026-11-30T23:59:30+03:00');
  const afterMidnightMs = Date.parse('2026-12-01T00:00:30+03:00');
  resetDb('2026-11');
  database.data.activityAllTime = { since: beforeMidnightMs, games: {} };
  database.save();

  const clock = createFakeClock(beforeMidnightMs);
  const tracker = createIsolatedTracker(clock);
  const uid = '770000000000000001';

  tracker.sessions.set(uid, {
    userId: uid,
    gameId: 'cs2',
    family: 'cs2',
    confirmed: true,
    currentlyDetectedGameId: 'cs2',
    since: beforeMidnightMs,
    lastAccountedAt: beforeMidnightMs,
    lastCheckpointAt: beforeMidnightMs,
    lastSeen: beforeMidnightMs,
  });

  clock.setNow(afterMidnightMs);
  const res = await tracker.checkMonthlyReset(createMockGuild(), new Date(afterMidnightMs));

  assert.equal(res.reset, true);
  assert.equal(res.month, '2026-12');
  assert.equal(database.data.activityAllTime.games.cs2, 30, 'Eski aya tam 30 sn arşivlenmeli');
  assert.equal(database.data.activityStats.month, '2026-12');
  assert.equal(database.data.activityStats.users[uid].games.cs2, 30, 'Yeni aya tam 30 sn yazılmalı');
  assert.equal(database.data.activityAllTime.games.cs2 + database.data.activityStats.users[uid].games.cs2, 60);
});

test('S8) Dinleyici çift kaydı yok: createConfiguredClient presenceUpdate ve voiceStateUpdate için 1 dinleyici kaydeder', () => {
  const client = createConfiguredClient({ includePresenceIntent: false });
  try {
    assert.equal(client.listenerCount(Events.PresenceUpdate), 1);
    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 1);
  } finally {
    client.destroy();
  }
});

test('S9) Merkezi formatDuration sınır durumları: 0, 59 sn, 60 dk, 119.6 dk, 41 sa 47 dk ve NaN/Infinity koruması', () => {
  const f = activityConfig.formatDuration;

  assert.equal(f(0, 'tr'), '0 dk');
  assert.equal(f(0, 'en'), '0 min');

  assert.equal(f(59, 'tr'), "1 dk'dan az");
  assert.equal(f(59, 'en'), '<1 min');

  assert.equal(f(3600, 'tr'), '1 sa');
  assert.equal(f(3600, 'en'), '1 hr');

  assert.equal(f(119.6 * 60, 'tr'), '1 sa 59 dk');
  assert.equal(f(119.6 * 60, 'en'), '1 hr 59 min');

  assert.equal(f(41 * 3600 + 47 * 60, 'tr'), '41 sa 47 dk');
  assert.equal(f(41 * 3600 + 47 * 60, 'en'), '41 hr 47 min');

  for (const bad of [NaN, Infinity, -Infinity, -50, undefined, null, 'abc']) {
    const trOut = f(bad, 'tr');
    const enOut = f(bad, 'en');
    assert.equal(trOut, '0 dk');
    assert.equal(enOut, '0 min');
    assert.ok(!/NaN|Infinity|undefined/i.test(trOut));
    assert.ok(!/NaN|Infinity|undefined/i.test(enOut));
  }
});

test('S10) B3 invariantı: ay başından geçen süreyi aşan üye çalışma anında kırpılır ve çiftSayımEngellendi artar', () => {
  const earlyMonthMs = Date.parse('2026-11-01T00:05:00+03:00');
  resetDb('2026-11');
  const clock = createFakeClock(earlyMonthMs);
  const tracker = createIsolatedTracker(clock);
  const uid = '790000000000000001';

  database.data.activityStats.users[uid] = { games: { cs2: 290 } };
  database.save();

  const session = {
    userId: uid,
    gameId: 'cs2',
    family: 'cs2',
    confirmed: true,
    currentlyDetectedGameId: 'cs2',
    since: earlyMonthMs - 60_000,
    lastAccountedAt: earlyMonthMs - 60_000,
    lastCheckpointAt: earlyMonthMs - 60_000,
  };

  tracker._flushSessionElapsed(session, earlyMonthMs);

  assert.equal(database.getUserMonthlyTotalSeconds(uid), 300, 'Ay başından geçen 300 sn sınırı aşılmamalı');
  assert.equal(tracker.counters.doubleCountBlocked, 1);

  database.data.activityStats.users[uid].games.cs2 = 9999;
  const health = tracker.checkDurationHealth(earlyMonthMs);
  assert.equal(health.oversizedUserCount, 1);
  assert.equal(health.totalExcessSeconds, 9999 - 300);
});

test('S11) REPAIR_OVERSIZED_TOTALS_ON_START varsayılan kapalıdır: mevcut şişmiş veri açılışta DEĞİŞTİRİLMEZ', async () => {
  assert.equal(activityConfig.REPAIR_OVERSIZED_TOTALS_ON_START, false);

  const earlyMonthMs = Date.parse('2026-11-01T00:10:00+03:00'); // ay başından beri 600 sn geçmiş
  resetDb('2026-11');
  const uid = '799000000000000001';
  database.data.activityStats.users[uid] = { games: { roblox_unknown: 50_000, tsb: 10_000 } };
  database.save();

  const clock = createFakeClock(earlyMonthMs);
  const tracker = createIsolatedTracker(clock);
  await tracker.initForGuild(createMockGuild());

  // Varsayılan bayrak kapalı: mevcut kayıt TEK SANİYE bile değişmemeli
  assert.equal(database.data.activityStats.users[uid].games.roblox_unknown, 50_000);
  assert.equal(database.data.activityStats.users[uid].games.tsb, 10_000);

  // Onay verildiğinde (REPAIR_OVERSIZED_TOTALS_ON_START: true) ise kırpar ve kimliksiz log atar
  const logs = [];
  const optInTracker = createIsolatedTracker(clock, {
    customConfig: { ...activityConfig, REPAIR_OVERSIZED_TOTALS_ON_START: true },
    logger: { log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: () => {} },
  });
  await optInTracker.initForGuild(createMockGuild());

  assert.equal(database.getUserMonthlyTotalSeconds(uid), 600);
  assert.ok(logs.some((line) => line.includes('[OYUN ETKİNLİĞİ ONARIM]')));
  assert.ok(logs.every((line) => !line.includes(uid)), 'Onarım logu kullanıcı ID içermemeli');
});

// ============================================================================
// ROBLOX GRUPLAMA TESTLERİ (G1–G8)
// ============================================================================

test('G1–G4 & G8) Tüm 7 Roblox anahtarı tek "Roblox" satırında toplanır, benzersiz oyuncu üye başına 1, Minecraft/CS2/Zula ayrı, saklama anahtarları değişmez', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);

  database.data.activityStats.users['810000000000000001'] = {
    games: {
      roblox_unknown: 1000,
      tsb: 2000,
      bonk: 300,
      apeirophobia: 400,
      scp: 500,
      jailbreak: 600,
      erlc: 700,
      minecraft: 3000,
    },
  };
  database.data.activityStats.users['810000000000000002'] = {
    games: {
      tsb: 500,
      cs2: 4000,
      zula: 1200,
    },
  };
  database.save();

  const trStats = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'tr',
    db: database,
    tracker,
    nowMs: clock.now(),
  });
  const enStats = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'en',
    db: database,
    tracker,
    nowMs: clock.now(),
  });

  // G1
  const robloxTr = trStats.families.find((f) => f.key === 'roblox');
  assert.ok(robloxTr);
  assert.equal(robloxTr.label, 'Roblox');
  assert.equal(robloxTr.emoji, activityConfig.FAMILIES.roblox.emoji);
  assert.equal(robloxTr.totalSeconds, 6000);
  assert.equal(robloxTr.uniquePlayers, 2);

  // G2
  assert.equal(trStats.families.length, 4);
  const mc = trStats.families.find((f) => f.key === 'minecraft');
  const cs2 = trStats.families.find((f) => f.key === 'cs2');
  const zula = trStats.families.find((f) => f.key === 'zula');
  assert.equal(mc.emoji, activityConfig.FAMILIES.minecraft.emoji);
  assert.equal(cs2.emoji, activityConfig.FAMILIES.cs2.emoji);
  assert.equal(zula.emoji, activityConfig.FAMILIES.zula.emoji);
  assert.equal(mc.totalSeconds, 3000);
  assert.equal(cs2.totalSeconds, 4000);
  assert.equal(zula.totalSeconds, 1200);

  // G3
  assert.deepEqual(
    trStats.families.map((f) => f.key),
    ['roblox', 'cs2', 'minecraft', 'zula']
  );

  // G4
  const trJson = JSON.stringify(trStats);
  const enJson = JSON.stringify(enStats);
  assert.ok(!/Roblox \(diğer\)|Roblox \(other\)|oyun bilinmiyor|unknown game/i.test(trJson));
  assert.ok(!/Roblox \(diğer\)|Roblox \(other\)|oyun bilinmiyor|unknown game/i.test(enJson));

  // G8
  const storedGames = database.data.activityStats.users['810000000000000001'].games;
  assert.equal(storedGames.roblox_unknown, 1000);
  assert.equal(storedGames.tsb, 2000);
  assert.equal(storedGames.erlc, 700);
  assert.equal(storedGames.roblox, undefined);
});

test('G5) /aktivitem çıktısı ile GET /api/member/:id/activity aynı Roblox gruplamasını ve süreyi kullanır', async () => {
  resetDb('2026-11');
  const uid = '820000000000000001';
  database.data.activityStats.users[uid] = {
    games: { roblox_unknown: 1200, tsb: 2400, jailbreak: 600, cs2: 900 },
  };
  database.save();

  const member = makeMockMember({ id: uid, username: 'g5oyuncu', registered: true });
  const guild = createMockGuild({ members: [member] });
  const guildsCache = new Collection();
  guildsCache.set(config.GUILD_ID, guild);

  const mockClient = {
    isReady: () => true,
    user: { id: 'bot999', tag: 'PiyadeBot#0001' },
    guilds: { cache: guildsCache },
  };

  const app = createApp(mockClient);
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const port = srv.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/member/${uid}/activity?lang=tr`, {
      headers: { Authorization: `Bearer ${process.env.API_SECRET}` },
    });
    assert.equal(res.status, 200);
    const apiBody = await res.json();

    const cmdSummary = aktivitemCommand.computeUserActivitySummary({
      userId: uid,
      lang: 'tr',
      db: database,
      tracker: activityTrackerSingleton,
    });

    assert.equal(apiBody.totalSeconds, cmdSummary.totalSeconds);
    assert.equal(apiBody.totalSeconds, 5100);
    assert.equal(apiBody.families.length, 2);
    assert.equal(apiBody.families[0].key, 'roblox');
    assert.equal(apiBody.families[0].label, 'Roblox');
    assert.equal(apiBody.families[0].totalSeconds, 4200);
    assert.equal(apiBody.families[0].formattedDuration, '1 sa 10 dk');

    assert.equal(cmdSummary.games.length, 2);
    assert.equal(cmdSummary.games[0].id, 'roblox');
    assert.equal(cmdSummary.games[0].name, 'Roblox');
    assert.equal(cmdSummary.games[0].seconds, 4200);
    assert.equal(cmdSummary.games[0].formattedDuration, '1 sa 10 dk');
  } finally {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('G6) SHOW_FAMILY_BREAKDOWN kapalıyken alt satır yok; açıkken en çok 5 oyun + "+2 diğer" / "+2 more"', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);

  database.data.activityStats.users['830000000000000001'] = {
    games: {
      tsb: 3600,
      jailbreak: 3000,
      erlc: 2400,
      scp: 1800,
      bonk: 1200,
      apeirophobia: 600,
      roblox_unknown: 300,
    },
  };
  database.save();

  assert.equal(activityConfig.SHOW_FAMILY_BREAKDOWN, false);
  const withoutBreakdown = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'tr',
    db: database,
    tracker,
    nowMs: clock.now(),
  });
  assert.equal(withoutBreakdown.families[0].breakdown, undefined);

  const withTr = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'tr',
    showBreakdown: true,
    db: database,
    tracker,
    nowMs: clock.now(),
  });
  const bdTr = withTr.families[0].breakdown;
  assert.ok(bdTr);
  assert.equal(bdTr.items.length, 5);
  assert.equal(bdTr.overflowCount, 2);
  assert.ok(bdTr.formattedLine.includes('+2 diğer'));

  const withEn = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'en',
    showBreakdown: true,
    db: database,
    tracker,
    nowMs: clock.now(),
  });
  assert.ok(withEn.families[0].breakdown.formattedLine.includes('+2 more'));
});

test('G7) Eşlenemeyen oyun anahtarı çökme yaratmaz ve 🛠️ Sistem Durumu sağlık özetinde kimliksiz raporlanır', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '840000000000000001';

  database.data.activityStats.users[uid] = {
    games: {
      roblox_unknown: 100,
      tsb: 600,
      bonk: 200,
      mystery_unmapped_game: 900,
    },
  };
  database.save();

  const stats = statsRoutes.computeTopGamesStats({
    scope: 'month',
    lang: 'tr',
    db: database,
    tracker,
    nowMs: clock.now(),
  });
  assert.equal(stats.families.length, 2);
  const unknownRow = stats.families.find((f) => f.key === 'mystery_unmapped_game');
  assert.ok(unknownRow);
  assert.equal(unknownRow.totalSeconds, 900);

  const health = tracker.inspectFamilyGroupingHealth();
  assert.equal(health.robloxKeysFound.length, 3);
  assert.deepEqual(health.unmappedKeys, ['mystery_unmapped_game']);

  const statusPayload = aktivitemCommand.buildSystemStatusPayload({
    guild: createMockGuild(),
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.ok(statusPayload.content.includes('mystery_unmapped_game'));
  assert.ok(!statusPayload.content.includes(uid), 'Kullanıcı ID Sistem Durumunda görünmemeli');
});

// ============================================================================
// SÖZLEŞME VE SİSTEM DURUMU / GİZLİLİK TESTLERİ (C1, D1–D3)
// ============================================================================

test('C1) Bot istatistik uçları eski alanları korur, yeni alanları ekler ve KULLANICI KİMLİĞİ/ADI İÇERMEZ', async () => {
  resetDb('2026-11');
  const secretUid = '850000000000000099';
  const secretName = 'GizliOyuncuAdiXYZ';
  database.data.registrations.push({ discordId: secretUid, name: secretName });
  database.data.activityStats.users[secretUid] = {
    games: { tsb: 1800, roblox_unknown: 600, minecraft: 1200 },
  };
  database.save();

  const member = makeMockMember({
    id: secretUid,
    username: secretName,
    registered: true,
    presence: makePlayingPresence({ userId: secretUid, name: 'Roblox' }),
  });
  const guild = createMockGuild({ members: [member] });
  const guildsCache = new Collection();
  guildsCache.set(config.GUILD_ID, guild);

  const mockClient = {
    isReady: () => true,
    user: { id: 'bot999', tag: 'PiyadeBot#0001' },
    guilds: { cache: guildsCache },
  };

  const app = createApp(mockClient);
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const port = srv.address().port;
    const headers = { Authorization: `Bearer ${process.env.API_SECRET}` };

    const sumRes = await fetch(`http://127.0.0.1:${port}/api/stats/summary?lang=tr`, { headers });
    assert.equal(sumRes.status, 200);
    const sumBody = await sumRes.json();

    // Yeni alanlar
    assert.equal(typeof sumBody.activeThisMonth, 'number');
    assert.equal(typeof sumBody.playingNow, 'number');
    assert.equal(typeof sumBody.uncertainCount, 'number');
    assert.ok(typeof sumBody.computedAt === 'string' && Number.isFinite(Date.parse(sumBody.computedAt)));
    assert.ok(Array.isArray(sumBody.families));
    assert.equal(sumBody.families[0].key, 'roblox');
    assert.equal(sumBody.families[0].label, 'Roblox');
    assert.equal(sumBody.families[0].totalSeconds, 2400);
    assert.equal(sumBody.families[0].uniquePlayers, 1);
    assert.equal(sumBody.families[0].rank, 1);

    // Eski alanlar (eski site geriye dönük uyumluluk)
    assert.equal(typeof sumBody.activeRegisteredCount, 'number');
    assert.equal(typeof sumBody.totalMemberCount, 'number');
    assert.equal(typeof sumBody.onlineCount, 'number');
    assert.equal(typeof sumBody.playingCount, 'number');
    assert.equal(typeof sumBody.updatedAt, 'number');

    const topRes = await fetch(`http://127.0.0.1:${port}/api/stats/top-games?scope=month&lang=tr`, { headers });
    assert.equal(topRes.status, 200);
    const topBody = await topRes.json();
    assert.ok(Array.isArray(topBody.families));
    assert.ok(Array.isArray(topBody.games));
    assert.equal(topBody.games[0].id, 'roblox');
    assert.equal(topBody.games[0].name, 'Roblox');
    assert.ok(typeof topBody.computedAt === 'string');

    // Gizlilik: hiçbir yanıtta kullanıcı kimliği veya kullanıcı adı YOK
    const combinedRaw = JSON.stringify({ sumBody, topBody });
    assert.ok(!combinedRaw.includes(secretUid));
    assert.ok(!combinedRaw.includes(secretName));
  } finally {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('D1) 🛠️ Sistem Durumu yalnızca Developer yetkisinde çalışır, yeni sağlık alanlarını gösterir ve <= 2000 karakterdir', () => {
  resetDb('2026-11');
  const earlyMonthMs = Date.parse('2026-11-01T00:05:00+03:00');
  const clock = createFakeClock(earlyMonthMs);
  const tracker = createIsolatedTracker(clock);
  const uid = '860000000000000001';

  tracker.counters.gapClamped = 3;
  tracker.counters.doubleCountBlocked = 2;
  database.data.activityStats.users[uid] = { games: { tsb: 9000, orphan_key: 60 } };
  database.save();

  tracker.updateLastStatsSummary({
    activeThisMonth: 7,
    playingNow: 2,
    uncertainCount: 1,
    computedAt: new Date(earlyMonthMs).toISOString(),
  });

  const normalMember = makeMockMember({ id: '9001', registered: true, isDeveloper: false });
  const devMember = makeMockMember({ id: '9002', registered: true, isDeveloper: true });
  assert.equal(aktivitemCommand.hasSystemStatusAuthority(normalMember), false);
  assert.equal(aktivitemCommand.hasSystemStatusAuthority(devMember), true);

  const mockClient = {
    options: {
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
      ],
    },
    listenerCount: () => 1,
  };

  const trPayload = aktivitemCommand.buildSystemStatusPayload({
    guild: createMockGuild(),
    client: mockClient,
    lang: 'tr',
    tracker,
    db: database,
  });

  assert.ok(trPayload.content.length <= 2000);
  assert.ok(trPayload.content.includes('7'));
  assert.ok(trPayload.content.includes('⚠️'));
  assert.ok(trPayload.content.includes('orphan_key'));
  assert.ok(!trPayload.content.includes(uid));
});

test('D2) Konsol saatlik özeti activeThisMonth, playingNow, boşlukKırpıldı, çiftSayımEngellendi içerir ve kimlik YAZMAZ', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const logs = [];
  const tracker = createIsolatedTracker(clock, {
    logger: { log: (m) => logs.push(String(m)), warn: () => {}, error: () => {} },
  });

  const secretUid = '870000000000000077';
  tracker.counters.gapClamped = 4;
  tracker.counters.doubleCountBlocked = 1;
  tracker.updateLastStatsSummary({
    activeThisMonth: 12,
    playingNow: 3,
    uncertainCount: 0,
    computedAt: new Date(BASE_NOW_MS).toISOString(),
  });

  tracker.logCounterSummary();

  assert.equal(logs.length, 1);
  const line = logs[0];
  assert.ok(line.includes('activeThisMonth=12'));
  assert.ok(line.includes('playingNow=3'));
  assert.ok(line.includes('boşlukKırpıldı=4'));
  assert.ok(line.includes('çiftSayımEngellendi=1'));
  assert.ok(!line.includes(secretUid));
});

test('D3) Yeni kalıcı veri alanı oluşmadı; oyun geçmişi/zaman çizelgesi saklanmıyor', () => {
  resetDb('2026-11');
  const clock = createFakeClock(BASE_NOW_MS);
  const tracker = createIsolatedTracker(clock);
  const uid = '880000000000000001';

  database.addActivitySeconds(uid, 'tsb', 120, { immediate: false });
  database.setActivityPrefs(uid, { tracking: true, autoMove: true });
  database.setManualActivityRole(uid, 'roblox', { day: '2026-11-15', immediate: false });
  database.flushDirty();
  tracker.runCheckpoint();

  const onDisk = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  const activityKeys = Object.keys(onDisk).filter((k) => k.toLowerCase().includes('activity'));

  const allowedActivityKeys = new Set([
    'activityPrefs',
    'activityStats',
    'activityMeta',
    'activityManual',
    'activityAllTime',
  ]);
  for (const key of activityKeys) {
    assert.ok(allowedActivityKeys.has(key), `Beklenmeyen yeni kalıcı alan bulundu: ${key}`);
  }

  const userRecord = onDisk.activityStats.users[uid];
  assert.deepEqual(Object.keys(userRecord), ['games']);
  assert.equal(onDisk.activityHistory, undefined);
  assert.equal(onDisk.activityTimeline, undefined);
  assert.equal(onDisk.sessionHistory, undefined);
});
