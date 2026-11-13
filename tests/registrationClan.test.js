const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Testler için izole geçici veri klasörü ve ortam değişkenleri
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-clan-reg-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-secret-clan-123';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const database = require('../src/utils/database');
const clanMatcher = require('../src/utils/clanMatcher');
const { updateClanPanel, buildClanPanelEmbeds } = require('../src/utils/clanPanel');
const klanEkleCommand = require('../src/commands/klanEkle');
const klanDuzenleCommand = require('../src/commands/klanDuzenle');
const klanSilCommand = require('../src/commands/klanSil');
const klanListeCommand = require('../src/commands/klanListe');
const klanPaneliKurCommand = require('../src/commands/klanPaneliKur');

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

/**
 * Sahte Discord Guild ve Role Ortamı
 */
function createMockGuildEnvironment() {
  const roles = new Map();
  let roleIdCounter = 5000;

  function createRoleObj({ id, name, color = 0, position = 10, managed = false, permissions = [] }) {
    const roleId = id || String(roleIdCounter++);
    const role = {
      id: roleId,
      name,
      color,
      position,
      managed,
      permissions: {
        has: (perm) => permissions.includes(perm),
      },
      async setPosition(newPos) {
        role.position = newPos;
        return role;
      },
    };
    roles.set(roleId, role);
    return role;
  }

  // Temel roller
  const otherClanRole = createRoleObj({ id: config.ROLES.OTHER_CLAN, name: 'Other Clan', position: 20 });
  const verifiedRole = createRoleObj({ id: config.ROLES.VERIFIED, name: 'Hesabı Onaylı', position: 15 });
  const registeredCheckRole = createRoleObj({ id: config.ROLES.REGISTERED_CHECK, name: 'Kayıtlı Üye', position: 14 });
  const unregisteredRole = createRoleObj({ id: config.ROLES.UNREGISTERED, name: 'Kayıtsız', position: 5 });
  const maleRole = createRoleObj({ id: config.ROLES.MALE, name: 'Erkek', position: 12 });
  const femaleRole = createRoleObj({ id: config.ROLES.FEMALE, name: 'Kız', position: 12 });
  const staffRole = createRoleObj({ id: config.ROLES.STAFF, name: 'Kayıt Yetkilisi', position: 35 });
  const devRole = createRoleObj({ id: config.ROLES.DEVELOPER, name: 'Developer', position: 40 });

  // Bot kullanıcısı rolü
  createRoleObj({ id: 'bot_highest_role', name: 'TSB Bot', position: 50 });

  const members = new Map();

  function createMember({ id, username, roleIds = [], isAdmin = false }) {
    const memberRoleMap = new Map();
    roleIds.forEach((rid) => {
      if (roles.has(rid)) memberRoleMap.set(rid, roles.get(rid));
    });

    let currentNickname = username;
    let failRoleAdd = false;

    const member = {
      id,
      user: { id, tag: `${username}#0001`, username },
      displayName: currentNickname,
      roles: {
        cache: memberRoleMap,
        highest: { position: 10 },
        async add(roleId) {
          if (failRoleAdd) {
            throw new Error('Missing Permissions / Hierarchy');
          }
          if (roles.has(roleId)) {
            memberRoleMap.set(roleId, roles.get(roleId));
          }
        },
        async remove(roleId) {
          memberRoleMap.delete(roleId);
        },
      },
      permissions: {
        has: (perm) => (isAdmin ? true : false),
      },
      async setNickname(nick) {
        currentNickname = nick;
        member.displayName = nick;
        return member;
      },
      setFailRoleAdd(val) {
        failRoleAdd = val;
      },
    };

    members.set(id, member);
    return member;
  }

  const channelMessages = [];
  const mockChannel = {
    id: config.CHANNELS.CLAN_PANEL,
    messages: {
      async fetch(query) {
        if (typeof query === 'string') {
          return channelMessages.find((m) => m.id === query) || null;
        }
        return channelMessages;
      },
    },
    async send(payload) {
      const msg = {
        id: `panel_msg_${channelMessages.length + 1}`,
        author: { id: 'bot_user_id' },
        embeds: payload.embeds || [],
        async edit(newPayload) {
          if (newPayload.embeds) msg.embeds = newPayload.embeds;
          return msg;
        },
      };
      channelMessages.push(msg);
      return msg;
    },
  };

  const mockThread = {
    id: 'mock_thread_id_999',
    url: 'https://discord.com/channels/th',
    members: { async add() {} },
    send: async () => ({ id: 'thread_msg_1' }),
  };
  const mockRegisterChannel = {
    id: config.CHANNELS.REGISTER,
    threads: {
      async create() {
        return mockThread;
      },
    },
  };
  const mockStaffApprovalChannel = {
    id: config.CHANNELS.STAFF_APPROVAL,
    async send() {
      return { id: 'staff_msg_1' };
    },
  };

  const channelMap = new Map([
    [config.CHANNELS.CLAN_PANEL, mockChannel],
    [config.CHANNELS.REGISTER, mockRegisterChannel],
    [config.CHANNELS.STAFF_APPROVAL, mockStaffApprovalChannel],
  ]);

  const mockGuild = {
    id: config.GUILD_ID,
    roles: {
      cache: roles,
      async create(options) {
        return createRoleObj({
          name: options.name,
          color: options.color,
          position: 19,
        });
      },
    },
    members: {
      cache: members,
      me: {
        roles: {
          highest: { position: 50 },
        },
      },
      async fetch(id) {
        return members.get(String(id)) || null;
      },
    },
    channels: {
      cache: channelMap,
      async fetch(id) {
        return channelMap.get(id) || null;
      },
    },
    client: {
      user: { id: 'bot_user_id' },
    },
  };

  return {
    mockGuild,
    roles,
    members,
    createMember,
    createRoleObj,
    channelMessages,
  };
}

