const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');

// Testler için izole geçici veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-kayit-sifirla-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-sifirla-secret-123';
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const database = require('../src/utils/database');
const kayitSifirlaCommand = require('../src/commands/kayitSifirla');

test.before(() => {
  database.init();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

function createMockInteractionEnvironment() {
  const guildRoles = new Collection([
    [config.ROLES.COMMUNITY_OFFICIAL, { id: config.ROLES.COMMUNITY_OFFICIAL, name: '| Community Official', position: 60, managed: false }],
    [config.ROLES.DEVELOPER, { id: config.ROLES.DEVELOPER, name: 'Developer', position: 50, managed: false }],
    [config.ROLES.FOUNDER, { id: config.ROLES.FOUNDER, name: 'FOUNDER', position: 45, managed: false }],
    [config.ROLES.STAFF_GENERAL, { id: config.ROLES.STAFF_GENERAL, name: 'Yetkili', position: 35, managed: false }],
    [config.ROLES.STAFF, { id: config.ROLES.STAFF, name: 'Kayıt Yetkilisi', position: 30, managed: false }],
    [config.ROLES.REGISTERED_CHECK, { id: config.ROLES.REGISTERED_CHECK, name: 'Kayıtlı Üye', position: 15, managed: false }],
    [config.ROLES.OTHER_CLAN, { id: config.ROLES.OTHER_CLAN, name: 'Other Clan', position: 20, managed: false }],
    [config.ROLES.UNREGISTERED, { id: config.ROLES.UNREGISTERED, name: 'Kayıtsız', position: 5, managed: false }],
    ['role_clan_99', { id: 'role_clan_99', name: 'Dark Wolves', position: 18, managed: false }],
    ['role_managed', { id: 'role_managed', name: 'Server Booster', position: 25, managed: true }],
  ]);

  function makeMember({ id, username, roleIds = [], position = 10, nickname = null, isAdmin = false }) {
    const roleMap = new Collection();
    for (const rid of roleIds) {
      if (guildRoles.has(rid)) {
        roleMap.set(rid, guildRoles.get(rid));
      }
    }

    const member = {
      id,
      displayName: nickname || username,
      nickname,
      user: { id, username, tag: `${username}#0001`, bot: false },
      roles: {
        cache: roleMap,
        highest: { position },
        remove: async (toRemove) => {
          const ids = Array.isArray(toRemove) ? toRemove : [toRemove];
          ids.forEach((rid) => roleMap.delete(rid));
        },
        add: async (toAdd) => {
          const rObj = guildRoles.get(toAdd) || { id: toAdd, name: 'Added', position: 5, managed: false };
          roleMap.set(toAdd, rObj);
        },
      },
      permissions: {
        has: (perm) => (perm === PermissionFlagsBits.Administrator ? isAdmin : false),
      },
      manageable: true,
      setNickname: async (newNick) => {
        member.nickname = newNick;
        member.displayName = newNick || member.user.username;
      },
    };
    return member;
  }

  // Yetkili roller: yalnızca DEVELOPER (1561777507223601353) ve COMMUNITY_OFFICIAL (1570767625188016259)
  const devMember = makeMember({
    id: 'dev_1',
    username: 'dev_user',
    roleIds: [config.ROLES.DEVELOPER],
    position: 50,
  });

  const communityOfficialMember = makeMember({
    id: 'official_1',
    username: 'official_user',
    roleIds: [config.ROLES.COMMUNITY_OFFICIAL],
    position: 30,
  });

  const staffMember = makeMember({
    id: 'staff_1',
    username: 'staff_user',
    roleIds: [config.ROLES.STAFF],
    position: 30,
  });

  const founderAdminOwnerMember = makeMember({
    id: 'owner_999',
    username: 'founder_owner',
    roleIds: [config.ROLES.FOUNDER, config.ROLES.STAFF_GENERAL],
    position: 45,
    isAdmin: true,
  });

  const targetMember = makeMember({
    id: 'target_1',
    username: 'member_user',
    roleIds: [config.ROLES.REGISTERED_CHECK, 'role_clan_99', 'role_managed'],
    position: 18,
    nickname: 'Ahmet | roblox_ahmet',
  });

  const unauthorizedMember = makeMember({
    id: 'normal_1',
    username: 'normal_user',
    roleIds: [],
    position: 2,
  });

  const membersCollection = new Collection([
    [devMember.id, devMember],
    [communityOfficialMember.id, communityOfficialMember],
    [staffMember.id, staffMember],
    [founderAdminOwnerMember.id, founderAdminOwnerMember],
    [targetMember.id, targetMember],
    [unauthorizedMember.id, unauthorizedMember],
  ]);

  const mockBotMember = {
    id: 'bot_id_123',
    roles: { highest: { position: 40 } },
  };

  const mockGuild = {
    id: config.GUILD_ID,
    ownerId: 'owner_999',
    roles: { cache: guildRoles },
    members: {
      cache: membersCollection,
      me: mockBotMember,
      fetch: async (id) => membersCollection.get(String(id)) || null,
      fetchMe: async () => mockBotMember,
    },
    channels: {
      fetch: async () => null,
    },
  };

  return {
    devMember,
    communityOfficialMember,
    staffMember,
    founderAdminOwnerMember,
    targetMember,
    unauthorizedMember,
    mockGuild,
    membersCollection,
  };
}

test('1. database.removeRegistration metodu kaydı, Roblox hesabını ve aktif/red başvuruları bellekten silmeli', () => {
  database.data.registrations = [];
  database.addRegistration({
    discordId: 'user_delete_1',
    realName: 'Ali Yılmaz',
    robloxUsername: 'ali_roblox',
    robloxId: '998877',
    gender: 'Erkek',
    registrationType: 'other',
    clanName: 'Wolves',
  });

  database.setActiveApplication('user_delete_1', {
    userId: 'user_delete_1',
    threadId: 'th_1',
  });

  database.data.rejectedApplications = database.data.rejectedApplications || {};
  database.data.rejectedApplications['user_delete_1'] = {
    userId: 'user_delete_1',
    reason: 'Hatalı nick',
  };

  assert.ok(database.getRegistrationByDiscordId('user_delete_1'));
  assert.ok(database.getActiveApplication('user_delete_1'));

  const result = database.removeRegistration('user_delete_1');
  assert.equal(result.success, true);
  assert.equal(result.removedRecord.robloxUsername, 'ali_roblox');
  assert.equal(result.removedRecord.robloxId, '998877');

  // Tekrar sorgulandığında tamamen silinmiş olmalı
  assert.equal(database.getRegistrationByDiscordId('user_delete_1'), undefined);
  assert.equal(database.getActiveApplication('user_delete_1'), null);
  assert.equal(database.getRejectedApplication('user_delete_1'), null);

  // Olmayan kullanıcıyı silmeye çalıştığında
  const resultNonExist = database.removeRegistration('user_not_exist');
  assert.equal(resultNonExist.success, false);
  assert.equal(resultNonExist.removedRecord, null);
});

test('2. /kayit-sifirla: Yalnızca 1561777507223601353 (Developer) ve 1570767625188016259 (Community Official) rolleri kullanabilmeli', async () => {
  const env = createMockInteractionEnvironment();

  assert.deepEqual(kayitSifirlaCommand.ALLOWED_ROLE_IDS, [
    '1561777507223601353',
    '1570767625188016259',
  ]);
  assert.equal(kayitSifirlaCommand.hasKayitSifirlaAuthority(env.devMember), true);
  assert.equal(kayitSifirlaCommand.hasKayitSifirlaAuthority(env.communityOfficialMember), true);
  assert.equal(kayitSifirlaCommand.hasKayitSifirlaAuthority(env.unauthorizedMember), false);
  assert.equal(kayitSifirlaCommand.hasKayitSifirlaAuthority(env.staffMember), false);
  assert.equal(kayitSifirlaCommand.hasKayitSifirlaAuthority(env.founderAdminOwnerMember), false);

  // Normal üye, Kayıt Yetkilisi ve hatta izinli rolü olmayan Kurucu/Yönetici bile engellenmeli
  for (const deniedMember of [env.unauthorizedMember, env.staffMember, env.founderAdminOwnerMember]) {
    let replyPayload = null;
    const mockInteraction = {
      guild: env.mockGuild,
      member: deniedMember,
      user: deniedMember.user,
      client: { user: { id: 'bot_id_123' } },
      options: {
        getUser: () => env.targetMember.user,
      },
      reply: async (payload) => {
        replyPayload = payload;
        return payload;
      },
    };

    await kayitSifirlaCommand.execute(mockInteraction);
    assert.ok(replyPayload);
    assert.equal(replyPayload.flags, MessageFlags.Ephemeral);
    assert.match(replyPayload.content, /1561777507223601353/);
    assert.match(replyPayload.content, /1570767625188016259/);
  }
});

test('3. /kayit-sifirla: Botun kendisinin veya bot hesaplarının sıfırlanması engellenmeli', async () => {
  const env = createMockInteractionEnvironment();
  let replyPayload = null;

  // Botun kendisini sıfırlamaya çalışmak
  const mockInteractionBotSelf = {
    guild: env.mockGuild,
    member: env.devMember,
    user: env.devMember.user,
    client: { user: { id: 'bot_id_123' } },
    options: {
      getUser: () => ({ id: 'bot_id_123', bot: true }),
    },
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await kayitSifirlaCommand.execute(mockInteractionBotSelf);
  assert.match(replyPayload.content, /Botun kaydını sıfırlayamazsınız/);

  // Başka bir botu sıfırlamaya çalışmak
  const mockInteractionOtherBot = {
    guild: env.mockGuild,
    member: env.communityOfficialMember,
    user: env.communityOfficialMember.user,
    client: { user: { id: 'bot_id_123' } },
    options: {
      getUser: () => ({ id: 'other_bot_999', bot: true }),
    },
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await kayitSifirlaCommand.execute(mockInteractionOtherBot);
  assert.match(replyPayload.content, /Bot hesaplarının kayıt bilgisi bulunmaz/);
});

test('4. /kayit-sifirla: Kendisinden üst kademedeki birinin kaydını sıfırlamaya çalışmak engellenmeli', async () => {
  const env = createMockInteractionEnvironment();
  let replyPayload = null;

  // Hedef yetkili (Position 50), uygulayan Community Official (testte Position 30)
  const highStaff = {
    id: 'high_staff_1',
    user: { id: 'high_staff_1', username: 'high_staff', bot: false },
    roles: { highest: { position: 50 }, cache: new Collection() },
  };
  env.membersCollection.set(highStaff.id, highStaff);

  const mockInteraction = {
    guild: env.mockGuild,
    member: env.communityOfficialMember,
    user: env.communityOfficialMember.user,
    client: { user: { id: 'bot_id_123' } },
    options: {
      getUser: () => highStaff.user,
    },
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await kayitSifirlaCommand.execute(mockInteraction);
  assert.match(replyPayload.content, /Kendinizle aynı veya sizden daha üst kademedeki bir yetkilinin kaydını sıfırlayamazsınız/);
});

test('5. /kayit-sifirla (Başarılı Akış): Community Official ve Developer ile kayıt/roller sıfırlanıp Kayıtsız rolü verilmeli', async () => {
  const env = createMockInteractionEnvironment();

  // Veritabanına hedef üyenin kaydını ekle
  database.addRegistration({
    discordId: env.targetMember.id,
    realName: 'Ahmet Yılmaz',
    robloxUsername: 'ahmet_roblox_123',
    robloxId: '556677',
    gender: 'Erkek',
    registrationType: 'other',
    clanName: 'Dark Wolves',
  });

  assert.ok(database.getRegistrationByDiscordId(env.targetMember.id));
  assert.ok(env.targetMember.roles.cache.has(config.ROLES.REGISTERED_CHECK));
  assert.ok(env.targetMember.roles.cache.has('role_clan_99'));
  assert.equal(env.targetMember.nickname, 'Ahmet | roblox_ahmet');

  let replyPayload = null;
  const mockInteraction = {
    guild: env.mockGuild,
    member: env.communityOfficialMember,
    user: env.communityOfficialMember.user,
    client: { user: { id: 'bot_id_123' } },
    options: {
      getUser: () => env.targetMember.user,
    },
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await kayitSifirlaCommand.execute(mockInteraction);

  // 1. Veritabanı kontrolü: Kayıt ve Roblox hesabı silinmiş olmalı
  assert.equal(database.getRegistrationByDiscordId(env.targetMember.id), undefined);

  // 2. Rol kontrolü: Eski kayıtlı roller gitmiş, sadece Kayıtsız (ve managed rol) kalmış olmalı
  assert.equal(env.targetMember.roles.cache.has(config.ROLES.REGISTERED_CHECK), false, 'Kayıtlı üye rolü alınmış olmalı');
  assert.equal(env.targetMember.roles.cache.has('role_clan_99'), false, 'Klan rolü alınmış olmalı');
  assert.equal(env.targetMember.roles.cache.has(config.ROLES.UNREGISTERED), true, 'Kayıtsız rolü verilmiş olmalı');

  // 3. Takma ad temizlenmiş olmalı
  assert.equal(env.targetMember.nickname, null, 'Nickname null olarak sıfırlanmış olmalı');

  // 4. Gönderilen Embed kontrolü
  assert.ok(replyPayload.embeds && replyPayload.embeds.length === 1);
  const embed = replyPayload.embeds[0];
  const fields = embed.data.fields;

  // Silinen Roblox hesabı gösterilmeli
  const robloxField = fields.find((f) => f.name.includes('Roblox'));
  assert.ok(robloxField);
  assert.match(robloxField.value, /ahmet_roblox_123/);

  // Verilen Kayıtsız rolü gösterilmeli
  const addedField = fields.find((f) => f.name.includes('Verilen Rol'));
  assert.ok(addedField);
  assert.match(addedField.value, new RegExp(config.ROLES.UNREGISTERED));
});
