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
});

test('2. GET /api/admin/members/:id (kayıtlı ve kayıtsız üye, tryout/vs alanları olmamalı)', async () => {
  // A. Kayıtlı Üye (9101)
  const regRes = await apiRequest('/api/admin/members/9101');
  assert.equal(regRes.status, 200, 'Kayıtlı üye 200 dönmeli');
  assert.equal(regRes.body.discord.id, '9101');
  assert.equal(regRes.body.registration.registered, true);
  assert.equal(regRes.body.registration.realName, 'Ahmet Yılmaz');
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
  assert.equal(profileRes.body.tryout, undefined, 'tryout kaldırılmış olmalı');
  assert.equal(profileRes.body.vs, undefined, 'vs kaldırılmış olmalı');
});

test('4. GET /api/register/status/:id (approved, pending, rejected, unregistered)', async () => {
  // A. Approved (9101)
  const approvedRes = await apiRequest('/api/register/status/9101');
  assert.equal(approvedRes.status, 200);
  assert.equal(approvedRes.body.status, 'approved');

  // B. Pending (9104)
  const pendingRes = await apiRequest('/api/register/status/9104');
  assert.equal(pendingRes.status, 200);
  assert.equal(pendingRes.body.status, 'pending');

  // C. Rejected (9105)
  const rejectedRes = await apiRequest('/api/register/status/9105');
  assert.equal(rejectedRes.status, 200);
  assert.equal(rejectedRes.body.status, 'rejected');

  // D. Unregistered (9103)
  const unregRes = await apiRequest('/api/register/status/9103');
  assert.equal(unregRes.status, 200);
  assert.equal(unregRes.body.status, 'unregistered');
});

test('5. POST /api/register (başvuru oluşturma)', async () => {
  const regRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9106',
      realName: 'Barış Can',
      gender: 'male',
      robloxInput: 'baris_roblox',
    },
  });
  assert.equal(regRes.status, 200, 'Kayıt 200 dönmeli');
  assert.equal(regRes.body.success, true);
  assert.ok(regRes.body.threadId);
});

test('6. Kaldırılan rotalar 404 dönmeli (/api/tryout ve /api/help)', async () => {
  const tryoutRes = await apiRequest('/api/tryout/leaderboard');
  assert.equal(tryoutRes.status, 404, '/api/tryout 404 dönmeli');

  const helpRes = await apiRequest('/api/help/status');
  assert.equal(helpRes.status, 404, '/api/help 404 dönmeli');
});
