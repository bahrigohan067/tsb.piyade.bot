/**
 * Google ile Site Üyeliği Bot REST API Eklemeleri Testleri
 * Kapsam:
 * 1) Aktör türleri (discord, site-guest, site-service): izinli/izinsiz uçlar, biçim doğrulama, hız sınırları
 * 2) Site sahiplenmeleri (siteRobloxClaims): çakışma (Discord & başka ownerRef), idempotent PUT,
 *    DELETE yetkisi, kimlik sızmaması, kalıcılık (yeniden başlatma / init() sonrası okuma)
 * 3) GET /api/roblox/lookup: alreadyRegistered (Discord + claims) ve site-service ignoreOwnerRef
 * 4) Discord kayıt akışları (createRegistrationApplication modal akışı & POST /api/register): claim reddi
 * 5) POST /api/roblox/avatars: yalnızca site-service, null durumları, 100 sınırı
 * 6) POST /api/directory/lookup includeGames: true: yalnızca site-service (+ eski kayıt uyumu);
 *    diğer aktörlerde ve GET /api/directory'de games alanı YOK
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-google-member-api-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-google-member-secret';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
config.API_SECRET = 'test-google-member-secret';

const database = require('../src/utils/database');
const { DatabaseManager } = require('../src/utils/database');
const robloxService = require('../src/services/roblox');
const robloxRoutes = require('../src/api/routes/roblox');
const directoryRoutes = require('../src/api/routes/directory');
const {
  createRegistrationApplication,
  clearRegistrationRateLimits,
} = require('../src/services/registrationService');
const { createApp } = require('../src/api/server');

const VALID_GUEST_A = 'g_0123456789abcdef0123456789abcdef';
const VALID_GUEST_B = 'g_fedcba9876543210fedcba9876543210';

function makeMockMember({ id, username, nickname = null, registered = true, isBot = false, isDev = false }) {
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
  if (isDev) {
    roleMap.set(config.ROLES.DEVELOPER, {
      id: config.ROLES.DEVELOPER,
      name: 'DEVELOPER',
      position: 50,
    });
  }

  return {
    id: String(id),
    displayName: nickname || username,
    joinedTimestamp: 1700000000000,
    displayAvatarURL: (opts = {}) =>
      `https://cdn.discordapp.com/avatars/${id}/av.${opts.extension || 'png'}?size=${opts.size || 128}`,
    user: {
      id: String(id),
      username,
      tag: `${username}#0001`,
      globalName: username,
      bot: isBot,
      createdTimestamp: 1600000000000,
      displayAvatarURL: (opts = {}) =>
        `https://cdn.discordapp.com/avatars/${id}/u.${opts.extension || 'png'}?size=${opts.size || 128}`,
    },
    roles: {
      cache: roleMap,
      highest: { position: isDev ? 50 : registered ? 20 : 5 },
    },
    permissions: {
      has: () => isDev,
    },
  };
}

let mockClient;
let mockGuild;
let membersMap;
let server;
let baseUrl;
let origResolveUser;
let origGetAvatarHeadshots;

let mockResolveHandler = async (q) => ({
  success: true,
  user: {
    id: 777001,
    name: String(q).replace(/^@/, '') || 'TestRblx',
    displayName: 'Test Display',
    profileUrl: 'https://www.roblox.com/users/777001/profile',
    avatarUrl: 'https://tr.rbxcdn.com/headshot-777001.png',
  },
});

let mockAvatarHandler = async (ids) => {
  const map = new Map();
  for (const id of ids) {
    map.set(String(id), `https://tr.rbxcdn.com/headshot-${id}.png`);
  }
  return map;
};

async function startFreshAppServer() {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  const app = createApp(mockClient);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function resetState() {
  database.data.registrations = [];
  database.data.activeApplications = {};
  database.data.rejectedApplications = {};
  database.data.siteRobloxClaims = {};
  database.save();
  directoryRoutes.clearDirectoryCache();
  directoryRoutes.resetDirectoryRateLimiter();
  robloxRoutes.resetRobloxRateLimiters();
  clearRegistrationRateLimits();

  membersMap.clear();
  const regModern = makeMockMember({
    id: '910000000000000001',
    username: 'modern_uye',
    nickname: 'Modern Üye',
    registered: true,
    isDev: true,
  });
  const regLegacy = makeMockMember({
    id: '910000000000000002',
    username: 'eski_uye',
    nickname: 'Eski Kayıtlı',
    registered: true,
  });
  const regNoDb = makeMockMember({
    id: '910000000000000003',
    username: 'rol_var_db_yok',
    nickname: 'Sadece Rollü',
    registered: true,
  });
  const applicant = makeMockMember({
    id: '910000000000000009',
    username: 'yeni_aday',
    nickname: 'Yeni Aday',
    registered: false,
  });
  for (const m of [regModern, regLegacy, regNoDb, applicant]) {
    membersMap.set(m.id, m);
  }

  // Modern çoklu oyun kaydı
  database.addRegistration({
    discordId: regModern.id,
    displayName: 'Modern GerçekAd',
    gender: 'male',
    games: [
      { id: 'roblox', username: 'ModernRblx', robloxId: '500001', verified: true },
      { id: 'cs2', username: 'ModernCS2', verified: false },
      { id: 'minecraft', username: 'ModernMC', verified: false },
    ],
  });

  // Eski format kayıt (ham kayıtta games alanı yok, sadece robloxUsername + robloxId)
  database.data.registrations.push({
    discordId: regLegacy.id,
    realName: 'Eski GerçekAd',
    gender: 'Erkek',
    robloxId: '500002',
    robloxUsername: 'LegacyRblx',
    registeredAt: Date.now() - 100000,
  });
  database.save();

  mockResolveHandler = async (q) => ({
    success: true,
    user: {
      id: 777001,
      name: String(q).replace(/^@/, '') || 'TestRblx',
      displayName: 'Test Display',
      profileUrl: 'https://www.roblox.com/users/777001/profile',
      avatarUrl: 'https://tr.rbxcdn.com/headshot-777001.png',
    },
  });

  mockAvatarHandler = async (ids) => {
    const map = new Map();
    for (const id of ids) {
      map.set(String(id), `https://tr.rbxcdn.com/headshot-${id}.png`);
    }
    return map;
  };
}

test.before(async () => {
  origResolveUser = robloxService.resolveUser.bind(robloxService);
  origGetAvatarHeadshots = robloxService.getAvatarHeadshots.bind(robloxService);
  robloxService.resolveUser = async (q) => mockResolveHandler(q);
  robloxService.getAvatarHeadshots = async (ids, opts) => mockAvatarHandler(ids, opts);

  membersMap = new Collection();
  const mockThread = {
    id: 'mock_reg_thread_1',
    url: 'https://discord.com/channels/1559313292651008040/mock_reg_thread_1',
    members: { add: async () => {} },
    send: async () => ({ id: 'msg1' }),
  };
  const channelMap = new Collection([
    [
      config.CHANNELS.REGISTER,
      { id: config.CHANNELS.REGISTER, threads: { create: async () => mockThread } },
    ],
    [
      config.CHANNELS.STAFF_APPROVAL,
      { id: config.CHANNELS.STAFF_APPROVAL, send: async () => ({ id: 'staff_msg_1' }) },
    ],
  ]);

  mockGuild = {
    id: config.GUILD_ID,
    ownerId: '910000000000000001',
    members: {
      cache: membersMap,
      fetch: async (arg) => {
        if (!arg || typeof arg === 'object') return membersMap;
        return membersMap.get(String(arg)) || null;
      },
    },
    channels: {
      cache: channelMap,
      fetch: async (id) => channelMap.get(String(id)) || null,
    },
    roles: {
      cache: new Collection(),
    },
  };

  mockClient = {
    isReady: () => true,
    user: { id: 'bot_1', tag: 'PiyadeBot#0001' },
    guilds: { cache: new Collection([[config.GUILD_ID, mockGuild]]) },
  };

  resetState();
  await startFreshAppServer();
});

test.after(async () => {
  robloxService.resolveUser = origResolveUser;
  robloxService.getAvatarHeadshots = origGetAvatarHeadshots;
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {}
});

async function apiReq(
  endpoint,
  { method = 'GET', secret = 'test-google-member-secret', actorType = undefined, actorId = undefined, body = null } = {}
) {
  const headers = {};
  if (secret !== null) headers.Authorization = `Bearer ${secret}`;
  if (actorType !== undefined && actorType !== null) headers['X-Actor-Type'] = String(actorType);
  if (actorId !== undefined && actorId !== null) headers['X-Actor-Id'] = String(actorId);
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body: json };
}

// ============================================================================
// 1. AKTÖR TÜRLERİ: İZİNLİ/İZİNSİZ UÇLAR, BİÇİM DOĞRULAMA VE HIZ SINIRLARI
// ============================================================================

test('1. Aktör türleri: site-guest ve site-service biçim doğrulama ve kesin beyaz liste erişimi', async () => {
  resetState();
  await startFreshAppServer();

  // Geçersiz X-Actor-Type -> 400
  const badType = await apiReq('/api/games', { actorType: 'unknown', actorId: 'site' });
  assert.equal(badType.status, 400);
  assert.equal(badType.body.code, 'INVALID_ACTOR_TYPE');

  // Bearer olmadan site-service bile reddedilir -> 401
  const noBearer = await apiReq('/api/games', { secret: null, actorType: 'site-service', actorId: 'site' });
  assert.equal(noBearer.status, 401);
  assert.equal(noBearer.body.code, 'UNAUTHORIZED');

  // --- site-guest biçim kontrolleri ---
  const guestMissingId = await apiReq('/api/games', { actorType: 'site-guest' });
  assert.equal(guestMissingId.status, 400);
  assert.equal(guestMissingId.body.code, 'MISSING_ACTOR_ID');

  for (const invalidId of ['123456', 'g_kisa', 'g_' + 'z'.repeat(32), 'm_' + 'a'.repeat(32), 'G_' + 'a'.repeat(32)]) {
    const r = await apiReq('/api/games', { actorType: 'site-guest', actorId: invalidId });
    assert.equal(r.status, 400, `Geçersiz site-guest ID reddedilmeli: ${invalidId}`);
    assert.equal(r.body.code, 'INVALID_ACTOR_ID');
  }

  // site-guest İZİNLİ uçlar: GET /api/games ve GET /api/roblox/lookup
  const gGames = await apiReq('/api/games', { actorType: 'site-guest', actorId: VALID_GUEST_A });
  assert.equal(gGames.status, 200);
  assert.ok(Array.isArray(gGames.body.games));

  const gLookup = await apiReq('/api/roblox/lookup?query=testuser', {
    actorType: 'site-guest',
    actorId: VALID_GUEST_A,
  });
  assert.equal(gLookup.status, 200);
  assert.equal(gLookup.body.status, 'FOUND');

  // site-guest İZİNSİZ uçlar -> 403 ACTOR_NOT_ALLOWED
  const guestForbiddenCalls = [
    { endpoint: '/api/directory', method: 'GET' },
    { endpoint: '/api/directory/lookup', method: 'POST', body: { ids: ['910000000000000001'] } },
    { endpoint: '/api/roblox/avatars', method: 'POST', body: { ids: ['500001'] } },
    { endpoint: '/api/roblox/site-claims/777001', method: 'PUT', body: { ownerRef: 'm_u1' } },
    { endpoint: '/api/roblox/site-claims/777001', method: 'DELETE', body: { ownerRef: 'm_u1' } },
    { endpoint: '/api/register', method: 'POST', body: { name: 'Ali', gender: 'male', games: [{ id: 'cs2', username: 'ali' }] } },
    { endpoint: '/api/member/910000000000000001/profile', method: 'GET' },
    { endpoint: '/api/admin/members', method: 'GET' },
    { endpoint: '/api/stats/summary', method: 'GET' },
    { endpoint: '/api/feedback', method: 'POST', body: { message: 'merhaba' } },
  ];
  for (const c of guestForbiddenCalls) {
    const r = await apiReq(c.endpoint, {
      method: c.method,
      actorType: 'site-guest',
      actorId: VALID_GUEST_A,
      body: c.body || null,
    });
    assert.equal(r.status, 403, `site-guest ${c.method} ${c.endpoint} için 403 almalı`);
    assert.equal(r.body.code, 'ACTOR_NOT_ALLOWED');
  }

  // --- site-service biçim kontrolleri ---
  const svcBadId = await apiReq('/api/games', { actorType: 'site-service', actorId: 'not-site' });
  assert.equal(svcBadId.status, 400);
  assert.equal(svcBadId.body.code, 'INVALID_ACTOR_ID');

  // site-service İZİNLİ uçlar
  assert.equal((await apiReq('/api/games', { actorType: 'site-service', actorId: 'site' })).status, 200);
  assert.equal(
    (await apiReq('/api/roblox/lookup?query=testuser', { actorType: 'site-service', actorId: 'site' })).status,
    200
  );
  assert.equal(
    (await apiReq('/api/roblox/avatars', { method: 'POST', actorType: 'site-service', actorId: 'site', body: { ids: ['500001'] } })).status,
    200
  );
  assert.equal(
    (await apiReq('/api/directory', { actorType: 'site-service', actorId: 'site' })).status,
    200
  );
  assert.equal(
    (await apiReq('/api/directory/lookup', { method: 'POST', actorType: 'site-service', actorId: 'site', body: { ids: ['910000000000000001'] } })).status,
    200
  );

  // site-service İZİNSİZ uçlar -> 403 ACTOR_NOT_ALLOWED
  const serviceForbiddenCalls = [
    { endpoint: '/api/register', method: 'POST', body: { name: 'Ali', gender: 'male', games: [{ id: 'cs2', username: 'ali' }] } },
    { endpoint: '/api/register/status/910000000000000001', method: 'GET' },
    { endpoint: '/api/member/910000000000000001/profile', method: 'GET' },
    { endpoint: '/api/admin/members', method: 'GET' },
    { endpoint: '/api/stats/summary', method: 'GET' },
    { endpoint: '/api/feedback', method: 'POST', body: { message: 'test' } },
  ];
  for (const c of serviceForbiddenCalls) {
    const r = await apiReq(c.endpoint, {
      method: c.method,
      actorType: 'site-service',
      actorId: 'site',
      body: c.body || null,
    });
    assert.equal(r.status, 403, `site-service ${c.method} ${c.endpoint} için 403 almalı`);
    assert.equal(r.body.code, 'ACTOR_NOT_ALLOWED');
  }

  // discord aktörü site-service özel uçlarına erişemez -> 403 ACTOR_NOT_ALLOWED
  const discordAvatars = await apiReq('/api/roblox/avatars', {
    method: 'POST',
    actorId: '910000000000000001',
    body: { ids: ['500001'] },
  });
  assert.equal(discordAvatars.status, 403);
  assert.equal(discordAvatars.body.code, 'ACTOR_NOT_ALLOWED');

  const discordClaim = await apiReq('/api/roblox/site-claims/777001', {
    method: 'PUT',
    actorId: '910000000000000001',
    body: { ownerRef: 'm_u1' },
  });
  assert.equal(discordClaim.status, 403);
  assert.equal(discordClaim.body.code, 'ACTOR_NOT_ALLOWED');
});

test('2. Hız sınırları: site-guest dakikada 10 lookup (429), site-service dakikada 120 istek (429)', async () => {
  resetState();
  await startFreshAppServer();

  // site-guest A için 10 lookup geçer, 11. 429 olur
  for (let i = 0; i < 10; i++) {
    const r = await apiReq('/api/roblox/lookup?query=oyuncu', {
      actorType: 'site-guest',
      actorId: VALID_GUEST_A,
    });
    assert.equal(r.status, 200, `Guest A ${i + 1}. lookup 200 olmalı`);
  }
  const guest11 = await apiReq('/api/roblox/lookup?query=oyuncu', {
    actorType: 'site-guest',
    actorId: VALID_GUEST_A,
  });
  assert.equal(guest11.status, 429);
  assert.equal(guest11.body.code, 'RATE_LIMITED');

  // Başka misafir (Guest B) etkilenmez -> 200
  const guestB = await apiReq('/api/roblox/lookup?query=oyuncu', {
    actorType: 'site-guest',
    actorId: VALID_GUEST_B,
  });
  assert.equal(guestB.status, 200);

  // site-service dakikada 120 istek geçer, 121. 429 olur
  for (let i = 0; i < 120; i++) {
    const r = await apiReq('/api/roblox/lookup?query=oyuncu', {
      actorType: 'site-service',
      actorId: 'site',
    });
    assert.equal(r.status, 200, `site-service ${i + 1}. istek 200 olmalı`);
  }
  const svc121 = await apiReq('/api/roblox/lookup?query=oyuncu', {
    actorType: 'site-service',
    actorId: 'site',
  });
  assert.equal(svc121.status, 429);
  assert.equal(svc121.body.code, 'RATE_LIMITED');
});

// ============================================================================
// 2. SİTE SAHİPLENMELERİ (CLAIMS): ÇAKIŞMA, IDEMPOTENT, DELETE, KALICILIK
// ============================================================================

test('3. siteRobloxClaims: Discord & başka ownerRef çakışması (409), idempotent PUT, DELETE yetkisi (403), kimlik sızmaması ve yeniden başlatma kalıcılığı', async () => {
  resetState();
  await startFreshAppServer();

  // Geçersiz robloxId veya ownerRef -> 400
  assert.equal(
    (await apiReq('/api/roblox/site-claims/notnum', {
      method: 'PUT',
      actorType: 'site-service',
      actorId: 'site',
      body: { ownerRef: 'm_alice' },
    })).body.code,
    'INVALID_ROBLOX_ID'
  );
  assert.equal(
    (await apiReq('/api/roblox/site-claims/888001', {
      method: 'PUT',
      actorType: 'site-service',
      actorId: 'site',
      body: { ownerRef: 'bad_prefix' },
    })).body.code,
    'INVALID_OWNER_REF'
  );

  // Discord kaydındaki Roblox ID (modern: 500001 ve legacy: 500002) -> 409 ROBLOX_ALREADY_REGISTERED ve Discord ID sızmaz
  for (const takenDiscordRbId of ['500001', '500002']) {
    const conflict = await apiReq(`/api/roblox/site-claims/${takenDiscordRbId}`, {
      method: 'PUT',
      actorType: 'site-service',
      actorId: 'site',
      body: { ownerRef: 'm_alice' },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'ROBLOX_ALREADY_REGISTERED');
    const raw = JSON.stringify(conflict.body);
    assert.ok(!raw.includes('910000000000000001') && !raw.includes('910000000000000002'));
  }

  // Boş Roblox ID (888001) için m_alice sahiplensin -> 200 (yeni)
  const created = await apiReq('/api/roblox/site-claims/888001', {
    method: 'PUT',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_alice' },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(created.body.idempotent, false);
  assert.equal(created.body.ownerRef, 'm_alice');

  // Aynı ownerRef ile tekrar PUT -> 200 (idempotent)
  const idem = await apiReq('/api/roblox/site-claims/888001', {
    method: 'PUT',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_alice' },
  });
  assert.equal(idem.status, 200);
  assert.equal(idem.body.idempotent, true);
  assert.equal(idem.body.at, created.body.at);

  // Başka ownerRef (m_bob) aynı robloxId'yi almaya çalışırsa -> 409 ve m_alice ASLA sızmaz
  const otherConflict = await apiReq('/api/roblox/site-claims/888001', {
    method: 'PUT',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_bob' },
  });
  assert.equal(otherConflict.status, 409);
  assert.equal(otherConflict.body.code, 'ROBLOX_ALREADY_REGISTERED');
  assert.ok(!JSON.stringify(otherConflict.body).includes('m_alice'));

  // Kalıcılık / yeniden başlatma testi: diskte kayıtlı ve yeni DatabaseManager() açılınca silinmeden okunuyor
  const rawDisk = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  assert.equal(rawDisk.siteRobloxClaims['888001'].ownerRef, 'm_alice');

  const restartedDb = new DatabaseManager();
  const reloadedClaim = restartedDb.getSiteRobloxClaim('888001');
  assert.ok(reloadedClaim, 'Yeniden başlatma sonrası siteRobloxClaims korunmalı');
  assert.equal(reloadedClaim.ownerRef, 'm_alice');
  assert.equal(reloadedClaim.at, created.body.at);

  // Başka ownerRef ile DELETE -> 403 CLAIM_OWNER_MISMATCH (sahiplenme silinmez ve m_alice sızmaz)
  const wrongDel = await apiReq('/api/roblox/site-claims/888001', {
    method: 'DELETE',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_bob' },
  });
  assert.equal(wrongDel.status, 403);
  assert.equal(wrongDel.body.code, 'CLAIM_OWNER_MISMATCH');
  assert.ok(!JSON.stringify(wrongDel.body).includes('m_alice'));
  assert.ok(database.getSiteRobloxClaim('888001'), 'Yetkisiz DELETE kaydı silmemeli');

  // Eşleşen ownerRef ile DELETE -> 200 silinir; sonrasında m_bob alabilir
  const okDel = await apiReq('/api/roblox/site-claims/888001', {
    method: 'DELETE',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_alice' },
  });
  assert.equal(okDel.status, 200);
  assert.equal(okDel.body.deleted, true);
  assert.equal(database.getSiteRobloxClaim('888001'), null);

  const bobNow = await apiReq('/api/roblox/site-claims/888001', {
    method: 'PUT',
    actorType: 'site-service',
    actorId: 'site',
    body: { ownerRef: 'm_bob' },
  });
  assert.equal(bobNow.status, 200);
  assert.equal(bobNow.body.ownerRef, 'm_bob');
});

// ============================================================================
// 3. LOOKUP alreadyRegistered (CLAIMS DAHİL) + ignoreOwnerRef + DISCORD KAYIT REDDİ
// ============================================================================

test('4. GET /api/roblox/lookup claims dahil alreadyRegistered ve yalnızca site-service için ignoreOwnerRef; Discord kayıt akışında claim reddi', async () => {
  resetState();
  await startFreshAppServer();

  // 777001'i site üyesi m_google_owner sahiplensin
  database.claimSiteRobloxId('777001', 'm_google_owner');

  // 4a) site-guest -> alreadyRegistered: true (ignoreOwnerRef gönderse bile YOKSAYILIR!)
  const guestRes = await apiReq('/api/roblox/lookup?query=TestRblx&ignoreOwnerRef=m_google_owner', {
    actorType: 'site-guest',
    actorId: VALID_GUEST_A,
  });
  assert.equal(guestRes.status, 200);
  assert.equal(guestRes.body.alreadyRegistered, true);
  assert.ok(!JSON.stringify(guestRes.body).includes('m_google_owner'));

  // 4b) discord aktörü -> alreadyRegistered: true (ignoreOwnerRef gönderse bile YOKSAYILIR!)
  const dcRes = await apiReq('/api/roblox/lookup?query=TestRblx&ignoreOwnerRef=m_google_owner', {
    actorId: '910000000000000001',
  });
  assert.equal(dcRes.status, 200);
  assert.equal(dcRes.body.alreadyRegistered, true);

  // 4c) site-service: ignoreOwnerRef yok -> true; kendi ownerRef -> false; başka ownerRef -> true
  const svcNoIgnore = await apiReq('/api/roblox/lookup?query=TestRblx', {
    actorType: 'site-service',
    actorId: 'site',
  });
  assert.equal(svcNoIgnore.body.alreadyRegistered, true);

  const svcSameOwner = await apiReq('/api/roblox/lookup?query=TestRblx&ignoreOwnerRef=m_google_owner', {
    actorType: 'site-service',
    actorId: 'site',
  });
  assert.equal(svcSameOwner.body.alreadyRegistered, false);

  const svcOtherOwner = await apiReq('/api/roblox/lookup?query=TestRblx&ignoreOwnerRef=m_baska', {
    actorType: 'site-service',
    actorId: 'site',
  });
  assert.equal(svcOtherOwner.body.alreadyRegistered, true);

  const svcBadIgnore = await apiReq('/api/roblox/lookup?query=TestRblx&ignoreOwnerRef=gecersiz', {
    actorType: 'site-service',
    actorId: 'site',
  });
  assert.equal(svcBadIgnore.status, 400);
  assert.equal(svcBadIgnore.body.code, 'INVALID_OWNER_REF');

  // 4d) Discord modal kayıt akışı (createRegistrationApplication) site claim'deki Roblox ID'yi reddeder, ownerRef sızmaz
  const applicantMember = membersMap.get('910000000000000009');
  const modalResult = await createRegistrationApplication({
    guild: mockGuild,
    member: applicantMember,
    user: applicantMember.user,
    name: 'Deneme',
    gender: 'male',
    games: [{ id: 'roblox', username: 'TestRblx' }],
    source: 'discord',
    lang: 'tr',
  });
  assert.equal(modalResult.success, false);
  assert.equal(modalResult.httpStatus, 409);
  assert.equal(modalResult.code, 'ROBLOX_ALREADY_REGISTERED');
  assert.ok(!modalResult.message.includes('m_google_owner'));

  // 4e) Web Discord kayıt ucu (POST /api/register) da aynı şekilde reddeder ve ownerRef sızmaz
  const apiRegRes = await apiReq('/api/register', {
    method: 'POST',
    actorId: applicantMember.id,
    body: {
      discordId: applicantMember.id,
      name: 'Deneme',
      gender: 'male',
      games: [{ id: 'roblox', username: 'TestRblx' }],
      lang: 'en',
    },
  });
  assert.equal(apiRegRes.status, 409);
  assert.equal(apiRegRes.body.code, 'ROBLOX_ALREADY_REGISTERED');
  assert.ok(!JSON.stringify(apiRegRes.body).includes('m_google_owner'));
});

// ============================================================================
// 4. POST /api/roblox/avatars VE POST /api/directory/lookup includeGames
// ============================================================================

test('5. POST /api/roblox/avatars yalnızca site-service içindir, null durumlarını bozmadan { [id]: url|null } döner', async () => {
  resetState();
  await startFreshAppServer();

  mockAvatarHandler = async (ids) => {
    const map = new Map();
    for (const id of ids) {
      map.set(String(id), id === '500001' ? 'https://tr.rbxcdn.com/valid-500001.png' : null);
    }
    return map;
  };

  const okRes = await apiReq('/api/roblox/avatars', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids: ['500001', '500999'] },
  });
  assert.equal(okRes.status, 200);
  assert.deepEqual(okRes.body, {
    '500001': 'https://tr.rbxcdn.com/valid-500001.png',
    '500999': null,
  });

  // Boş dizi -> 200 {}
  const emptyRes = await apiReq('/api/roblox/avatars', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids: [] },
  });
  assert.equal(emptyRes.status, 200);
  assert.deepEqual(emptyRes.body, {});

  // 101 ID -> 400 TOO_MANY_IDS
  const over100 = Array.from({ length: 101 }, (_, i) => String(10000 + i));
  const tooMany = await apiReq('/api/roblox/avatars', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids: over100 },
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.code, 'TOO_MANY_IDS');

  // Geçersiz ID -> 400 INVALID_ID_FORMAT
  const badId = await apiReq('/api/roblox/avatars', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids: ['abc'] },
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.code, 'INVALID_ID_FORMAT');
});

test('6. POST /api/directory/lookup includeGames: true yalnızca site-service aktöründe games: [{id, username}] döner (eski kayıt dönüşümü dahil)', async () => {
  resetState();
  await startFreshAppServer();

  const ids = ['910000000000000001', '910000000000000002', '910000000000000003'];

  // 6a) site-service + includeGames: true -> games alanı eklenir (yalnızca id ve username)
  const svcWithGames = await apiReq('/api/directory/lookup', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids, includeGames: true },
  });
  assert.equal(svcWithGames.status, 200);
  assert.equal(svcWithGames.body.items.length, 3);

  const [modernItem, legacyItem, noDbItem] = svcWithGames.body.items;
  assert.deepEqual(modernItem.games, [
    { id: 'roblox', username: 'ModernRblx' },
    { id: 'cs2', username: 'ModernCS2' },
    { id: 'minecraft', username: 'ModernMC' },
  ]);
  // Eski kayıtta games yoktu -> okuma sırasında robloxUsername'den dönüştürülmeli
  assert.deepEqual(legacyItem.games, [{ id: 'roblox', username: 'LegacyRblx' }]);
  // DB kaydı olmayan rollü üye -> boş dizi
  assert.deepEqual(noDbItem.games, []);

  // 6b) site-service + includeGames yok -> games alanı OLMAMALI
  const svcNoGames = await apiReq('/api/directory/lookup', {
    method: 'POST',
    actorType: 'site-service',
    actorId: 'site',
    body: { ids },
  });
  assert.equal(svcNoGames.status, 200);
  for (const item of svcNoGames.body.items) {
    assert.equal('games' in item, false, 'includeGames kapalıyken games alanı dönmemeli');
  }

  // 6c) discord aktörü includeGames: true gönderse bile games alanı ASLA eklenmez
  const dcWithGames = await apiReq('/api/directory/lookup', {
    method: 'POST',
    actorId: '910000000000000001',
    body: { ids, includeGames: true },
  });
  assert.equal(dcWithGames.status, 200);
  for (const item of dcWithGames.body.items) {
    assert.equal('games' in item, false, 'Discord aktörü includeGames ile oyun adlarını çekememeli');
  }

  // 6d) GET /api/directory her iki aktörde de yalnız 7 alan döner (games ASLA yok)
  const svcList = await apiReq('/api/directory', { actorType: 'site-service', actorId: 'site' });
  assert.equal(svcList.status, 200);
  for (const item of svcList.body.items) {
    assert.equal(Object.keys(item).length, 7);
    assert.equal('games' in item, false);
  }
});
