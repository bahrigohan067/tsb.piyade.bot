const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Collection } = require('discord.js');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-bot-activity-api-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-activity-api-secret';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const database = require('../src/utils/database');
const activityTracker = require('../src/utils/activityTracker');
const aktivitemCommand = require('../src/commands/aktivitem');
const statsRouter = require('../src/api/routes/stats');
const { createApp } = require('../src/api/server');

function createMockMember({ id, username, displayName }) {
  const roleMap = new Collection();
  roleMap.set(config.GUILD_ID, {
    id: config.GUILD_ID,
    name: '@everyone',
    hexColor: '#000000',
    position: 0,
    hoist: false,
  });
  roleMap.set(config.ROLES.REGISTERED_MEMBER, {
    id: config.ROLES.REGISTERED_MEMBER,
    name: 'Kayıtlı',
    hexColor: '#5865f2',
    position: 10,
    hoist: true,
  });

  return {
    id,
    displayName: displayName || username,
    joinedTimestamp: 1700000000000,
    user: {
      id,
      username,
      globalName: displayName || username,
      tag: `${username}#0000`,
      bot: false,
      createdTimestamp: 1600000000000,
      displayAvatarURL: () => `https://cdn.discordapp.com/embed/avatars/0.png`,
    },
    roles: {
      cache: roleMap,
      highest: { position: 10 },
    },
  };
}

let server;
let baseUrl;