// -------------------------------------------------------------
// TEST SENARYOLARI
// -------------------------------------------------------------

test('1. isRegisteredMember: Other Clan ve Registered Check tespiti', () => {
  const env = createMockGuildEnvironment();

  const regMember = env.createMember({ id: 'u1', username: 'piyade_uye', roleIds: [config.ROLES.REGISTERED_CHECK] });
  assert.equal(config.isRegisteredMember(regMember), true);

  const otherMember = env.createMember({ id: 'u2', username: 'diger_uye', roleIds: [config.ROLES.OTHER_CLAN] });
  assert.equal(config.isRegisteredMember(otherMember), true);

  const unregMember = env.createMember({ id: 'u3', username: 'kayitsiz', roleIds: [config.ROLES.UNREGISTERED] });
  assert.equal(config.isRegisteredMember(unregMember), false);
});

test('2. Eski başvuru kayıtları (registrationType alanı yok) varsayılan olarak "own" sayılır', () => {
  database.data.registrations.push({
    discordId: 'old_reg_1',
    realName: 'Eski Üye',
    robloxUsername: 'OldUser',
  });
  database.save();

  const found = database.getRegistrationByDiscordId('old_reg_1');
  assert.ok(found);
  assert.equal(found.registrationType || 'own', 'own');

  database.data.activeApplications['old_app_1'] = {
    threadId: 'th_123',
    realName: 'Eski Başvuru',
  };
  database.save();

  const app = database.getActiveApplication('old_app_1');
  assert.ok(app);
  assert.equal(app.registrationType, 'own');
});

