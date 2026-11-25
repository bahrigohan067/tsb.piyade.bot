/**
 * Kayıtlı Üye Rehberi (Directory) API ve Toplu Roblox Avatar Headshot Testleri
 * Kapsam:
 * - Yalnızca kayıtlı, sunucuda bulunan, bot olmayan üyeler (kayıtsız/bot/ayrılan hariç)
 * - Kesin 7 alan kısıtı (cinsiyet, gerçek ad, oyun listesi vb. fazladan veri sızmaz)
 * - Türkçe/İngilizce harf farkına duyarsız arama + <= 40 karakter sınırı
 * - Alfabetik sıralama, varsayılan 30 / en çok 50 limit, excludeSelf=1, kararlı cursor sayfalama
 * - Soğuk önbellek cooldown'lu fetch + 30 sn bellek önbelleği + guildMemberRemove temizliği
 * - POST /api/directory/lookup: istek sırası, 100 sınırı, geçersiz girişlerde 400
 * - Roblox getAvatarHeadshots: 100'lü batch, 6 saat cache, rbxcdn.com doğrulama, max 2 eşzamanlı,
 *   5 sn timeout, 429 geri çekilme, hata/null toleransı
 * - Bearer + X-Actor-Id doğrulaması, aktör başına 60/dk hız sınırı (429), konsola kullanıcı verisi yazmama
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-directory-api-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-directory-api-secret';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
config.API_SECRET = 'test-directory-api-secret';

const database = require('../src/utils/database');
const robloxService = require('../src/services/roblox');
const { RobloxService, isValidRbxCdnUrl, AVATAR_CACHE_TTL_MS } = require('../src/services/roblox');
const directoryRoutes = require('../src/api/routes/directory');
const guildMemberRemoveEvent = require('../src/events/guildMemberRemove');
const { createApp } = require('../src/api/server');

const ALLOWED_ITEM_KEYS = [
  'discordAvatarUrl',
  'displayName',
  'hasRoblox',
  'id',
  'robloxAvatarUrl',
  'robloxId',
  'robloxUsername',
];

function makeMockMember({
  id,
  username,
  globalName = null,
  nickname = null,
  registered = true,
  isBot = false,
}) {
  const roleMap = new Collection();
  roleMap.set(config.GUILD_ID, { id: config.GUILD_ID, name: '@everyone', position: 0 });
  if (registered) {
    roleMap.set(config.ROLES.REGISTERED_CHECK, {
      id: config.ROLES.REGISTERED_CHECK,
      name: 'Cengaver',
      position: 20,
    });
  } else {
    roleMap.set(config.ROLES.UNREGISTERED, {
      id: config.ROLES.UNREGISTERED,
      name: 'Kayıtsız',
      position: 5,
    });
  }

  const displayName = nickname || globalName || username;
  return {
    id: String(id),
    displayName,
    displayAvatarURL: (opts = {}) => {
      const ext = opts.extension || 'png';
      const size = opts.size || 128;
      return `https://cdn.discordapp.com/avatars/${id}/avatar_hash.${ext}?size=${size}`;
    },
    user: {
      id: String(id),
      username,
      globalName: globalName || username,
      bot: isBot,
      displayAvatarURL: (opts = {}) => {
        const ext = opts.extension || 'png';
        const size = opts.size || 128;
        return `https://cdn.discordapp.com/avatars/${id}/user_hash.${ext}?size=${size}`;
      },
    },
    roles: {
      cache: roleMap,
      highest: { position: registered ? 20 : 5 },
    },
  };
}

let server;
let baseUrl;
let membersMap;
let mockGuild;
let bulkFetchCount = 0;
let singleFetchCalls = [];
let origGetAvatarHeadshots;
let mockAvatarHandler = async (ids) => {
  const map = new Map();
  for (const id of ids) {
    map.set(String(id), `https://tr.rbxcdn.com/30DAY-AvatarHeadshot-${id}/150/150/AvatarHeadshot/Png/noFilter`);
  }
  return map;
};

function resetEnvState() {
  membersMap.clear();
  mockGuild.memberCount = undefined;
  bulkFetchCount = 0;
  singleFetchCalls = [];
  database.data.registrations = [];
  database.save();
  directoryRoutes.clearDirectoryCache();
  directoryRoutes.resetDirectoryRateLimiter();
  robloxService.clearAvatarHeadshotCache();
  mockAvatarHandler = async (ids) => {
    const map = new Map();
    for (const id of ids) {
      map.set(String(id), `https://tr.rbxcdn.com/30DAY-AvatarHeadshot-${id}/150/150/AvatarHeadshot/Png/noFilter`);
    }
    return map;
  };
}

test.before(async () => {
  origGetAvatarHeadshots = robloxService.getAvatarHeadshots.bind(robloxService);
  robloxService.getAvatarHeadshots = async (ids, opts) => mockAvatarHandler(ids, opts);

  membersMap = new Collection();
  mockGuild = {
    id: config.GUILD_ID,
    ownerId: '900000000000000001',
    memberCount: undefined,
    members: {
      cache: membersMap,
      fetch: async (arg) => {
        if (!arg || typeof arg === 'object') {
          bulkFetchCount += 1;
          return membersMap;
        }
        const uid = String(arg);
        singleFetchCalls.push(uid);
        return membersMap.get(uid) || null;
      },
    },
  };

  const guildsCache = new Collection();
  guildsCache.set(config.GUILD_ID, mockGuild);

  const mockClient = {
    isReady: () => true,
    user: { id: 'bot_test_id', tag: 'PiyadeBot#0001' },
    guilds: { cache: guildsCache },
  };

  const app = createApp(mockClient);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  robloxService.getAvatarHeadshots = origGetAvatarHeadshots;
  directoryRoutes.clearDirectoryCache();
  robloxService.clearAvatarHeadshotCache();
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {}
});

async function apiRequest(endpoint, { method = 'GET', secret = 'test-directory-api-secret', actorId = '100000000000000001', body = null } = {}) {
  const headers = {};
  if (secret !== null) headers.Authorization = `Bearer ${secret}`;
  if (actorId !== null) headers['X-Actor-Id'] = String(actorId);
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body: json };
}

function seedBasicMembers() {
  const actor = makeMockMember({
    id: '100000000000000001',
    username: 'actor_user',
    nickname: 'Zeynep | Aktör',
    registered: true,
  });
  const sule = makeMockMember({
    id: '100000000000000002',
    username: 'sule_dc',
    nickname: 'Şule Yıldız',
    registered: true,
  });
  const isik = makeMockMember({
    id: '100000000000000003',
    username: 'isik_dc',
    globalName: 'IŞIK Özgür',
    registered: true,
  });
  const cagri = makeMockMember({
    id: '100000000000000004',
    username: 'cagri_dc',
    nickname: 'Çağrı Gökhan',
    registered: true,
  });
  const unregistered = makeMockMember({
    id: '100000000000000005',
    username: 'kayitsiz_kisi',
    nickname: 'Kayıtsız Aday',
    registered: false,
  });
  const botWithRole = makeMockMember({
    id: '100000000000000006',
    username: 'piyade_bot',
    nickname: 'Bot Hesap',
    registered: true,
    isBot: true,
  });

  for (const m of [actor, sule, isik, cagri, unregistered, botWithRole]) {
    membersMap.set(m.id, m);
  }

  // Kayıt kayıtları (cinsiyet, gerçek ad, oyun listesi gibi hassas alanlar içeriyor — ASLA sızmamalı)
  database.addRegistration({
    discordId: sule.id,
    displayName: 'Şule GerçekAd',
    realName: 'Şule GerçekAd',
    gender: 'female',
    games: [
      { id: 'roblox', username: 'Sule_RBLX', robloxId: '55001', verified: true },
      { id: 'minecraft', username: 'SuleMC' },
    ],
  });
  database.addRegistration({
    discordId: isik.id,
    displayName: 'Işık GerçekAd',
    realName: 'Işık GerçekAd',
    gender: 'male',
    robloxId: '55002',
    robloxUsername: 'Kral_Isik',
  });
  database.addRegistration({
    discordId: cagri.id,
    displayName: 'Çağrı GerçekAd',
    realName: 'Çağrı GerçekAd',
    gender: 'male',
    games: [{ id: 'cs2', username: 'CagriCS2' }], // Roblox hesabı yok
  });
  // Sunucudan ayrılmış kayıtlı üye (DB'de var ama guild.members.cache'te yok)
  database.addRegistration({
    discordId: '100000000000000099',
    displayName: 'Ayrılan Üye',
    realName: 'Ayrılan Üye',
    gender: 'male',
    robloxId: '55099',
    robloxUsername: 'EskiOyuncu',
  });
}

// ============================================================================
// 1. TEMEL FİLTRELEME VE GİZLİLİK (SADECE KAYITLI + 7 ALAN KISITI)
// ============================================================================

test('1. GET /api/directory yalnızca kayıtlı, sunucuda bulunan ve bot olmayan üyeleri tam 7 alanla döner', async () => {
  resetEnvState();
  seedBasicMembers();

  const res = await apiRequest('/api/directory');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 4);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.nextCursor, null);

  const returnedIds = res.body.items.map((x) => x.id);
  // Kayıtsız (005), bot (006) ve ayrılan üye (099) kesinlikle listede olmamalı
  assert.ok(!returnedIds.includes('100000000000000005'), 'Kayıtsız üye dönmemeli');
  assert.ok(!returnedIds.includes('100000000000000006'), 'Bot dönmemeli');
  assert.ok(!returnedIds.includes('100000000000000099'), 'Sunucudan ayrılan üye dönmemeli');

  // Alfabetik sıra: Çağrı Gökhan (cagri) < IŞIK Özgür (isik) < Şule Yıldız (sule) < Zeynep | Aktör (zeynep)
  assert.deepEqual(returnedIds, [
    '100000000000000004',
    '100000000000000003',
    '100000000000000002',
    '100000000000000001',
  ]);

  // Her öğede KESİNLİKLE yalnızca izin verilen 7 alan olmalı; hassas alan sızmamalı
  for (const item of res.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ALLOWED_ITEM_KEYS);
    assert.ok(item.discordAvatarUrl.includes('.png') && item.discordAvatarUrl.includes('size=128'));
    assert.equal(item.gender, undefined);
    assert.equal(item.realName, undefined);
    assert.equal(item.games, undefined);
    assert.equal(item.roles, undefined);
    assert.equal(item.username, undefined);
  }

  const suleItem = res.body.items.find((x) => x.id === '100000000000000002');
  assert.equal(suleItem.displayName, 'Şule Yıldız');
  assert.equal(suleItem.robloxId, '55001');
  assert.equal(suleItem.robloxUsername, 'Sule_RBLX');
  assert.equal(suleItem.hasRoblox, true);
  assert.ok(suleItem.robloxAvatarUrl.startsWith('https://tr.rbxcdn.com/'));

  const cagriItem = res.body.items.find((x) => x.id === '100000000000000004');
  assert.equal(cagriItem.robloxId, null);
  assert.equal(cagriItem.robloxUsername, null);
  assert.equal(cagriItem.robloxAvatarUrl, null);
  assert.equal(cagriItem.hasRoblox, false);

  // Raw JSON içinde gerçek ad / cinsiyet / diğer oyun adı sızmadığını da doğrula
  const rawJson = JSON.stringify(res.body);
  assert.ok(!rawJson.includes('GerçekAd'));
  assert.ok(!rawJson.includes('female'));
  assert.ok(!rawJson.includes('SuleMC'));
  assert.ok(!rawJson.includes('CagriCS2'));
});

// ============================================================================
// 2. TÜRKÇE HARF TOLERANSLI ARAMA, EXCLUDESELF VE GİRDİ DOĞRULAMA
// ============================================================================

test('2. GET /api/directory Türkçe/İngilizce harf duyarsız arama (displayName + robloxUsername), excludeSelf=1 ve 40 karakter sınırı', async () => {
  resetEnvState();
  seedBasicMembers();

  // ş->s
  const r1 = await apiRequest('/api/directory?query=sule');
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.items.map((x) => x.id), ['100000000000000002']);

  // I/ı/İ/i + ö/ü
  const r2 = await apiRequest('/api/directory?query=isik');
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body.items.map((x) => x.id), ['100000000000000003']);

  const r3 = await apiRequest('/api/directory?query=ozgur');
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.body.items.map((x) => x.id), ['100000000000000003']);

  // ç->c, ğ->g
  const r4 = await apiRequest('/api/directory?query=cagri');
  assert.equal(r4.status, 200);
  assert.deepEqual(r4.body.items.map((x) => x.id), ['100000000000000004']);

  // robloxUsername üzerinde arama
  const r5 = await apiRequest('/api/directory?query=KRAL_ISIK');
  assert.equal(r5.status, 200);
  assert.deepEqual(r5.body.items.map((x) => x.id), ['100000000000000003']);

  // excludeSelf=1 aktörün kendisini çıkarır
  const rEx = await apiRequest('/api/directory?excludeSelf=1', { actorId: '100000000000000001' });
  assert.equal(rEx.status, 200);
  assert.equal(rEx.body.total, 3);
  assert.ok(!rEx.body.items.some((x) => x.id === '100000000000000001'));

  // 40 karakterden uzun sorgu -> 400 QUERY_TOO_LONG
  const tooLong = await apiRequest(`/api/directory?query=${'a'.repeat(41)}`);
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.code, 'QUERY_TOO_LONG');
  assert.ok(typeof tooLong.body.error === 'string');

  // Geçersiz limit -> 400 INVALID_LIMIT
  const badLimit = await apiRequest('/api/directory?limit=0');
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.body.code, 'INVALID_LIMIT');

  const nanLimit = await apiRequest('/api/directory?limit=abc');
  assert.equal(nanLimit.status, 400);
  assert.equal(nanLimit.body.code, 'INVALID_LIMIT');

  // Geçersiz cursor -> 400 INVALID_CURSOR
  const badCursor = await apiRequest('/api/directory?cursor=!!!bozuk!!!');
  assert.equal(badCursor.status, 400);
  assert.equal(badCursor.body.code, 'INVALID_CURSOR');
});

// ============================================================================
// 3. KARARLI CURSOR SAYFALAMA VE LİMİT SINIRLARI (VARSAYILAN 30, EN ÇOK 50)
// ============================================================================

test('3. GET /api/directory varsayılan 30 / en çok 50 limit ve araya üye girse bile kararlı cursor sayfalama', async () => {
  resetEnvState();

  // 65 kayıtlı üye ekle
  for (let i = 1; i <= 65; i++) {
    const id = `200000000000000${String(i).padStart(3, '0')}`;
    const num = String(i).padStart(2, '0');
    membersMap.set(
      id,
      makeMockMember({ id, username: `member_${num}`, nickname: `Oyuncu ${num}`, registered: true })
    );
  }
  const actorId = '200000000000000001';

  // Varsayılan limit = 30
  const defPage = await apiRequest('/api/directory', { actorId });
  assert.equal(defPage.status, 200);
  assert.equal(defPage.body.items.length, 30);
  assert.equal(defPage.body.hasMore, true);
  assert.ok(defPage.body.nextCursor);

  // Limit > 50 -> 50'ye kırpılır
  const maxPage = await apiRequest('/api/directory?limit=99', { actorId });
  assert.equal(maxPage.status, 200);
  assert.equal(maxPage.body.items.length, 50);
  assert.equal(maxPage.body.hasMore, true);

  // Tüm sayfaları cursor ile dolaş (limit=20 -> 20 + 20 + 20 + 5 = 65)
  const collected = [];
  let cursor = null;
  let pages = 0;
  do {
    const qs = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
    const p = await apiRequest(`/api/directory${qs}`, { actorId });
    assert.equal(p.status, 200);
    collected.push(...p.body.items.map((x) => x.id));
    cursor = p.body.nextCursor;
    pages += 1;

    // 1. sayfa sonrası listenin başına ("AAA Yeni") yeni bir üye eklensin ve önbellek temizlensin ->
    // cursor keyset olduğu için 2. sayfa tekrar veya atlama yapmadan kaldığı yerden devam etmeli!
    if (pages === 1) {
      membersMap.set(
        '200000000000000999',
        makeMockMember({ id: '200000000000000999', username: 'aaa_new', nickname: 'AAA Yeni', registered: true })
      );
      directoryRoutes.clearDirectoryCache();
    }
  } while (cursor);

  assert.equal(pages, 4);
  assert.equal(collected.length, 65);
  assert.equal(new Set(collected).size, 65, 'Cursor sayfalamada hiçbir üye çift gelmemeli veya atlanmamalı');
});

// ============================================================================
// 4. SOĞUK ÖNBELLEK COOLDOWN FETCH VE GUILDMEMBERREMOVE TEMİZLİĞİ
// ============================================================================

test('4. Önbellek sıcakken toplu fetch atılmaz; soğukken cooldown içinde yalnız 1 kez atılır; ayrılan üye hemen temizlenir', async () => {
  resetEnvState();
  seedBasicMembers();

  // Sıcak önbellek (memberCount tanımsız veya cache dolu): 0 toplu fetch
  await apiRequest('/api/directory');
  assert.equal(bulkFetchCount, 0);

  // Soğuk önbellek simülasyonu: sunucuda 50 üye var ama cache'te sadece 4 kişi var
  directoryRoutes.clearDirectoryCache();
  mockGuild.memberCount = 50;
  await apiRequest('/api/directory');
  assert.equal(bulkFetchCount, 1, 'Soğuk önbellekte 1 kez toplu fetch atılmalı');

  // Aynı 30 sn içinde ikinci istek -> bellek önbelleğinden, 0 ek fetch
  await apiRequest('/api/directory');
  assert.equal(bulkFetchCount, 1);

  // Üye ayrılınca guildMemberRemove 30 sn önbelleği temizler, ayrılan üye hemen kaybolur
  membersMap.delete('100000000000000002');
  guildMemberRemoveEvent.execute({ id: '100000000000000002', user: { id: '100000000000000002' } });
  const afterLeave = await apiRequest('/api/directory');
  assert.equal(afterLeave.status, 200);
  assert.ok(!afterLeave.body.items.some((x) => x.id === '100000000000000002'));
  assert.equal(bulkFetchCount, 1, '5 dk cooldown sürdüğü için yeniden toplu fetch atılmamalı');
});

// ============================================================================
// 5. POST /api/directory/lookup (İSTEK SIRASI, 100 SINIRI, 400 HATALARI)
// ============================================================================

test('5. POST /api/directory/lookup yalnızca kayıtlı/mevcut üyeleri İSTEK SIRASIYLA döner ve geçersiz/uzun girdide 400 verir', async () => {
  resetEnvState();
  seedBasicMembers();

  // İstek sırası: actor (001), kayıtsız (005), çağrı (004), ayrılan (099), bot (006), şule (002), tekrar çağrı (004)
  const lookupRes = await apiRequest('/api/directory/lookup', {
    method: 'POST',
    body: {
      ids: [
        '100000000000000001',
        '100000000000000005',
        '100000000000000004',
        '100000000000000099',
        '100000000000000006',
        '100000000000000002',
        '100000000000000004',
      ],
    },
  });

  assert.equal(lookupRes.status, 200);
  // Alfabetik DEĞİL, tam istek sırasıyla (001 -> 004 -> 002); kayıtsız/ayrılan/bot/tekrar elenmiş olmalı
  assert.deepEqual(lookupRes.body.items.map((x) => x.id), [
    '100000000000000001',
    '100000000000000004',
    '100000000000000002',
  ]);
  for (const item of lookupRes.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ALLOWED_ITEM_KEYS);
  }

  // Boş dizi -> 200 { items: [] }
  const emptyRes = await apiRequest('/api/directory/lookup', {
    method: 'POST',
    body: { ids: [] },
  });
  assert.equal(emptyRes.status, 200);
  assert.deepEqual(emptyRes.body.items, []);

  // 101 ID -> 400 TOO_MANY_IDS
  const over100 = Array.from({ length: 101 }, (_, i) => `300000000000000${String(i).padStart(3, '0')}`);
  const tooMany = await apiRequest('/api/directory/lookup', {
    method: 'POST',
    body: { ids: over100 },
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.code, 'TOO_MANY_IDS');

  // Dizi değil -> 400 INVALID_IDS
  const notArray = await apiRequest('/api/directory/lookup', {
    method: 'POST',
    body: { ids: '100000000000000001' },
  });
  assert.equal(notArray.status, 400);
  assert.equal(notArray.body.code, 'INVALID_IDS');

  // Geçersiz ID formatı -> 400 INVALID_ID_FORMAT
  const badId = await apiRequest('/api/directory/lookup', {
    method: 'POST',
    body: { ids: ['100000000000000001', 'not-a-snowflake'] },
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.code, 'INVALID_ID_FORMAT');
});

// ============================================================================
// 6. ROBLOX AVATAR HEADSHOT SERVİSİ (BATCH 100, 6 SA CACHE, RBXCDN, MAX 2, 429, NULL TOLERANSI)
// ============================================================================

test('6. Roblox getAvatarHeadshots: 100 batch, 6 saat cache, rbxcdn.com doğrulama, max 2 eşzamanlı, 429 geri çekilme ve hata/null güvenliği', async () => {
  // 6a) rbxcdn.com alan adı doğrulaması
  assert.equal(isValidRbxCdnUrl('https://tr.rbxcdn.com/abc/150/150/AvatarHeadshot/Png'), true);
  assert.equal(isValidRbxCdnUrl('https://t0.rbxcdn.com/xyz.png'), true);
  assert.equal(isValidRbxCdnUrl('https://rbxcdn.com/img.png'), true);
  assert.equal(isValidRbxCdnUrl('http://tr.rbxcdn.com/insecure.png'), false);
  assert.equal(isValidRbxCdnUrl('https://evilrbxcdn.com/x.png'), false);
  assert.equal(isValidRbxCdnUrl('https://rbxcdn.com.evil.com/x.png'), false);
  assert.equal(isValidRbxCdnUrl('https://attacker.example/avatar.png'), false);
  assert.equal(isValidRbxCdnUrl('javascript:alert(1)'), false);

  // 6b) 150 ID -> 100 + 50 iki istek; max 2 eşzamanlı; rbxcdn dışı URL reddedilip null döner; 6 saat cache çalışır
  let fakeNow = 1_800_000_000_000;
  let activeRequests = 0;
  let maxActiveSeen = 0;
  const requestedBatches = [];

  const svc = new RobloxService({
    nowFn: () => fakeNow,
    fetchFn: async (url, opts) => {
      // Herkese açık küçük resim ucu, çerez/Authorization YOK
      assert.ok(url.startsWith('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds='));
      assert.ok(url.includes('&size=150x150&format=Png&isCircular=false'));
      assert.equal(opts?.headers?.Cookie, undefined);
      assert.equal(opts?.headers?.Authorization, undefined);

      activeRequests += 1;
      maxActiveSeen = Math.max(maxActiveSeen, activeRequests);
      await new Promise((r) => setTimeout(r, 15));
      activeRequests -= 1;

      const parsedUrl = new URL(url);
      const batchIds = parsedUrl.searchParams.get('userIds').split(',');
      requestedBatches.push(batchIds);

      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: batchIds.map((id) => {
            if (id === '1002') {
              // Geçersiz alan adı -> null dönmeli
              return { targetId: Number(id), state: 'Completed', imageUrl: 'https://evil.example/fake.png' };
            }
            if (id === '1003') {
              // Blocked -> null dönmeli
              return { targetId: Number(id), state: 'Blocked', imageUrl: '' };
            }
            return {
              targetId: Number(id),
              state: 'Completed',
              imageUrl: `https://tr.rbxcdn.com/headshot-${id}.png`,
            };
          }),
        }),
      };
    },
  });

  // 350 ID -> 4 parça (100 + 100 + 100 + 50), eşzamanlı en çok 2 çalışmalı
  const ids350 = Array.from({ length: 350 }, (_, i) => String(1000 + i));
  const resMap = await svc.getAvatarHeadshots(ids350);

  assert.deepEqual(
    requestedBatches.map((b) => b.length).sort((a, b) => b - a),
    [100, 100, 100, 50]
  );
  assert.ok(maxActiveSeen <= 2, `Eşzamanlı istek 2'yi aşmamalı (görülen: ${maxActiveSeen})`);
  assert.equal(resMap.get('1000'), 'https://tr.rbxcdn.com/headshot-1000.png');
  assert.equal(resMap.get('1002'), null, 'rbxcdn.com dışındaki URL null dönmeli');
  assert.equal(resMap.get('1003'), null, 'Blocked durum null dönmeli');

  // 6 saat içinde aynı geçerli ID tekrar istenince 0 ağ isteği (önbellekten gelir)
  requestedBatches.length = 0;
  fakeNow += AVATAR_CACHE_TTL_MS - 10_000;
  const cachedRes = await svc.getAvatarHeadshots(['1000', '1001']);
  assert.equal(requestedBatches.length, 0);
  assert.equal(cachedRes.get('1000'), 'https://tr.rbxcdn.com/headshot-1000.png');

  // 6 saat dolunca yeniden çekilir
  fakeNow += 20_000;
  await svc.getAvatarHeadshots(['1000']);
  assert.equal(requestedBatches.length, 1);

  // 6c) 429 hız sınırında geri çekilme (hata fırlatmaz, null döner, bekleme süresince ağa çıkmaz)
  let calls429 = 0;
  const svc429 = new RobloxService({
    nowFn: () => fakeNow,
    fetchFn: async () => {
      calls429 += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '5' : null) },
      };
    },
  });
  const first429 = await svc429.getAvatarHeadshots(['7001']);
  assert.equal(first429.get('7001'), null);
  assert.equal(calls429, 1);

  // 2 sn sonra hâlâ 5 sn geri çekilme penceresinde -> ağa gitmemeli
  fakeNow += 2000;
  const duringBackoff = await svc429.getAvatarHeadshots(['7002']);
  assert.equal(duringBackoff.get('7002'), null);
  assert.equal(calls429, 1);

  // 6d) Ağ hatasında da asla hata fırlatmaz ve /api/directory sorunsuz 200 + robloxAvatarUrl: null döner
  resetEnvState();
  seedBasicMembers();
  mockAvatarHandler = async (ids) => new Map(ids.map((id) => [String(id), null]));
  const dirNullAvatar = await apiRequest('/api/directory');
  assert.equal(dirNullAvatar.status, 200);
  const suleNull = dirNullAvatar.body.items.find((x) => x.id === '100000000000000002');
  assert.equal(suleNull.hasRoblox, true);
  assert.equal(suleNull.robloxAvatarUrl, null);
});

// ============================================================================
// 7. YETKİ, AKTÖR BAŞINA 60/DK HIZ SINIRI VE KONSOL GİZLİLİĞİ
// ============================================================================

test('7. Bearer + X-Actor-Id doğrulaması, aktör başına 60/dk rate limit (429) ve konsola kullanıcı verisi yazmama', async () => {
  resetEnvState();
  seedBasicMembers();

  const capturedLogs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => capturedLogs.push(args.join(' '));
  console.warn = (...args) => capturedLogs.push(args.join(' '));
  console.error = (...args) => capturedLogs.push(args.join(' '));

  try {
    // Eksik / yanlış Bearer -> 401 UNAUTHORIZED
    const noAuth = await apiRequest('/api/directory', { secret: null });
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.body.code, 'UNAUTHORIZED');

    const badAuth = await apiRequest('/api/directory', { secret: 'yanlis-sifre' });
    assert.equal(badAuth.status, 401);
    assert.equal(badAuth.body.code, 'UNAUTHORIZED');

    // Eksik X-Actor-Id -> 400 MISSING_ACTOR_ID
    const noActor = await apiRequest('/api/directory', { actorId: null });
    assert.equal(noActor.status, 400);
    assert.equal(noActor.body.code, 'MISSING_ACTOR_ID');

    // Geçersiz X-Actor-Id -> 400 INVALID_ACTOR_ID
    const badActor = await apiRequest('/api/directory', { actorId: 'gecersiz_id' });
    assert.equal(badActor.status, 400);
    assert.equal(badActor.body.code, 'INVALID_ACTOR_ID');

    // Sunucuda olmayan X-Actor-Id -> 404 ACTOR_NOT_FOUND
    const unknownActor = await apiRequest('/api/directory', { actorId: '999999999999999999' });
    assert.equal(unknownActor.status, 404);
    assert.equal(unknownActor.body.code, 'ACTOR_NOT_FOUND');

    // Aktör A için 60 istek geçer, 61. istek 429 RATE_LIMITED döner
    for (let i = 0; i < 60; i++) {
      const okRes = await apiRequest('/api/directory?query=sule', { actorId: '100000000000000001' });
      assert.equal(okRes.status, 200, `${i + 1}. istek 200 dönmeli`);
    }

    const limitedRes = await apiRequest('/api/directory?query=sule', { actorId: '100000000000000001' });
    assert.equal(limitedRes.status, 429);
    assert.equal(limitedRes.body.code, 'RATE_LIMITED');
    assert.ok(limitedRes.body.retryAfter >= 1);

    // Başka bir aktör (Aktör B) hâlâ 200 alabilmeli (aktör bazlı izole limit)
    const actorBRes = await apiRequest('/api/directory', { actorId: '100000000000000002' });
    assert.equal(actorBRes.status, 200);

    // Konsola hiçbir kullanıcı kimliği, kullanıcı adı veya arama sorgusu yazılmamış olmalı
    const allLogText = capturedLogs.join('\n');
    for (const sensitive of ['100000000000000001', '100000000000000002', 'Şule', 'Sule_RBLX', 'Kral_Isik']) {
      assert.ok(!allLogText.includes(sensitive), `Konsola kullanıcı verisi yazılmamalı: ${sensitive}`);
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
});
