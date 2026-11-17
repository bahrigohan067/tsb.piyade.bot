const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');

// Testler için izole geçici veri klasörü ve gizli anahtar
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-api-smoke-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-smoke-secret-xyz';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
config.API_SECRET = 'test-smoke-secret-xyz';

const database = require('../src/utils/database');
const robloxService = require('../src/services/roblox');
const { createApp } = require('../src/api/server');

let origResolveUser;

/**
 * Sahte Discord Client ve Guild yapısı
 */
function createMockDiscordEnvironment() {
  const membersMap = new Collection();
  const guildRolesMap = new Collection();

  function createRole(id, name, position = 10, hexColor = '#000000', hoist = false) {
    const role = {
      id,
      name,
      position,
      hexColor,
      hoist,
      managed: false,
      permissions: {
        has: () => false,
      },
    };
    guildRolesMap.set(id, role);
    return role;
  }

  const devRole = createRole(config.ROLES.DEVELOPER, 'Developer', 50);
  const staffRole = createRole(config.ROLES.TRYOUT_STAFF, 'Yönetmenlik', 40);
  const regRole = createRole(config.ROLES.REGISTERED_CHECK, 'Kayıtlı Üye', 20);
  const unregisteredRole = createRole(config.ROLES.UNREGISTERED, 'Kayıtsız', 5);

  function makeMember({ id, username, displayName, roles = [], joinedTimestamp = 1600000000000 }) {
    const roleMap = new Collection(roles.map((r) => [r.id, r]));
    const member = {
      id,
      displayName: displayName || username,
      user: {
        id,
        username,
        tag: `${username}#0001`,
        createdTimestamp: 1500000000000,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/abc.png`,
        send: async () => ({ id: `dm_${id}` }),
      },
      joinedTimestamp,
      roles: {
        cache: roleMap,
        highest: { position: Math.max(...roles.map((r) => r.position), 0) },
        add: async (roleId) => {
          const roleObj = guildRolesMap.get(roleId) || { id: roleId, name: 'Added Role', position: 10, hexColor: '#000000', hoist: false };
          roleMap.set(roleId, roleObj);
        },
        remove: async (roleId) => {
          roleMap.delete(roleId);
        },
      },
      permissions: {
        has: () => false,
      },
      setNickname: async (newNick) => {
        member.displayName = newNick;
        return member;
      },
    };
    membersMap.set(id, member);
    return member;
  }

  // 1. Yönetici Aktörler
  makeMember({
    id: '9001',
    username: 'dev_actor',
    displayName: 'Developer Aktör',
    roles: [devRole],
  });

  makeMember({
    id: '9002',
    username: 'yonetmen_actor',
    displayName: 'Yönetmenlik Aktör',
    roles: [staffRole],
  });

  // 2. Üyeler
  makeMember({
    id: '9101',
    username: 'ahmet_uye',
    displayName: 'Ahmet | ahmet_roblox',
    roles: [regRole],
  });

  makeMember({
    id: '9103',
    username: 'kayitsiz_uye',
    displayName: 'Kayıtsız Üye',
    roles: [unregisteredRole],
  });

  makeMember({
    id: '9104',
    username: 'bekleyen_uye',
    displayName: 'Bekleyen Üye',
    roles: [unregisteredRole],
  });

  makeMember({
    id: '9105',
    username: 'reddedilen_uye',
    displayName: 'Reddedilen Üye',
    roles: [unregisteredRole],
  });

  makeMember({
    id: '9106',
    username: 'yeni_kayit_user',
    displayName: 'Yeni Aday',
    roles: [unregisteredRole],
  });

  // Mock Kanallar
  const mockThread = {
    id: 'mock_smoke_thread_123',
    url: 'https://discord.com/channels/1559313292651008040/mock_smoke_thread_123',
    members: { add: async () => {} },
    send: async () => ({ id: 'thread_msg_smoke' }),
  };

  const mockRegisterChannel = {
    id: config.CHANNELS.REGISTER,
    threads: {
      create: async () => mockThread,
    },
  };

  const mockStaffApprovalChannel = {
    id: config.CHANNELS.STAFF_APPROVAL,
    send: async () => ({ id: 'staff_approval_msg_smoke' }),
  };

  const channelMap = new Collection([
    [config.CHANNELS.REGISTER, mockRegisterChannel],
    [config.CHANNELS.STAFF_APPROVAL, mockStaffApprovalChannel],
  ]);

  const mockGuild = {
    id: config.GUILD_ID,
    ownerId: '9001',
    members: {
      cache: membersMap,
      fetch: async (idOrOpt) => {
        if (!idOrOpt || typeof idOrOpt === 'object') {
          return membersMap;
        }
        return membersMap.get(String(idOrOpt)) || null;
      },
    },
    channels: {
      cache: channelMap,
      fetch: async (id) => channelMap.get(String(id)) || null,
    },
    roles: {
      cache: guildRolesMap,
      fetch: async () => guildRolesMap,
    },
  };

  const mockClient = {
    isReady: () => true,
    user: { tag: 'MockSmokeBot#0001' },
    guilds: {
      cache: new Collection([
        [mockGuild.id, mockGuild],
      ]),
    },
    channels: {
      fetch: async (id) => channelMap.get(String(id)) || null,
    },
  };

  return {
    mockClient,
    mockGuild,
    membersMap,
  };
}

let server;
let baseUrl;

test.before(async () => {
  origResolveUser = robloxService.resolveUser;
  robloxService.resolveUser = async (input) => ({
    success: true,
    user: {
      id: '12345678',
      name: typeof input === 'string' ? input.trim() : 'MockRoblox',
      displayName: 'MockRobloxDisplay',
      avatarUrl: 'https://www.roblox.com/avatar.png',
    },
  });

  database.init();
  database.data.registrations = [];

  // Veritabanı ön yüklemeleri (Kayıt, Uyarı)
  database.addRegistration({
    discordId: '9101',
    realName: 'Ahmet Yılmaz',
    robloxUsername: 'ahmet_roblox',
    robloxId: '123456',
    gender: 'Erkek',
    registeredAt: Date.now() - 100000,
  });

  // Bekleyen başvuru (9104)
  database.setActiveApplication('9104', {
    userId: '9104',
    threadId: 'thread_9104',
    realName: 'Ali Can',
    gender: 'Erkek',
    robloxUsername: 'ali_roblox',
    createdAt: Date.now() - 20000,
  });

  // Reddedilen başvuru (9105)
  database.data.rejectedApplications = database.data.rejectedApplications || {};
  database.data.rejectedApplications['9105'] = {
    userId: '9105',
    reason: 'Profil şartları sağlanamadı',
    rejectedAt: Date.now() - 10000,
    rejectedBy: '9002',
  };

  database.save();

  const mockEnv = createMockDiscordEnvironment();
  const app = createApp(mockEnv.mockClient);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (origResolveUser) {
    robloxService.resolveUser = origResolveUser;
  }
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

async function apiRequest(endpoint, { method = 'GET', body = null, actorId = '9001', secret = 'test-smoke-secret-xyz' } = {}) {
  const headers = {};
  if (secret) {
    headers['Authorization'] = `Bearer ${secret}`;
  }
  if (actorId) {
    headers['X-Actor-Id'] = actorId;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body: data };
}

// -------------------------------------------------------------------------
// TESTLER
// -------------------------------------------------------------------------

test('1. GET /api/admin/members?query= (boş ve dolu sorgu, 200 dönmeli)', async () => {
  // Boş sorgu
  const emptyQueryRes = await apiRequest('/api/admin/members?query=');
  assert.equal(emptyQueryRes.status, 200, 'Boş sorgu 200 dönmeli, 500 olmamalı');
  assert.ok(emptyQueryRes.body.members.length >= 4, 'Üye listesi dönmeli');
  assert.equal(typeof emptyQueryRes.body.total, 'number');

  for (const m of emptyQueryRes.body.members) {
    assert.ok('registered' in m.registration, 'm.registration.registered alanı olmalı');
    assert.ok('realName' in m.registration, 'm.registration.realName alanı olmalı');
  }

  // Dolu sorgu (Ahmet)
  const queryRes = await apiRequest('/api/admin/members?query=ahmet');
  assert.equal(queryRes.status, 200, 'Dolu sorgu 200 dönmeli');
  assert.ok(queryRes.body.members.length >= 1, 'Ahmet bulunabilmeli');
  const foundAhmet = queryRes.body.members.find((m) => m.id === '9101');
  assert.ok(foundAhmet, '9101 idli Ahmet bulunmalı');
  assert.equal(foundAhmet.registration.registered, true);
  assert.ok(Array.isArray(foundAhmet.registration.games));
  assert.equal(foundAhmet.registration.games[0]?.id, 'roblox');
  assert.equal(foundAhmet.registration.displayName, 'Ahmet Yılmaz');
});

test('2. GET /api/admin/members/:id (kayıtlı ve kayıtsız üye, tryout/vs alanları olmamalı)', async () => {
  // A. Kayıtlı Üye (9101)
  const regRes = await apiRequest('/api/admin/members/9101');
  assert.equal(regRes.status, 200, 'Kayıtlı üye 200 dönmeli');
  assert.equal(regRes.body.discord.id, '9101');
  assert.equal(regRes.body.registration.registered, true);
  assert.equal(regRes.body.registration.realName, 'Ahmet Yılmaz');
  assert.equal(regRes.body.registration.displayName, 'Ahmet Yılmaz');
  assert.ok(Array.isArray(regRes.body.registration.games));
  assert.equal(regRes.body.registration.games[0]?.username, 'ahmet_roblox');
  assert.equal(regRes.body.tryout, undefined, 'tryout alanı kaldırılmış olmalı');
  assert.equal(regRes.body.vs, undefined, 'vs alanı kaldırılmış olmalı');

  // B. Kayıtsız Üye (9103)
  const unregRes = await apiRequest('/api/admin/members/9103');
  assert.equal(unregRes.status, 200, 'Kayıtsız üye 200 dönmeli');
  assert.equal(unregRes.body.registration.registered, false);
});

test('3. GET /api/member/:id/roles ve /api/member/:id/profile', async () => {
  // Roller endpoint'i
  const rolesRes = await apiRequest('/api/member/9101/roles');
  assert.equal(rolesRes.status, 200, '/roles 200 dönmeli');
  assert.equal(rolesRes.body.registered, true);
  assert.ok(Array.isArray(rolesRes.body.roles));

  // Profil endpoint'i
  const profileRes = await apiRequest('/api/member/9101/profile');
  assert.equal(profileRes.status, 200, '/profile 200 dönmeli');
  assert.equal(profileRes.body.registration?.registered, true);
  assert.equal(profileRes.body.registration?.displayName, 'Ahmet Yılmaz');
  assert.equal(profileRes.body.registration?.games?.[0]?.id, 'roblox');
  assert.equal(profileRes.body.tryout, undefined, 'tryout kaldırılmış olmalı');
  assert.equal(profileRes.body.vs, undefined, 'vs kaldırılmış olmalı');
});

test('4. GET /api/register/status/:id (approved, pending, rejected, unregistered)', async () => {
  // A. Approved (9101)
  const approvedRes = await apiRequest('/api/register/status/9101');
  assert.equal(approvedRes.status, 200);
  assert.equal(approvedRes.body.status, 'approved');
  assert.ok(Array.isArray(approvedRes.body.registration?.games));

  // B. Pending (9104)
  const pendingRes = await apiRequest('/api/register/status/9104');
  assert.equal(pendingRes.status, 200);
  assert.equal(pendingRes.body.status, 'pending');
  assert.ok(Array.isArray(pendingRes.body.application?.games));

  // C. Rejected (9105)
  const rejectedRes = await apiRequest('/api/register/status/9105');
  assert.equal(rejectedRes.status, 200);
  assert.equal(rejectedRes.body.status, 'rejected');

  // D. Unregistered (9103)
  const unregRes = await apiRequest('/api/register/status/9103');
  assert.equal(unregRes.status, 200);
  assert.equal(unregRes.body.status, 'unregistered');
});

test('5. POST /api/register (başvuru oluşturma - eski ve yeni gövde uyumu)', async () => {
  // Eski formatla başvuru (9106)
  const regRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9106',
      realName: 'Barış Can',
      gender: 'male',
      robloxInput: 'baris_roblox',
    },
  });
  assert.equal(regRes.status, 200, 'Eski formatlı kayıt 200 dönmeli');
  assert.equal(regRes.body.success, true);
  assert.ok(regRes.body.threadId);
});

test('6. Kaldırılan rotalar 404 dönmeli (/api/tryout ve /api/help)', async () => {
  const tryoutRes = await apiRequest('/api/tryout/leaderboard');
  assert.equal(tryoutRes.status, 404, '/api/tryout 404 dönmeli');

  const helpRes = await apiRequest('/api/help/status');
  assert.equal(helpRes.status, 404, '/api/help 404 dönmeli');
});

test('7. POST /api/register (yeni çoklu oyun gövdesi ve hata kodları)', async () => {
  // Oyun seçilmeden gönderim -> NO_GAME_SELECTED
  const noGameRes = await apiRequest('/api/register', {
    method: 'POST',
    body: { discordId: '9103', name: 'Test Üye', gender: 'male', games: [] },
  });
  assert.equal(noGameRes.status, 400);
  assert.equal(noGameRes.body.code, 'NO_GAME_SELECTED');

  // Geçersiz isim -> NAME_INVALID
  const badNameRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9103',
      name: 'yok',
      gender: 'male',
      games: [{ id: 'cs2', username: 's1mple' }],
    },
  });
  assert.equal(badNameRes.status, 400);
  assert.equal(badNameRes.body.code, 'NAME_INVALID');

  // Geçersiz Minecraft nicki -> GAME_USERNAME_INVALID + details.game
  const badMcRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9103',
      name: 'Emre Kaya',
      gender: 'male',
      games: [{ id: 'minecraft', username: 'gecersiz nick!' }],
    },
  });
  assert.equal(badMcRes.status, 400);
  assert.equal(badMcRes.body.code, 'GAME_USERNAME_INVALID');
  assert.equal(badMcRes.body.details?.game, 'minecraft');

  // Geçerli çoklu oyun başvurusu (9103: CS2 + Minecraft)
  const validMultiRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9103',
      name: 'Emre Kaya',
      gender: 'male',
      lang: 'en',
      games: [
        { id: 'cs2', username: 'EmreCS2' },
        { id: 'minecraft', username: 'Emre_MC1' },
      ],
    },
  });
  assert.equal(validMultiRes.status, 200);
  assert.equal(validMultiRes.body.success, true);
  assert.ok(validMultiRes.body.threadId);
});

test('8. POST /api/register lang:"en" gönderilse bile veritabanına kalıcı dil yazmamalı', async () => {
  assert.equal(
    database.getUserLangInfo('9103'),
    null,
    'API üzerinden lang:"en" ile başvuru yapıldığında languagePrefs kalıcı olarak yazılmamalı'
  );
});

test('9. GET /api/games etkin oyunları roleId olmadan döndürmeli ve Bearer korumalı olmalı', async () => {
  // Yetkisiz istek -> 401
  const unauthRes = await fetch(`${baseUrl}/api/games`);
  assert.equal(unauthRes.status, 401);

  const res = await apiRequest('/api/games');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.games));
  assert.equal(res.body.games.length, 4);

  const ids = res.body.games.map((g) => g.id);
  assert.deepEqual(ids, ['roblox', 'cs2', 'zula', 'minecraft']);

  for (const g of res.body.games) {
    assert.equal(Object.prototype.hasOwnProperty.call(g, 'roleId'), false, 'roleId dışarı sızmamalı');
    assert.ok(g.name && g.name.tr && g.name.en);
    assert.ok(g.buttonLabel && g.buttonLabel.tr && g.buttonLabel.en);
    assert.ok(g.validate && typeof g.validate.min === 'number');
  }

  const mcGame = res.body.games.find((g) => g.id === 'minecraft');
  assert.equal(typeof mcGame.validate.regex, 'string');
  assert.ok(mcGame.validate.regex.length > 0);
});

test('10. GET /api/roblox/lookup tüm durumları (FOUND, NOT_FOUND, BANNED, TEMPORARY_ERROR, alreadyRegistered, güvenlik ve 10/dk hız sınırı) döndürmeli', async () => {
  // Yetkisiz -> 401
  const unauth = await fetch(`${baseUrl}/api/roblox/lookup?query=builderman`);
  assert.equal(unauth.status, 401);

  // X-Actor-Id olmadan -> 400
  const noActor = await apiRequest('/api/roblox/lookup?query=builderman', { actorId: null });
  assert.equal(noActor.status, 400);

  // Geçersiz/kötü amaçlı girdiler -> 400
  const badInputs = ['', '   ', 'a'.repeat(101), '<@123456>', 'discord.gg/davet', 'https://evil.com/user'];
  for (const q of badInputs) {
    const r = await apiRequest(`/api/roblox/lookup?query=${encodeURIComponent(q)}`, {
      actorId: '9104',
    });
    assert.equal(r.status, 400, `Geçersiz sorgu reddedilmeli: ${q}`);
  }

  // A. FOUND + alreadyRegistered: false
  robloxService.resolveUser = async (query) => {
    assert.equal(query, 'builderman');
    return {
      success: true,
      user: {
        id: '156',
        name: 'builderman',
        displayName: 'Builderman',
        avatarUrl: 'https://tr.rbxcdn.com/avatar/156.png',
      },
    };
  };
  const foundRes = await apiRequest('/api/roblox/lookup?query=builderman', {
    actorId: '9101',
  });
  assert.equal(foundRes.status, 200);
  assert.equal(foundRes.body.status, 'FOUND');
  assert.equal(foundRes.body.alreadyRegistered, false);
  assert.equal(foundRes.body.user.id, '156');
  assert.equal(foundRes.body.user.profileUrl, 'https://www.roblox.com/users/156/profile');

  // B. FOUND + alreadyRegistered: true (kimin kaydettiği ASLA sızdırılmamalı)
  database.addRegistration({
    discordId: '888877776666',
    displayName: 'Gizli Kullanıcı',
    robloxId: '156',
    robloxUsername: 'builderman',
    games: [{ id: 'roblox', username: 'builderman', verified: true, robloxId: '156' }],
  });
  const dupRes = await apiRequest('/api/roblox/lookup?query=builderman', {
    actorId: '9101',
  });
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.body.status, 'FOUND');
  assert.equal(dupRes.body.alreadyRegistered, true);
  assert.equal(JSON.stringify(dupRes.body).includes('888877776666'), false, 'Başka kullanıcının discordId si sızmamalı');

  // C. NOT_FOUND
  robloxService.resolveUser = async () => ({ success: false, error: 'NOT_FOUND', message: 'Yok' });
  const nfRes = await apiRequest('/api/roblox/lookup?query=olmayan123', {
    actorId: '9101',
  });
  assert.equal(nfRes.status, 200);
  assert.equal(nfRes.body.status, 'NOT_FOUND');
  assert.equal(nfRes.body.alreadyRegistered, false);

  // D. BANNED
  robloxService.resolveUser = async () => ({ success: false, error: 'BANNED', message: 'Banned' });
  const banRes = await apiRequest('/api/roblox/lookup?query=banli_user', {
    actorId: '9101',
  });
  assert.equal(banRes.status, 200);
  assert.equal(banRes.body.status, 'BANNED');

  // E. Geçici API / hız sınırı hatası -> TEMPORARY_ERROR (NOT_FOUND sanılmamalı!)
  robloxService.resolveUser = async () => ({ success: false, error: 'RATE_LIMITED', message: '429' });
  const tempRes = await apiRequest('/api/roblox/lookup?query=test_user', {
    actorId: '9101',
  });
  assert.equal(tempRes.status, 200);
  assert.equal(tempRes.body.status, 'TEMPORARY_ERROR');

  // F. Dakikada 10 istek hız sınırı kontrolü (9101 şu ana kadar 5 geçerli istek yaptı, 5 tane daha yapıp 11.'de 429 almalı)
  robloxService.resolveUser = async () => ({ success: false, error: 'NOT_FOUND', message: 'Yok' });
  for (let i = 0; i < 5; i++) {
    const okLoop = await apiRequest('/api/roblox/lookup?query=testloop', {
      actorId: '9101',
    });
    assert.equal(okLoop.status, 200);
  }
  const limitedRes = await apiRequest('/api/roblox/lookup?query=testloop', {
    actorId: '9101',
  });
  assert.equal(limitedRes.status, 429);

  // Farklı bir aktör (9103) sınır dışı olmamalı
  const otherActorRes = await apiRequest('/api/roblox/lookup?query=testloop', {
    actorId: '9103',
  });
  assert.equal(otherActorRes.status, 200);
});
