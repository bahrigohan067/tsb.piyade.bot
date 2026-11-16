const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// İzole test veritabanı dizini
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-multigame-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const gamesConfig = require('../games.config');
const database = require('../src/utils/database');
const robloxService = require('../src/services/roblox');
const {
  buildGameAndGenderSelectionPayload,
  buildRegistrationModal,
} = require('../src/utils/panel');
const { createRegistrationApplication } = require('../src/services/registrationService');
const interactionHandler = require('../src/events/interactionCreate');
const profilimCommand = require('../src/commands/profilim');
const kayitBilgiCommand = require('../src/commands/kayitBilgi');

let origResolveUser;

test.before(() => {
  origResolveUser = robloxService.resolveUser;
  database.init();
});

test.after(() => {
  if (origResolveUser) {
    robloxService.resolveUser = origResolveUser;
  }
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

function createMockGuildEnvironment() {
  const rolesCache = new Collection([
    [config.ROLES.VERIFIED, { id: config.ROLES.VERIFIED, name: '| Hesabı Onaylı', position: 15, managed: false }],
    [config.ROLES.REGISTERED_CHECK, { id: config.ROLES.REGISTERED_CHECK, name: '♾️| Cengaver', position: 16, managed: false }],
    [config.ROLES.UNREGISTERED, { id: config.ROLES.UNREGISTERED, name: '| Kayıtsız', position: 5, managed: false }],
    [config.ROLES.MALE, { id: config.ROLES.MALE, name: '| Erkek', position: 17, managed: false }],
    [config.ROLES.FEMALE, { id: config.ROLES.FEMALE, name: '| Kız', position: 18, managed: false }],
    [config.ROLES.STAFF, { id: config.ROLES.STAFF, name: '| Başvuru Yetkilisi', position: 30, managed: false }],
    [config.ROLES.DEVELOPER, { id: config.ROLES.DEVELOPER, name: '💻| DEVELOPER', position: 50, managed: false }],
    [config.ROLES.ENGLISH, { id: config.ROLES.ENGLISH, name: '🇬🇧 English', position: 4, managed: false }],
    ['1571915640976056390', { id: '1571915640976056390', name: '| Roblox', position: 10, managed: false }],
    ['1571915745884115005', { id: '1571915745884115005', name: '| Zula', position: 10, managed: false }],
    ['1571915841832886382', { id: '1571915841832886382', name: '| Minecraft', position: 10, managed: false }],
    ['1571915951946076323', { id: '1571915951946076323', name: 'CS2 (Counter Strike 2)', position: 10, managed: false }],
  ]);

  const membersCache = new Collection();
  const sentDMs = [];
  const createdThreads = [];
  const staffMessages = [];

  function makeMember({ id, username, roleIds = [], bot = false }) {
    const memberRoles = new Collection();
    for (const rId of roleIds) {
      if (rolesCache.has(rId)) memberRoles.set(rId, rolesCache.get(rId));
    }
    const member = {
      id,
      displayName: username,
      nickname: null,
      joinedTimestamp: Date.now() - 86400000,
      user: {
        id,
        username,
        tag: `${username}#0001`,
        bot,
        createdTimestamp: Date.now() - 31536000000,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/avatar.png`,
        send: async (msg) => {
          sentDMs.push({ userId: id, msg });
          return { id: `dm_${id}` };
        },
      },
      roles: {
        cache: memberRoles,
        highest: { position: 30 },
        add: async (roleId) => {
          const rObj = rolesCache.get(roleId) || { id: roleId, name: 'Role', position: 10, managed: false };
          memberRoles.set(roleId, rObj);
        },
        remove: async (roleId) => {
          memberRoles.delete(roleId);
        },
      },
      permissions: {
        has: () => false,
      },
      setNickname: async (nick) => {
        member.nickname = nick;
        member.displayName = nick || username;
      },
    };
    membersCache.set(id, member);
    return member;
  }

  const registerChannel = {
    id: config.CHANNELS.REGISTER,
    threads: {
      create: async (opts) => {
        const threadObj = {
          id: `thread_${createdThreads.length + 1}`,
          name: opts.name,
          url: `https://discord.com/channels/1559313292651008040/thread_${createdThreads.length + 1}`,
          deleted: false,
          members: { add: async () => {} },
          send: async () => ({ id: 'thread_msg' }),
          delete: async () => {
            threadObj.deleted = true;
          },
          setName: async () => {},
        };
        createdThreads.push(threadObj);
        channelsCache.set(threadObj.id, threadObj);
        return threadObj;
      },
    },
  };

  const staffChannel = {
    id: config.CHANNELS.STAFF_APPROVAL,
    send: async (payload) => {
      const msgObj = {
        id: `staff_msg_${staffMessages.length + 1}`,
        embeds: payload.embeds || [],
        components: payload.components || [],
        content: payload.content || '',
        edit: async (patch) => {
          if (patch.embeds) msgObj.embeds = patch.embeds;
          if (patch.components) msgObj.components = patch.components;
          return msgObj;
        },
      };
      staffMessages.push(msgObj);
      return msgObj;
    },
  };

  const channelsCache = new Collection([
    [config.CHANNELS.REGISTER, registerChannel],
    [config.CHANNELS.STAFF_APPROVAL, staffChannel],
  ]);

  const mockGuild = {
    id: config.GUILD_ID,
    ownerId: 'owner_1',
    iconURL: () => 'https://cdn.discordapp.com/icons/mock/icon.png',
    roles: {
      cache: rolesCache,
      fetch: async () => rolesCache,
    },
    members: {
      cache: membersCache,
      fetch: async (id) => membersCache.get(String(id)) || null,
    },
    channels: {
      cache: channelsCache,
      fetch: async (id) => channelsCache.get(String(id)) || null,
    },
  };

  return {
    mockGuild,
    makeMember,
    sentDMs,
    createdThreads,
    staffMessages,
    rolesCache,
  };
}

test('1. games.config: Rol ID eşleşmeleri ve durum kodlama/çözümleme tutarlı olmalı', () => {
  assert.equal(gamesConfig.getGameById('roblox').roleId, '1571915640976056390');
  assert.equal(gamesConfig.getGameById('zula').roleId, '1571915745884115005');
  assert.equal(gamesConfig.getGameById('minecraft').roleId, '1571915841832886382');
  assert.equal(gamesConfig.getGameById('cs2').roleId, '1571915951946076323');

  // Sıradan bağımsız kanonik kodlama (cs2 + roblox -> rc)
  const encoded = gamesConfig.encodeRegState({
    games: ['minecraft', 'cs2', 'roblox'],
    gender: 'm',
    lang: 'tr',
  });
  assert.equal(encoded, 'rcm:m:tr');

  const decoded = gamesConfig.decodeRegState(encoded);
  assert.deepEqual(decoded.games, ['roblox', 'cs2', 'minecraft']);
  assert.equal(decoded.gender, 'm');
  assert.equal(decoded.lang, 'tr');

  // Boş durum
  assert.equal(gamesConfig.encodeRegState({}), '0:u:tr');
  assert.deepEqual(gamesConfig.decodeRegState('0:u:en'), {
    games: [],
    gender: 'u',
    lang: 'en',
  });
});

test('2. Etkileşimli Oyun & Cinsiyet Seçimi: Birden fazla oyun seçilebilir, her oyun butonuna 1 kere basılır', async () => {
  const env = createMockGuildEnvironment();
  const applicant = env.makeMember({
    id: 'user_sel_1',
    username: 'secici',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  // Başlangıç ekranı
  const initial = buildGameAndGenderSelectionPayload({ games: [], gender: 'u', lang: 'tr' });
  const row1Initial = initial.components[0].components;
  assert.equal(row1Initial.length, 5); // 4 oyun + Sıfırla
  assert.equal(row1Initial[0].data.disabled, false); // Roblox tıklanabilir
  assert.equal(row1Initial[4].data.disabled, true); // Sıfırla başlangıçta kapalı

  // Roblox'a bas
  let updatedPayload = null;
  await interactionHandler.handleRegistrationSelectionAction({
    customId: 'reg_act:0:u:tr:g_roblox',
    member: applicant,
    update: async (p) => {
      updatedPayload = p;
      return p;
    },
  });

  assert.ok(updatedPayload);
  const afterRobloxRow1 = updatedPayload.components[0].components;
  // Roblox butonu yeşil (Success) ve disabled olmalı (1 butona 1 kere basılabilir)
  assert.equal(afterRobloxRow1[0].data.style, ButtonStyle.Success);
  assert.equal(afterRobloxRow1[0].data.disabled, true);
  // CS2 hala açık (birden fazla butona basabilir)
  assert.equal(afterRobloxRow1[1].data.style, ButtonStyle.Secondary);
  assert.equal(afterRobloxRow1[1].data.disabled, false);
  // Sıfırla artık aktif
  assert.equal(afterRobloxRow1[4].data.disabled, false);

  // CS2 butonuna da bas (customId'den gelen yeni state ile)
  let afterCs2Payload = null;
  await interactionHandler.handleRegistrationSelectionAction({
    customId: afterRobloxRow1[1].data.custom_id,
    member: applicant,
    update: async (p) => {
      afterCs2Payload = p;
      return p;
    },
  });

  const afterCs2Row1 = afterCs2Payload.components[0].components;
  assert.equal(afterCs2Row1[0].data.disabled, true); // Roblox kilitli
  assert.equal(afterCs2Row1[1].data.disabled, true); // CS2 kilitli
  assert.equal(afterCs2Row1[2].data.disabled, false); // Zula açık

  // Oyun seçilmeden Formu Aç'a basınca uyarı vermeli
  let warningReply = null;
  await interactionHandler.handleRegistrationSelectionAction({
    customId: 'reg_act:0:m:tr:open',
    member: applicant,
    reply: async (p) => {
      warningReply = p;
    },
  });
  assert.match(warningReply.content, /en az 1 tanesini/);

  // Cinsiyet seçilmeden Formu Aç'a basınca uyarı vermeli
  let genderWarningReply = null;
  await interactionHandler.handleRegistrationSelectionAction({
    customId: 'reg_act:rc:u:tr:open',
    member: applicant,
    reply: async (p) => {
      genderWarningReply = p;
    },
  });
  assert.match(genderWarningReply.content, /Cinsiyetinizi/);

  // Hem oyun hem cinsiyet seçiliyken Formu Aç'a basınca Modal açılmalı
  let shownModal = null;
  await interactionHandler.handleRegistrationSelectionAction({
    customId: 'reg_act:rc:f:tr:open',
    member: applicant,
    showModal: async (m) => {
      shownModal = m;
    },
  });
  assert.ok(shownModal);
  assert.equal(shownModal.data.custom_id, 'modal_kayit:rc:f:tr');
  assert.equal(shownModal.components.length, 3); // Ad + Roblox + CS2
});

test('3. Dinamik Kayıt Anketi (Modal): Discord sınırlarına (<=45 char label, <=5 alan) uymalı', () => {
  const allGamesModal = buildRegistrationModal({
    games: ['roblox', 'cs2', 'zula', 'minecraft'],
    gender: 'm',
    lang: 'tr',
  });

  assert.equal(allGamesModal.components.length, 5, '4 oyun + 1 isim = tam olarak 5 alan (Discord üst sınırı)');
  assert.ok(allGamesModal.data.title.length <= 45);

  const labels = allGamesModal.components.map((row) => row.components[0].data.label);
  const placeholders = allGamesModal.components.map((row) => row.components[0].data.placeholder);
  const customIds = allGamesModal.components.map((row) => row.components[0].data.custom_id);

  assert.deepEqual(customIds, [
    'modal_real_name',
    'modal_game_roblox',
    'modal_game_cs2',
    'modal_game_zula',
    'modal_game_minecraft',
  ]);
  assert.equal(labels[0], 'Adını öğrenebilir miyiz?');
  assert.equal(placeholders[0], 'İsmini yazmak istemiyorsan takma ad koyabilirsin.');

  for (const lbl of labels) {
    assert.ok(lbl.length <= 45, `Label 45 karakterden uzun olmamalı: "${lbl}"`);
  }
  for (const ph of placeholders) {
    assert.ok(ph.length <= 100, `Placeholder 100 karakterden uzun olmamalı: "${ph}"`);
  }
});

test('4. İstisna: Roblox oynayan kişi geçersiz hesap girerse anket otomatik reddedilmeli ve DM atılmalı', async () => {
  const env = createMockGuildEnvironment();
  const member = env.makeMember({
    id: 'user_bad_rbx',
    username: 'bad_rbx_user',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  robloxService.resolveUser = async () => ({
    success: false,
    error: 'NOT_FOUND',
    message: 'Hesap bulunamadı.',
  });

  const result = await createRegistrationApplication({
    guild: env.mockGuild,
    member,
    user: member.user,
    realName: 'Mehmet',
    gender: 'Erkek',
    games: ['roblox', 'cs2'],
    gameUsernames: { roblox: 'OlmayanBirHesap_999999', cs2: 'MehmetCS' },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'ROBLOX_NOT_FOUND');
  assert.equal(env.createdThreads.length, 0, 'Oda açılmamış olmalı');
  assert.equal(env.staffMessages.length, 0, 'Yetkili kartı atılmamış olmalı');
  assert.equal(env.sentDMs.length, 1, 'Kullanıcıya red DM mesajı atılmış olmalı');
  assert.match(env.sentDMs[0].msg, /Reddedildi/i);
});

test('5. Sadece CS2 + Zula + Minecraft (Roblox OLMADAN) kayıt: Roblox API çağrılmaz, roller ve nick doğru verilir', async () => {
  const env = createMockGuildEnvironment();
  database.data.registrations = [];
  database.data.activeApplications = {};

  let robloxApiCalled = false;
  robloxService.resolveUser = async () => {
    robloxApiCalled = true;
    return { success: false, error: 'NOT_FOUND' };
  };

  const member = env.makeMember({
    id: 'user_non_rbx',
    username: 'cs_zula_mc',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  const staffActor = env.makeMember({
    id: 'staff_approver_1',
    username: 'approver_staff',
    roleIds: [config.ROLES.STAFF],
  });

  // 1. Başvuru oluştur
  const appResult = await createRegistrationApplication({
    guild: env.mockGuild,
    member,
    user: member.user,
    realName: 'Ege',
    gender: 'Erkek',
    games: ['cs2', 'zula', 'minecraft'],
    gameUsernames: {
      cs2: 'EgeCS2_Pro',
      zula: 'EgeZulaTR',
      minecraft: 'EgeCraft99',
    },
  });

  assert.equal(robloxApiCalled, false, 'Roblox seçilmediği için Roblox API kesinlikle çağrılmamalı');
  assert.equal(appResult.success, true);
  assert.equal(env.createdThreads.length, 1);
  assert.equal(env.staffMessages.length, 1);

  // Yetkili kartında tüm oyun kullanıcı adları görünmeli
  const staffCardFields = env.staffMessages[0].embeds[0].data.fields;
  const fieldValuesText = staffCardFields.map((f) => `${f.name}: ${f.value}`).join('\n');
  assert.match(fieldValuesText, /EgeCS2_Pro/);
  assert.match(fieldValuesText, /EgeZulaTR/);
  assert.match(fieldValuesText, /EgeCraft99/);
  assert.doesNotMatch(fieldValuesText, /Roblox ID/);

  // 2. Yetkili Onaylasın
  let approveReply = null;
  await interactionHandler.handleApprove(
    {
      guild: env.mockGuild,
      member: staffActor,
      user: staffActor.user,
      message: env.staffMessages[0],
      deferReply: async () => {},
      editReply: async (p) => {
        approveReply = p;
      },
    },
    member.id
  );

  assert.ok(approveReply);
  assert.match(approveReply.content, /başarıyla onaylandı/);

  // Roller: Hesabı Onaylı, Cengaver, Erkek, CS2, Zula, Minecraft verilmeli; Roblox ve Kayıtsız olmamalı!
  assert.equal(member.roles.cache.has(config.ROLES.VERIFIED), true, '| Hesabı Onaylı verilmeli');
  assert.equal(member.roles.cache.has(config.ROLES.REGISTERED_CHECK), true, '♾️| Cengaver verilmeli');
  assert.equal(member.roles.cache.has(config.ROLES.MALE), true, '| Erkek verilmeli');
  assert.equal(member.roles.cache.has('1571915951946076323'), true, 'CS2 rolü verilmeli');
  assert.equal(member.roles.cache.has('1571915745884115005'), true, 'Zula rolü verilmeli');
  assert.equal(member.roles.cache.has('1571915841832886382'), true, 'Minecraft rolü verilmeli');
  assert.equal(member.roles.cache.has('1571915640976056390'), false, 'Roblox rolü verilmemeli');
  assert.equal(member.roles.cache.has(config.ROLES.UNREGISTERED), false, 'Kayıtsız rolü alınmalı');

  // Nickname sonu boş "|" olmadan temiz olmalı
  assert.equal(member.nickname, 'Ege');

  // Veritabanında kayıtlı tüm oyun bilgileri bulunmalı
  const savedReg = database.getRegistrationByDiscordId(member.id);
  assert.deepEqual(savedReg.games, ['cs2', 'zula', 'minecraft']);
  assert.equal(savedReg.gameUsernames.cs2, 'EgeCS2_Pro');
  assert.equal(savedReg.gameUsernames.zula, 'EgeZulaTR');
  assert.equal(savedReg.gameUsernames.minecraft, 'EgeCraft99');
});

test('6. Roblox + CS2 geçerli kayıt: Roblox profil linki ve detayları yetkililere iletilmeli ve roller verilmeli', async () => {
  const env = createMockGuildEnvironment();
  database.data.registrations = [];
  database.data.activeApplications = {};

  robloxService.resolveUser = async (input) => ({
    success: true,
    user: {
      id: '7771234',
      name: 'AysePlays',
      displayName: 'AyseOfficial',
      description: 'Merhaba, ben Ayşe!',
      hasVerifiedBadge: false,
      profileUrl: 'https://www.roblox.com/users/7771234/profile',
      avatarUrl: 'https://tr.rbxcdn.com/mock-avatar.png',
      createdAt: '2020-05-01T10:00:00Z',
    },
  });

  const member = env.makeMember({
    id: 'user_with_rbx',
    username: 'ayse_gamer',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  const staffActor = env.makeMember({
    id: 'staff_approver_2',
    username: 'approver_staff_2',
    roleIds: [config.ROLES.STAFF],
  });

  const appResult = await createRegistrationApplication({
    guild: env.mockGuild,
    member,
    user: member.user,
    realName: 'Ayşe',
    gender: 'Kız',
    games: ['roblox', 'cs2'],
    gameUsernames: { roblox: 'AysePlays', cs2: 'Ayse_CS' },
  });

  assert.equal(appResult.success, true);
  assert.equal(appResult.robloxUser.id, '7771234');

  // Yetkili kartında Roblox linki, ID ve detayları ile CS2 nicki olmalı
  const embed = env.staffMessages[0].embeds[0].data;
  const fieldStr = embed.fields.map((f) => `${f.name}: ${f.value}`).join('\n');
  assert.equal(embed.thumbnail.url, 'https://tr.rbxcdn.com/mock-avatar.png');
  assert.match(fieldStr, /https:\/\/www\.roblox\.com\/users\/7771234\/profile/);
  assert.match(fieldStr, /7771234/);
  assert.match(fieldStr, /Ayse_CS/);
  assert.match(fieldStr, /Roblox Hesap Açılışı/);

  // Onaylama
  await interactionHandler.handleApprove(
    {
      guild: env.mockGuild,
      member: staffActor,
      user: staffActor.user,
      message: env.staffMessages[0],
      deferReply: async () => {},
      editReply: async () => {},
    },
    member.id
  );

  assert.equal(member.roles.cache.has(config.ROLES.VERIFIED), true);
  assert.equal(member.roles.cache.has(config.ROLES.REGISTERED_CHECK), true);
  assert.equal(member.roles.cache.has(config.ROLES.FEMALE), true);
  assert.equal(member.roles.cache.has('1571915640976056390'), true, 'Roblox rolü verilmeli');
  assert.equal(member.roles.cache.has('1571915951946076323'), true, 'CS2 rolü verilmeli');
  assert.equal(member.nickname, 'Ayşe | AysePlays');
});

test('7. /profilim komutu: Herkese açık (ephemeral: false), düzenli ve bol emojili yanıt vermeli', async () => {
  const env = createMockGuildEnvironment();
  database.data.registrations = [];

  const registeredUser = env.makeMember({
    id: 'user_profile_1',
    username: 'pro_oyuncu',
    roleIds: [
      config.ROLES.VERIFIED,
      config.ROLES.REGISTERED_CHECK,
      '1571915640976056390',
      '1571915951946076323',
      '1571915745884115005',
      '1571915841832886382',
    ],
  });

  database.addRegistration({
    discordId: registeredUser.id,
    realName: 'Emre',
    gender: '👨 Erkek',
    games: ['roblox', 'cs2', 'zula', 'minecraft'],
    gameUsernames: {
      roblox: 'EmreRbx',
      cs2: 'EmreCS',
      zula: 'EmreZula',
      minecraft: 'EmreMC',
    },
    robloxId: '445566',
    robloxUsername: 'EmreRbx',
    robloxProfileUrl: 'https://www.roblox.com/users/445566/profile',
  });

  let replyPayload = null;
  await profilimCommand.execute({
    guild: env.mockGuild,
    member: registeredUser,
    user: registeredUser.user,
    locale: 'tr',
    options: { getUser: () => null },
    reply: async (p) => {
      replyPayload = p;
      return p;
    },
  });

  assert.ok(replyPayload);
  assert.equal(replyPayload.ephemeral, false, 'Diğer üyelerin görmesi için /profilim herkese açık (ephemeral: false) olmalı');
  assert.deepEqual(replyPayload.allowedMentions, { parse: [] });

  const embedData = replyPayload.embeds[0].data;
  const allText = `${embedData.title}\n${embedData.description}\n${embedData.fields.map((f) => `${f.name}\n${f.value}`).join('\n')}`;

  assert.match(allText, /EmreRbx/);
  assert.match(allText, /EmreCS/);
  assert.match(allText, /EmreZula/);
  assert.match(allText, /EmreMC/);
  assert.match(allText, /https:\/\/www\.roblox\.com\/users\/445566\/profile/);

  // Kayıtsız kullanıcı /profilim yazarsa gizli (ephemeral: true) uyarı almalı
  const unregUser = env.makeMember({
    id: 'user_unreg_prof',
    username: 'unreg',
    roleIds: [config.ROLES.UNREGISTERED],
  });

  let unregReply = null;
  await profilimCommand.execute({
    guild: env.mockGuild,
    member: unregUser,
    user: unregUser.user,
    locale: 'tr',
    options: { getUser: () => null },
    reply: async (p) => {
      unregReply = p;
      return p;
    },
  });

  assert.equal(unregReply.ephemeral, true);
  assert.match(unregReply.content, /kayıtlı bir oyuncu profilin bulunmuyor/i);
});

test('8. /kayit-bilgi komutu: Roblox oynamayan üye sorgulandığında kırık link göstermemeli', async () => {
  const env = createMockGuildEnvironment();
  database.data.registrations = [];

  const nonRobloxMember = env.makeMember({
    id: 'user_no_rbx_info',
    username: 'zula_only',
    roleIds: [config.ROLES.VERIFIED, config.ROLES.REGISTERED_CHECK, '1571915745884115005'],
  });
  const staffMember = env.makeMember({
    id: 'staff_info_1',
    username: 'staff_info',
    roleIds: [config.ROLES.STAFF],
  });

  database.addRegistration({
    discordId: nonRobloxMember.id,
    realName: 'Kerem',
    gender: '👨 Erkek',
    games: ['zula'],
    gameUsernames: { zula: 'KeremZulaPro' },
    robloxId: null,
    robloxUsername: null,
  });

  let infoReply = null;
  await kayitBilgiCommand.execute({
    guild: env.mockGuild,
    member: staffMember,
    user: staffMember.user,
    options: {
      getUser: () => nonRobloxMember.user,
      getString: () => null,
    },
    reply: async (p) => {
      infoReply = p;
      return p;
    },
  });

  assert.ok(infoReply);
  const fieldsText = infoReply.embeds[0].data.fields.map((f) => `${f.name}: ${f.value}`).join('\n');
  assert.match(fieldsText, /KeremZulaPro/);
  assert.doesNotMatch(fieldsText, /users\/null\/profile/);
});
