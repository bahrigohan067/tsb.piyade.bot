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
  const ownRole = createRole(config.ROLES.REGISTERED_CHECK, 'Kayıtlı Üye', 20);
  const otherClanRole = createRole(config.ROLES.OTHER_CLAN, 'Other Clan', 25);
  const customClanRole = createRole('8888', 'Valhalla', 24, '#95a5a6');
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
    roles: [ownRole],
  });

  makeMember({
    id: '9102',
    username: 'mehmet_uye',
    displayName: 'Mehmet | mehmet_roblox',
    roles: [otherClanRole, customClanRole],
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
    username: 'yeni_kayit_own',
    displayName: 'Yeni Piyade Adayı',
    roles: [unregisteredRole],
  });

  makeMember({
    id: '9107',
    username: 'yeni_kayit_other',
    displayName: 'Yeni Klan Adayı',
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

  // Veritabanı ön yüklemeleri (Kayıt, Tryout, Uyarı)
  database.addRegistration({
    discordId: '9101',
    realName: 'Ahmet Yılmaz',
    robloxUsername: 'ahmet_roblox',
    robloxId: '123456',
    gender: 'Erkek',
    registrationType: 'own',
    clanName: null,
    clanRoleId: null,
    clanRoleCreated: false,
    registeredAt: Date.now() - 100000,
  });

  database.addRegistration({
    discordId: '9102',
    realName: 'Mehmet Demir',
    robloxUsername: 'mehmet_roblox',
    robloxId: '654321',
    gender: 'Erkek',
    registrationType: 'other',
    clanName: 'Valhalla',
    clanRoleId: '8888',
    clanRoleCreated: false,
    registeredAt: Date.now() - 50000,
  });

  // Bekleyen başvuru (9104)
  database.setActiveApplication('9104', {
    userId: '9104',
    threadId: 'thread_9104',
    realName: 'Ali Can',
    gender: 'Erkek',
    robloxUsername: 'ali_roblox',
    registrationType: 'other',
    clanTypedName: 'Dark Wolves',
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

test('1. GET /api/admin/members?query= (boş ve dolu sorgu, config hatası olmadan 200 dönmeli)', async () => {
  // Boş sorgu
  const emptyQueryRes = await apiRequest('/api/admin/members?query=');
  assert.equal(emptyQueryRes.status, 200, 'Boş sorgu 200 dönmeli, 500 olmamalı');
  assert.ok(emptyQueryRes.body.members.length >= 5, 'Üye listesi dönmeli');
  assert.equal(typeof emptyQueryRes.body.total, 'number');

  // Her üye için registration alanlarının yapısını doğrula
  for (const m of emptyQueryRes.body.members) {
    assert.ok('registered' in m.registration, 'm.registration.registered alanı olmalı');
    assert.ok('type' in m.registration, 'm.registration.type alanı olmalı');
    assert.ok('clanName' in m.registration, 'm.registration.clanName alanı olmalı');
    assert.ok('clanRoleId' in m.registration, 'm.registration.clanRoleId alanı olmalı');
  }

  // Dolu sorgu (Ahmet)
  const queryRes = await apiRequest('/api/admin/members?query=ahmet');
  assert.equal(queryRes.status, 200, 'Dolu sorgu 200 dönmeli');
  assert.ok(queryRes.body.members.length >= 1, 'Ahmet bulunabilmeli');
  const foundAhmet = queryRes.body.members.find((m) => m.id === '9101');
  assert.ok(foundAhmet, '9101 idli Ahmet bulunmalı');
  assert.equal(foundAhmet.registration.registered, true);
  assert.equal(foundAhmet.registration.type, 'own');
  assert.equal(foundAhmet.registration.clanName, null);
});

test('2. GET /api/admin/members/:id (kayıtlı own, kayıtlı other ve kayıtsız üye)', async () => {
  // A. Piyade Klanı Üyesi (9101)
  const ownRes = await apiRequest('/api/admin/members/9101');
  assert.equal(ownRes.status, 200, 'Kayıtlı own üye 200 dönmeli');
  assert.equal(ownRes.body.discord.id, '9101');
  assert.equal(ownRes.body.registration.registered, true);
  assert.equal(ownRes.body.registration.type, 'own');
  assert.equal(ownRes.body.registration.clanName, null);
  assert.equal(ownRes.body.registration.realName, 'Ahmet Yılmaz');

  // B. Başka Klan Üyesi (9102)
  const otherRes = await apiRequest('/api/admin/members/9102');
  assert.equal(otherRes.status, 200, 'Kayıtlı other üye 200 dönmeli');
  assert.equal(otherRes.body.discord.id, '9102');
  assert.equal(otherRes.body.registration.registered, true);
  assert.equal(otherRes.body.registration.type, 'other');
  assert.equal(otherRes.body.registration.clanName, 'Valhalla');
  assert.equal(otherRes.body.registration.clanRoleId, '8888');

  // C. Kayıtsız Üye (9103)
  const unregRes = await apiRequest('/api/admin/members/9103');
  assert.equal(unregRes.status, 200, 'Kayıtsız üye 200 dönmeli');
  assert.equal(unregRes.body.registration.registered, false);
  assert.equal(unregRes.body.registration.type, null);
  assert.equal(unregRes.body.registration.clanName, null);
});

test('3. GET /api/member/:id/roles ve /api/member/:id/profile', async () => {
  // Roller endpoint'i
  const rolesRes = await apiRequest('/api/member/9102/roles');
  assert.equal(rolesRes.status, 200, '/roles 200 dönmeli');
  assert.equal(rolesRes.body.registered, true);
  assert.equal(rolesRes.body.registrationType, 'other');
  assert.equal(rolesRes.body.clan?.name, 'Valhalla');
  assert.equal(rolesRes.body.clan?.roleId, '8888');

  // Profil endpoint'i
  const profileRes = await apiRequest('/api/member/9102/profile');
  assert.equal(profileRes.status, 200, '/profile 200 dönmeli');
  assert.equal(profileRes.body.registration?.registered, true);
  assert.equal(profileRes.body.registration?.type, 'other');
  assert.equal(profileRes.body.registration?.clanName, 'Valhalla');
  assert.equal(profileRes.body.registration?.clanRoleId, '8888');
});

test('4. GET /api/register/status/:id (approved, pending, rejected, unregistered)', async () => {
  // A. Approved (9101)
  const approvedRes = await apiRequest('/api/register/status/9101');
  assert.equal(approvedRes.status, 200);
  assert.equal(approvedRes.body.status, 'approved');
  assert.equal(approvedRes.body.registrationType, 'own');

  // B. Pending (9104)
  const pendingRes = await apiRequest('/api/register/status/9104');
  assert.equal(pendingRes.status, 200);
  assert.equal(pendingRes.body.status, 'pending');
  assert.equal(pendingRes.body.registrationType, 'other');
  assert.equal(pendingRes.body.clanName, 'Dark Wolves');

  // C. Rejected (9105)
  const rejectedRes = await apiRequest('/api/register/status/9105');
  assert.equal(rejectedRes.status, 200);
  assert.equal(rejectedRes.body.status, 'rejected');

  // D. Unregistered (9103)
  const unregRes = await apiRequest('/api/register/status/9103');
  assert.equal(unregRes.status, 200);
  assert.equal(unregRes.body.status, 'unregistered');
});

test('5. POST /api/register (own ve other, geçersiz klan adı hataları)', async () => {
  // A. Piyade klanı başvurusu (own)
  const ownRegRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9106',
      realName: 'Barış Can',
      gender: 'male',
      robloxInput: 'baris_roblox',
      registrationType: 'own',
    },
  });
  assert.equal(ownRegRes.status, 200, 'Piyade kaydı 200 dönmeli');
  assert.equal(ownRegRes.body.success, true);
  assert.equal(ownRegRes.body.registrationType, 'own');

  // B. Başka klan başvurusu (other) - Geçerli klan adı
  const otherRegRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9107',
      realName: 'Görkem Kaya',
      gender: 'male',
      robloxInput: 'gorkem_roblox',
      registrationType: 'other',
      clanName: 'Shadow Hunters',
    },
  });
  assert.equal(otherRegRes.status, 200, 'Başka klan kaydı 200 dönmeli');
  assert.equal(otherRegRes.body.success, true);
  assert.equal(otherRegRes.body.registrationType, 'other');

  // Aktif başvuruda klan adının saklandığını doğrula
  const storedApp = database.getActiveApplication('9107');
  assert.ok(storedApp, '9107 nolu başvuru veritabanında olmalı');
  assert.equal(storedApp.clanTypedName, 'Shadow Hunters');

  // C. Başka klan başvurusu - Boş / eksik klan adı (400 CLAN_REQUIRED)
  const missingClanRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9103',
      realName: 'Test İsim',
      gender: 'male',
      robloxInput: 'test_roblox',
      registrationType: 'other',
      clanName: '',
    },
  });
  assert.equal(missingClanRes.status, 400, 'Eksik klan adı 400 dönmeli');
  assert.equal(missingClanRes.body.code, 'CLAN_REQUIRED');

  // D. Başka klan başvurusu - Yasaklı / mention klan adı (400 CLAN_BLOCKED)
  const blockedClanRes = await apiRequest('/api/register', {
    method: 'POST',
    body: {
      discordId: '9103',
      realName: 'Test İsim',
      gender: 'male',
      robloxInput: 'test_roblox',
      registrationType: 'other',
      clanName: '@everyone Clan',
    },
  });
  assert.equal(blockedClanRes.status, 400, 'Yasaklı klan adı 400 dönmeli');
  assert.equal(blockedClanRes.body.code, 'CLAN_BLOCKED');
});