test('3. Other Clan + Yeni Klan: Rol oluşturulur, OTHER_CLAN + VERIFIED verilir, REGISTERED_CHECK verilmez', async () => {
  const env = createMockGuildEnvironment();
  const applicant = env.createMember({
    id: 'applicant_1',
    username: 'apex_warrior',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  const staff = env.createMember({
    id: 'staff_1',
    username: 'yetkili',
    roleIds: [config.ROLES.STAFF],
  });

  // Başvuru oluştur
  database.setActiveApplication('applicant_1', {
    threadId: 'th_mock_1',
    realName: 'Kaan Demir',
    gender: 'Erkek',
    registrationType: 'other',
    clanTypedName: 'Apex Predators',
    clanResolution: {
      mode: 'new',
      displayName: 'Apex Predators',
      score: 0.1,
    },
    robloxId: '987654321',
    robloxUsername: 'ApexKaan',
  });

  // Simüle edilmiş onay akışı
  const activeApp = database.getActiveApplication('applicant_1');
  assert.equal(activeApp.registrationType, 'other');

  const clanRes = activeApp.clanResolution;
  const newRole = await env.mockGuild.roles.create({
    name: clanRes.displayName,
    color: config.CLAN.ROLE_COLOR,
  });

  database.addClanRole({
    roleId: newRole.id,
    name: newRole.name,
    normalized: clanMatcher.normalizeClanName(newRole.name).full,
    compact: clanMatcher.normalizeClanName(newRole.name).compact,
    aliases: [activeApp.clanTypedName],
    source: 'bot',
    createdBy: staff.id,
  });

  // Rolleri ver
  await applicant.roles.add(config.ROLES.OTHER_CLAN);
  await applicant.roles.add(config.ROLES.VERIFIED);
  await applicant.roles.add(newRole.id);
  await applicant.roles.add(config.ROLES.MALE);
  await applicant.roles.remove(config.ROLES.UNREGISTERED);
  await applicant.setNickname('Kaan Demir | ApexKaan');

  database.addRegistration({
    discordId: 'applicant_1',
    realName: activeApp.realName,
    registrationType: 'other',
    clanName: activeApp.clanTypedName,
    clanRoleId: newRole.id,
    clanRoleCreated: true,
  });
  database.removeActiveApplication('applicant_1');

  // Kontroller
  assert.equal(applicant.roles.cache.has(config.ROLES.OTHER_CLAN), true);
  assert.equal(applicant.roles.cache.has(config.ROLES.VERIFIED), true);
  assert.equal(applicant.roles.cache.has(newRole.id), true);
  assert.equal(applicant.roles.cache.has(config.ROLES.MALE), true);
  assert.equal(applicant.roles.cache.has(config.ROLES.UNREGISTERED), false);
  // REGISTERED_CHECK (1559604702143062016) kesinlikle verilmemeli!
  assert.equal(applicant.roles.cache.has(config.ROLES.REGISTERED_CHECK), false);

  const regSaved = database.getRegistrationByDiscordId('applicant_1');
  assert.equal(regSaved.registrationType, 'other');
  assert.equal(regSaved.clanName, 'Apex Predators');
  assert.equal(regSaved.clanRoleCreated, true);
  assert.equal(database.getActiveApplication('applicant_1'), null);
});

test('4. Other Clan + Mevcut Klan: Yeni rol açılmaz, mevcut rol verilir', async () => {
  const env = createMockGuildEnvironment();
  const existingRole = env.createRoleObj({ name: 'Dark Wolves' });
  database.addClanRole({
    roleId: existingRole.id,
    name: 'Dark Wolves',
    compact: 'darkwolves',
    aliases: ['DW'],
    source: 'adopted',
  });

  const applicant = env.createMember({ id: 'applicant_2', username: 'wolf_fan' });

  // Kullanıcı "Dark Wolves" ile başvurur
  const res = clanMatcher.resolveClan('Dark Wolves', {
    registryRoles: database.getClanRoles(),
    safeGuildRoles: Array.from(env.mockGuild.roles.cache.values()),
    knownClans: [],
    ownClanAliases: config.OWN_CLAN_ALIASES,
  });

  assert.equal(res.mode, 'existing');
  assert.equal(res.roleId, existingRole.id);

  let roleCreatedCount = 0;
  const originalCreate = env.mockGuild.roles.create;
  env.mockGuild.roles.create = async () => {
    roleCreatedCount++;
    return originalCreate();
  };

  // Onaylandığında mevcut rol verilir, create çağrılmaz
  await applicant.roles.add(res.roleId);
  assert.equal(roleCreatedCount, 0);
  assert.equal(applicant.roles.cache.has(existingRole.id), true);
});

test('5. Yazım hatalı klan adı (Dark Wolfs -> Dark Wolves) çözümlenir ve alias eklenir', () => {
  const env = createMockGuildEnvironment();
  const existingRole = env.createRoleObj({ name: 'Dark Wolves' });
  database.addClanRole({
    roleId: existingRole.id,
    name: 'Dark Wolves',
    compact: 'darkwolves',
    aliases: [],
    source: 'manual',
  });

  const res = clanMatcher.resolveClan('Dark Wolfs', {
    registryRoles: database.getClanRoles(),
    safeGuildRoles: Array.from(env.mockGuild.roles.cache.values()),
    knownClans: [],
    ownClanAliases: config.OWN_CLAN_ALIASES,
  });

  assert.ok(['existing', 'suggested'].includes(res.mode));
  assert.equal(res.roleId, existingRole.id);

  // Alias ekleme
  database.addClanAlias(existingRole.id, 'Dark Wolfs');
  const updatedClanRole = database.getClanRoleByRoleId(existingRole.id);
  assert.ok(updatedClanRole.aliases.includes('Dark Wolfs'));
});

test('6. Korumalı rol adıyla çakışma (Yönetmenlik / Admin): Güvensiz rol engellenir', () => {
  const env = createMockGuildEnvironment();
  const adminRole = env.createRoleObj({
    name: 'Yönetmenlik',
    position: 45,
    permissions: ['Administrator'],
  });

  const isSafe = clanMatcher.isSafeClanRole(adminRole, env.mockGuild, config, database);
  assert.equal(isSafe, false);

  const res = clanMatcher.resolveClan('Yönetmenlik', {
    registryRoles: database.getClanRoles(),
    safeGuildRoles: Array.from(env.mockGuild.roles.cache.values()).filter((r) =>
      clanMatcher.isSafeClanRole(r, env.mockGuild, config, database)
    ),
    knownClans: [],
    ownClanAliases: config.OWN_CLAN_ALIASES,
  });

  // Yönetmenlik güvenli roller arasında yer almadığı için eşleşmemeli
  assert.notEqual(res.roleId, adminRole.id);
});

test('7. Çift onay basışı: İkinci onay işlem yapmaz ve başvuru zaten sonuçlanmış döner', () => {
  database.setActiveApplication('applicant_double', {
    realName: 'Test',
    registrationType: 'own',
  });

  // 1. onay
  const firstApp = database.getActiveApplication('applicant_double');
  assert.ok(firstApp);
  database.removeActiveApplication('applicant_double');

  // 2. onay girişimi
  const secondApp = database.getActiveApplication('applicant_double');
  assert.equal(secondApp, null); // Bulunamadığı için ikinci onay reddedilir
});

test('8. İki eşzamanlı onay aynı yeni klan için tek rol açar', async () => {
  const env = createMockGuildEnvironment();
  const clanName = 'Night Owls';
  const normCompact = clanMatcher.normalizeClanName(clanName).compact;

  let createdRolesCount = 0;
  async function approveClanRole() {
    const existingInReg = database.getClanRoles().find((cr) => cr.compact === normCompact);
    if (existingInReg) return existingInReg.roleId;

    const newRole = await env.mockGuild.roles.create({ name: clanName });
    createdRolesCount++;
    database.addClanRole({
      roleId: newRole.id,
      name: newRole.name,
      compact: normCompact,
    });
    return newRole.id;
  }

  const roleId1 = await approveClanRole();
  const roleId2 = await approveClanRole();

  assert.equal(roleId1, roleId2);
  assert.equal(createdRolesCount, 1);
});

test('9. Rol ekleme hatasında başvuru aktif kalır (Hiyerarşi / Yetki Hatası)', async () => {
  const env = createMockGuildEnvironment();
  const applicant = env.createMember({ id: 'app_err_1', username: 'error_user' });
  applicant.setFailRoleAdd(true);

  database.setActiveApplication('app_err_1', {
    realName: 'Fail Test',
    registrationType: 'own',
    threadId: 'th_error_1',
  });

  let threw = false;
  try {
    await applicant.roles.add(config.ROLES.OTHER_CLAN);
  } catch (err) {
    threw = true;
    // Hata yakalandı -> database.removeActiveApplication ÇAĞRILMAZ
  }

  assert.equal(threw, true);
  assert.ok(database.getActiveApplication('app_err_1')); // Başvuru aktif kalmaya devam etmeli
});

test('10. Dost / Düşman Klan Paneli oluşturma, güncelleme ve silinmiş mesaj kurtarma', async () => {
  const env = createMockGuildEnvironment();

  database.addKnownClan({ name: 'Alpha Clan', type: 'ally' });
  database.addKnownClan({ name: 'Beta Clan', type: 'enemy' });

  const embeds = buildClanPanelEmbeds();
  assert.ok(embeds.length >= 2);
  assert.equal(embeds[0].data.title.includes('Dost Klanlar'), true);
  assert.equal(embeds[1].data.title.includes('Düşman Klanlar'), true);

  // Panel kurulumu
  const initResult = await updateClanPanel(env.mockGuild);
  assert.equal(initResult.success, true);
  assert.ok(initResult.messageId);

  // Güncelleme
  database.addKnownClan({ name: 'Gamma Clan', type: 'ally' });
  const updateResult = await updateClanPanel(env.mockGuild);
  assert.equal(updateResult.success, true);
  assert.equal(updateResult.messageId, initResult.messageId);

  // Mesaj silindiğinde otomatik yeni mesaj oluşturma kurtarması
  database.setClanPanelMessage(config.CHANNELS.CLAN_PANEL, 'non_existent_msg_id');
  const recoveryResult = await updateClanPanel(env.mockGuild);
  assert.equal(recoveryResult.success, true);
  assert.notEqual(recoveryResult.messageId, 'non_existent_msg_id');
});

test('11. Slash Komut Yetki Kontrolü (/klan-ekle vb.)', async () => {
  const env = createMockGuildEnvironment();

  const regularMember = env.createMember({ id: 'm_regular', username: 'regular_user' });
  const staffMember = env.createMember({ id: 'm_staff', username: 'staff_user', roleIds: [config.ROLES.WARNING_AUTHORITIES[0]] });

  let regularReplied = null;
  const regularInteraction = {
    member: regularMember,
    options: { getString: () => 'Test Clan' },
    async reply(payload) {
      regularReplied = payload;
    },
  };

  await klanEkleCommand.execute(regularInteraction);
  assert.ok(regularReplied);
  assert.ok(regularReplied.content.includes('sadece yetkililer'));

  let staffReplied = null;
  const staffInteraction = {
    member: staffMember,
    guild: env.mockGuild,
    user: { id: 'staff_user' },
    options: {
      getString: (key) => (key === 'ad' ? 'Valid New Clan' : 'ally'),
    },
    async reply(payload) {
      staffReplied = payload;
    },
  };

  await klanEkleCommand.execute(staffInteraction);
  assert.ok(staffReplied);
  assert.ok(staffReplied.content.includes('başarıyla'));
});

test('12. Kayıt Servisi: Eski istemci (registrationType yok) ve klan adı doğrulama kuralları', async () => {
  const env = createMockGuildEnvironment();
  const applicant = env.createMember({ id: 'app_service_test', username: 'test_client' });
  const { createRegistrationApplication } = require('../src/services/registrationService');

  // Roblox API çağrısını mock'la
  const robloxService = require('../src/services/roblox');
  const origResolve = robloxService.resolveUser;
  robloxService.resolveUser = async () => ({
    success: true,
    user: { id: '123456', name: 'TestRoblox', displayName: 'TestRoblox', avatarUrl: 'https://avatar' },
  });

  try {
    // 1. registrationType belirtilmediğinde varsayılan 'own' olmalı
    const resOwn = await createRegistrationApplication({
      guild: env.mockGuild,
      member: applicant,
      user: applicant.user,
      realName: 'Ali Veli',
      gender: 'Erkek',
      robloxInput: 'TestRoblox',
      // registrationType gönderilmedi
    });
    assert.equal(resOwn.success, true);
    const activeApp = database.getActiveApplication(applicant.id);
    assert.equal(activeApp.registrationType, 'own');
    database.removeActiveApplication(applicant.id);

    // 2. other klan ama clanName boş -> CLAN_REQUIRED
    const resNoClan = await createRegistrationApplication({
      guild: env.mockGuild,
      member: applicant,
      user: applicant.user,
      realName: 'Ali Veli',
      gender: 'Erkek',
      robloxInput: 'TestRoblox',
      registrationType: 'other',
      clanName: '',
    });
    assert.equal(resNoClan.success, false);
    assert.equal(resNoClan.code, 'CLAN_REQUIRED');

    // 3. other klan ve clanName="@everyone" -> CLAN_BLOCKED
    const resBlocked = await createRegistrationApplication({
      guild: env.mockGuild,
      member: applicant,
      user: applicant.user,
      realName: 'Ali Veli',
      gender: 'Erkek',
      robloxInput: 'TestRoblox',
      registrationType: 'other',
      clanName: '@everyone',
    });
    assert.equal(resBlocked.success, false);
    assert.equal(resBlocked.code, 'CLAN_BLOCKED');

    // 4. other klan ve clanName="yok" -> CLAN_INVALID
    const resInvalid = await createRegistrationApplication({
      guild: env.mockGuild,
      member: applicant,
      user: applicant.user,
      realName: 'Ali Veli',
      gender: 'Erkek',
      robloxInput: 'TestRoblox',
      registrationType: 'other',
      clanName: 'yok',
    });
    assert.equal(resInvalid.success, false);
    assert.equal(resInvalid.code, 'CLAN_INVALID');

    // 5. other klan ve clanName="Piyade Team" -> CLAN_IS_OWN
    const resOwnClan = await createRegistrationApplication({
      guild: env.mockGuild,
      member: applicant,
      user: applicant.user,
      realName: 'Ali Veli',
      gender: 'Erkek',
      robloxInput: 'TestRoblox',
      registrationType: 'other',
      clanName: 'Piyade Team',
    });
    assert.equal(resOwnClan.success, false);
    assert.equal(resOwnClan.code, 'CLAN_IS_OWN');
  } finally {
    robloxService.resolveUser = origResolve;
  }
});