test.before(async () => {
  const membersMap = new Collection();
  for (const m of [
    createMockMember({ id: '8101', username: 'oyuncu1', displayName: 'Oyuncu Bir' }),
    createMockMember({ id: '8102', username: 'oyuncu2', displayName: 'Oyuncu İki' }),
    createMockMember({ id: '8103', username: 'oyuncu3', displayName: 'Oyuncu Üç' }),
  ]) {
    membersMap.set(m.id, m);
  }

  const mockGuild = {
    id: config.GUILD_ID,
    ownerId: '8000',
    members: {
      cache: membersMap,
      fetch: async (target) => {
        if (typeof target === 'string') {
          const found = membersMap.get(target);
          if (!found) throw new Error('Unknown Member');
          return found;
        }
        return membersMap;
      },
    },
  };

  const guildsCache = new Collection();
  guildsCache.set(config.GUILD_ID, mockGuild);

  const mockClient = {
    isReady: () => true,
    user: { id: '999999', tag: 'PiyadeBot#0001' },
    guilds: { cache: guildsCache },
  };

  const app = createApp(mockClient);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  activityTracker.sessions.clear();
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

async function apiGet(endpoint, { secret = 'test-activity-api-secret' } = {}) {
  const headers = {};
  if (secret) {
    headers['Authorization'] = `Bearer ${secret}`;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

test('1. GET /api/member/:id/activity kimlik doğrulama ve doğrulama kontrolleri', async () => {
  const unauth = await apiGet('/api/member/8101/activity', { secret: null });
  assert.equal(unauth.status, 401);

  const badId = await apiGet('/api/member/not-an-id/activity');
  assert.equal(badId.status, 400);

  const notFound = await apiGet('/api/member/999999999999/activity');
  assert.equal(notFound.status, 404);
});

test('2. GET /api/member/:id/activity canlı oturumu birleştirmeli, Roblox ailesini tek satırda toplamalı ve /aktivitem ile birebir aynı sonucu üretmeli', async () => {
  const currentMonth = database.getCurrentIstanbulMonth();
  database.data.activityStats = {
    month: currentMonth,
    users: {
      '8101': {
        games: {
          tsb: 3600,
          cs2: 1800,
          roblox_unknown: 600,
        },
      },
    },
  };
  database.data.activityPrefs = {};
  database.save();

  // Canlı oturum simülasyonu: 8101 şu an CS2 oynuyor, son checkpoint'ten beri 90 sn geçti (toplam oturum 900 sn)
  const now = activityTracker.now();
  activityTracker.sessions.set('8101', {
    userId: '8101',
    gameId: 'cs2',
    family: 'cs2',
    confirmed: true,
    currentlyDetectedGameId: 'cs2',
    since: now - 900 * 1000,
    lastCheckpointAt: now - 90 * 1000,
    lastAccountedAt: now - 90 * 1000,
  });

  const trRes = await apiGet('/api/member/8101/activity?lang=tr');
  assert.equal(trRes.status, 200);
  assert.equal(trRes.body.userId, '8101');
  assert.equal(trRes.body.month, currentMonth);
  assert.equal(trRes.body.tracking, true);
  // Roblox (tsb 3600 + roblox_unknown 600 = 4200) + CS2 (1800 + 90 = 1890) = 6090
  assert.equal(trRes.body.totalSeconds, 3600 + 600 + 1890);
  assert.equal(trRes.body.games.length, 2);
  assert.equal(trRes.body.games[0].id, 'roblox');
  assert.equal(trRes.body.games[0].name, 'Roblox');
  assert.equal(trRes.body.games[0].seconds, 4200);
  assert.equal(trRes.body.games[1].id, 'cs2');
  assert.equal(trRes.body.games[1].seconds, 1890);
  assert.ok(Array.isArray(trRes.body.families));
  assert.equal(trRes.body.families[0].key, 'roblox');
  assert.equal(trRes.body.families[0].totalSeconds, 4200);
  assert.ok(trRes.body.live);
  assert.equal(trRes.body.live.gameId, 'cs2');
  assert.ok(trRes.body.live.sessionElapsedSec >= 899);
  assert.equal(typeof trRes.body.nextResetAt, 'number');
  assert.ok(trRes.body.nextResetAt > Date.now());

  // /aktivitem komutu çıktısıyla birebir tutarlılık (Roblox tek satır, "Roblox (diğer)" yok)
  const cmdPayload = aktivitemCommand.buildActivitySummaryPayload({
    user: { id: '8101', username: 'oyuncu1' },
    member: { displayName: 'Oyuncu Bir' },
    lang: 'tr',
  });
  const embedDesc = cmdPayload.embeds[0].data.description;
  assert.ok(embedDesc.includes('🧱 **Roblox**'));
  assert.equal(embedDesc.includes('Roblox (diğer)'), false);
  assert.ok(embedDesc.includes('CS2'));
  assert.ok(embedDesc.includes('Şu an oynuyor:'));

  // İngilizce yanıt kontrolü: Roblox tek satır, "Roblox (other)" / "unknown" yok
  const enRes = await apiGet('/api/member/8101/activity?lang=en');
  assert.equal(enRes.status, 200);
  assert.equal(enRes.body.games[0].id, 'roblox');
  assert.equal(enRes.body.games[0].name, 'Roblox');
  assert.equal(JSON.stringify(enRes.body).includes('Roblox (other)'), false);
});

test('3. GET /api/member/:id/activity takip kapalıysa (tracking: false) boş liste döndürmeli', async () => {
  database.setActivityPrefs('8101', { tracking: false });
  activityTracker.sessions.delete('8101');

  const res = await apiGet('/api/member/8101/activity?lang=tr');
  assert.equal(res.status, 200);
  assert.equal(res.body.tracking, false);
  assert.deepEqual(res.body.games, []);
  assert.equal(res.body.totalSeconds, 0);
  assert.equal(res.body.live, null);

  // Tekrar aç
  database.setActivityPrefs('8101', { tracking: true });
});

test('4. GET /api/stats/top-games Roblox ailesini tek satırda toplamalı, anonim olmalı ve tracking:false hariç tutmalı', async () => {
  const currentMonth = database.getCurrentIstanbulMonth();
  database.data.activityStats = {
    month: currentMonth,
    users: {
      '8101': { games: { tsb: 7200, cs2: 3600, roblox_unknown: 1800 } },
      '8102': { games: { tsb: 3600, minecraft: 5400 } },
      '8103': { games: { zula: 99999 } }, // 8103 takibi kapatacak -> dahil edilmemeli!
    },
  };
  database.setActivityPrefs('8103', { tracking: false });
  database.save();
  statsRouter.clearTopGamesCache();

  // Yetkisiz istek -> 401
  const unauth = await apiGet('/api/stats/top-games', { secret: null });
  assert.equal(unauth.status, 401);

  const monthRes = await apiGet('/api/stats/top-games?scope=month&limit=8&lang=tr');
  assert.equal(monthRes.status, 200);
  assert.equal(monthRes.body.scope, 'month');
  assert.equal(monthRes.body.group, 'family');
  assert.equal(monthRes.body.month, currentMonth);
  assert.equal(typeof monthRes.body.computedAt, 'string');
  assert.equal(monthRes.body.totalSeconds, 7200 + 3600 + 1800 + 3600 + 5400);

  // Takibi kapalı 8103'ün Zula süresi listede OLMAMALI
  assert.equal(monthRes.body.games.find((g) => g.id === 'zula'), undefined);

  // Sıralama (gruplanmış): 1. Roblox (12600 sn, 2 benzersiz oyuncu), 2. Minecraft (5400 sn, 1 oyuncu), 3. CS2 (3600 sn, 1 oyuncu)
  assert.equal(monthRes.body.games.length, 3);
  assert.equal(monthRes.body.games[0].id, 'roblox');
  assert.equal(monthRes.body.games[0].name, 'Roblox');
  assert.equal(monthRes.body.games[0].seconds, 12600);
  assert.equal(monthRes.body.games[0].hours, 3.5);
  assert.equal(monthRes.body.games[0].players, 2);
  assert.equal(monthRes.body.games[1].id, 'minecraft');
  assert.equal(monthRes.body.games[2].id, 'cs2');

  // Yeni families sözleşmesi
  assert.ok(Array.isArray(monthRes.body.families));
  assert.equal(monthRes.body.families[0].key, 'roblox');
  assert.equal(monthRes.body.families[0].label, 'Roblox');
  assert.equal(monthRes.body.families[0].totalSeconds, 12600);
  assert.equal(monthRes.body.families[0].uniquePlayers, 2);
  assert.equal(monthRes.body.families[0].rank, 1);

  // Eski "Roblox (diğer)" hiçbir yerde görünmemeli ve kullanıcı ID'si sızmamalı
  const rawJson = JSON.stringify(monthRes.body);
  assert.equal(rawJson.includes('Roblox (diğer)'), false);
  assert.equal(rawJson.includes('8101'), false);
  assert.equal(rawJson.includes('8102'), false);
  assert.equal(rawJson.includes('8103'), false);

  // İngilizce yanıtta da etiket "Roblox" olmalı
  const familyRes = await apiGet('/api/stats/top-games?scope=month&group=family&lang=en');
  assert.equal(familyRes.status, 200);
  assert.equal(familyRes.body.families[0].key, 'roblox');
  assert.equal(familyRes.body.families[0].label, 'Roblox');
  assert.equal(familyRes.body.families[0].totalSeconds, 12600);
  assert.equal(familyRes.body.families[0].uniquePlayers, 2);
});

test('5. Aylık sıfırlama (resetActivityStatsForMonth) ve Tüm Zamanlar (scope=all) birikimi + eski DB uyumu', async () => {
  // Önceki testten kalan bu ay verileri: tsb=10800, roblox_unknown=1800, minecraft=5400, cs2=3600
  database.data.activityAllTime = {
    since: 1700000000000,
    games: {
      tsb: 3600, // Önceki aylardan 1 saat TSB var
    },
  };
  database.save();

  // Yeni aya geçiş simülasyonu
  database.resetActivityStatsForMonth('2026-12');
  statsRouter.clearTopGamesCache();

  // 1. Aylık kullanıcı verileri sıfırlanmış olmalı
  assert.deepEqual(database.data.activityStats.users, {});

  // 2. Biten ayın toplamları activityAllTime.games içine ham anahtarlarla (migrasyon yok) eklenmiş olmalı
  const allTimeAfterReset = database.getActivityAllTimeStats();
  assert.equal(allTimeAfterReset.since, 1700000000000);
  assert.equal(allTimeAfterReset.games.tsb, 14400);
  assert.equal(allTimeAfterReset.games.roblox_unknown, 1800);
  assert.equal(allTimeAfterReset.games.minecraft, 5400);
  assert.equal(allTimeAfterReset.games.cs2, 3600);

  // 3. Yeni ayda 8101 tekrar 1800 sn TSB oynasın
  database.addActivitySeconds('8101', 'tsb', 1800, { immediate: true });
  statsRouter.clearTopGamesCache();

  // scope=month yalnızca yeni ayın 1800 saniyesini gruplanmış "roblox" altında göstermeli
  const monthRes = await apiGet('/api/stats/top-games?scope=month');
  assert.equal(monthRes.body.totalSeconds, 1800);
  assert.equal(monthRes.body.families[0].key, 'roblox');
  assert.equal(monthRes.body.families[0].totalSeconds, 1800);

  // scope=all ise birikmiş tsb(14400) + roblox_unknown(1800) + yeni ay tsb(1800) = 18000 saniyeyi tek Roblox satırında göstermeli
  const allRes = await apiGet('/api/stats/top-games?scope=all');
  assert.equal(allRes.body.scope, 'all');
  assert.equal(allRes.body.since, 1700000000000);
  const allRoblox = allRes.body.families.find((f) => f.key === 'roblox');
  assert.equal(allRoblox.totalSeconds, 18000);

  // 4. Üye ayrıldığında (removeUserActivityData) veya kayıt/uyarı sıfırlandığında activityAllTime azalmamalı
  database.removeUserActivityData('8101');
  database.resetRegistrationData();
  database.resetWarningData();
  assert.equal(database.getActivityAllTimeStats().games.tsb, 14400);

  // 5. Eski database.json (activityAllTime alanı olmayan dosya) ile init() çağrıldığında çökmemeli
  const rawDbPath = path.join(tempDataDir, 'database.json');
  const parsedDisk = JSON.parse(fs.readFileSync(rawDbPath, 'utf-8'));
  delete parsedDisk.activityAllTime;
  fs.writeFileSync(rawDbPath, JSON.stringify(parsedDisk, null, 2), 'utf-8');

  database.init();
  const safeAllTime = database.getActivityAllTimeStats();
  assert.equal(typeof safeAllTime.since, 'number');
  assert.ok(safeAllTime.since > 0);
  assert.deepEqual(safeAllTime.games, {});
});

test('6. GET /api/stats/summary yeni (activeThisMonth, playingNow, uncertainCount, computedAt, families) ve eski alanları anonim döndürmeli', async () => {
  // Yetkisiz istek -> 401
  const unauth = await apiGet('/api/stats/summary', { secret: null });
  assert.equal(unauth.status, 401);

  // 8101 ve 8102 kayıtlı ve bu ay >= 1 dk süreleri var; 8101 canlı CS2 oynuyor (canlı presence ile doğrulanmış)
  const currentMonth = database.getCurrentIstanbulMonth();
  database.data.registrations = [
    { discordId: '8101', displayName: 'Oyuncu Bir', games: [{ id: 'cs2', username: 'p1' }] },
    { discordId: '8102', displayName: 'Oyuncu İki', games: [{ id: 'roblox', username: 'p2' }] },
  ];
  database.data.activityStats = {
    month: currentMonth,
    users: {
      '8101': { games: { cs2: 600 } },
      '8102': { games: { tsb: 120, roblox_unknown: 180 } },
    },
  };
  database.data.activityPrefs = {};
  database.save();
  statsRouter.clearSummaryCache();
  statsRouter.clearMemberLookupCache();

  // 8101 için canlı presence ata (playingNow doğrulaması)
  const now = activityTracker.now();
  activityTracker.sessions.set('8101', {
    userId: '8101',
    gameId: 'cs2',
    family: 'cs2',
    confirmed: true,
    currentlyDetectedGameId: 'cs2',
    since: now - 120 * 1000,
    lastCheckpointAt: now - 30 * 1000,
    lastAccountedAt: now - 30 * 1000,
  });

  // Mock sunucudaki 8101 üyesine canlı presence ekle
  const res = await apiGet('/api/stats/summary');
  assert.equal(res.status, 200);
  assert.equal(res.body.activeThisMonth, 2);
  assert.equal(res.body.activeRegisteredCount, 2);
  // 8101'in mock presence'ı boş olduğundan playingNow=0, uncertainCount=1 olmalı
  assert.equal(res.body.playingNow, 0);
  assert.equal(res.body.playingCount, 0);
  assert.equal(res.body.uncertainCount, 1);
  assert.equal(typeof res.body.computedAt, 'string');
  assert.ok(Array.isArray(res.body.families));
  assert.equal(res.body.families.length, 2);
  assert.equal(typeof res.body.totalMemberCount, 'number');
  assert.equal(typeof res.body.updatedAt, 'number');

  // Anonimlik kontrolü
  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes('8101'), false);
  assert.equal(raw.includes('8102'), false);
});
