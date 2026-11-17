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
  createRegisterPanel,
  ensureRegisterPanelMessage,
  isRegisterPanelMessage,
} = require('../src/utils/panel');
const kayitPaneliCmd = require('../src/commands/kayitPaneli');
const kayitBilgiCmd = require('../src/commands/kayitBilgi');
const profilimCmd = require('../src/commands/profilim');
const {
  createRegistrationApplication,
  formatApprovedNickname,
  clearRegistrationRateLimits,
} = require('../src/services/registrationService');
const interactionHandler = require('../src/events/interactionCreate');

const origResolveUser = robloxService.resolveUser.bind(robloxService);

test.beforeEach(() => {
  database.data.registrations = [];
  database.data.activeApplications = {};
  database.data.rejectedApplications = {};
  database.data.languagePrefs = {};
  database.save();
  clearRegistrationRateLimits();
  profilimCmd.resetProfileCooldowns();
  robloxService.resolveUser = origResolveUser;
});

test.after(() => {
  robloxService.resolveUser = origResolveUser;
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

function createMockGuildEnv({
  includeAllGameRoles = true,
  failRoleId = null,
  denyNickname = false,
} = {}) {
  const guildRoles = new Collection([
    [config.ROLES.VERIFIED, { id: config.ROLES.VERIFIED, name: '| Hesabı Onaylı', position: 20 }],
    [config.ROLES.REGISTERED_CHECK, { id: config.ROLES.REGISTERED_CHECK, name: '♾️| Cengaver', position: 20 }],
    [config.ROLES.MALE, { id: config.ROLES.MALE, name: '| Erkek', position: 15 }],
    [config.ROLES.FEMALE, { id: config.ROLES.FEMALE, name: '| Kız', position: 15 }],
    [config.ROLES.UNREGISTERED, { id: config.ROLES.UNREGISTERED, name: '| Kayıtsız', position: 5 }],
    [config.ROLES.STAFF, { id: config.ROLES.STAFF, name: '| Başvuru Yetkilisi', position: 40 }],
    [config.ROLES.ENGLISH, { id: config.ROLES.ENGLISH, name: '🇬🇧 English', position: 10 }],
  ]);

  if (includeAllGameRoles) {
    for (const g of gamesConfig.getEnabledGames()) {
      if (g.roleId) {
        guildRoles.set(g.roleId, { id: g.roleId, name: g.name.tr, position: 12 });
      }
    }
  }

  const createdThreads = [];
  const staffMessages = [];
  const registerChannelMessages = new Collection();
  const sentDms = [];

  function makeMember({ id, username, roleIds = [config.ROLES.UNREGISTERED], joinedTimestamp = 1700000000000 }) {
    const roleMap = new Collection();
    for (const rid of roleIds) {
      if (guildRoles.has(rid)) {
        roleMap.set(rid, guildRoles.get(rid));
      } else {
        roleMap.set(rid, { id: rid, name: `Role_${rid}`, position: 10 });
      }
    }

    const member = {
      id,
      nickname: null,
      displayName: username,
      joinedTimestamp,
      manageable: !denyNickname,
      user: {
        id,
        username,
        tag: `${username}#0001`,
        createdTimestamp: 1650000000000,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/avatar.png`,
        send: async (payload) => {
          sentDms.push({ userId: id, payload });
          return { id: `dm_${id}` };
        },
      },
      roles: {
        cache: roleMap,
        highest: { position: 20 },
        add: async (roleId) => {
          if (failRoleId && roleId === failRoleId) {
            throw new Error('Missing Permissions');
          }
          const roleObj = guildRoles.get(roleId) || { id: roleId, name: 'Role', position: 10 };
          roleMap.set(roleId, roleObj);
        },
        remove: async (roleId) => {
          roleMap.delete(roleId);
        },
      },
      permissions: {
        has: (perm) => perm === PermissionFlagsBits.Administrator && roleIds.includes(config.ROLES.STAFF),
      },
      setNickname: async (nick) => {
        if (denyNickname) {
          throw new Error('Missing Permissions: hierarchy too low');
        }
        member.nickname = nick;
        member.displayName = nick || username;
        return member;
      },
    };
    return member;
  }

  const membersMap = new Collection();
  const applicant = makeMember({ id: '2001', username: 'test_oyuncu' });
  const staffMember = makeMember({
    id: '3001',
    username: 'yetkili_uye',
    roleIds: [config.ROLES.STAFF],
  });
  membersMap.set(applicant.id, applicant);
  membersMap.set(staffMember.id, staffMember);

  const registerChannel = {
    id: config.CHANNELS.REGISTER,
    messages: {
      fetch: async () => registerChannelMessages,
    },
    send: async (payload) => {
      const msgId = String(BigInt(Date.now()) * 1000n + BigInt(registerChannelMessages.size + 1));
      const msg = {
        id: msgId,
        createdTimestamp: Date.now(),
        author: { id: 'bot_999' },
        embeds: payload.embeds || [],
        components: payload.components || [],
        edit: async (newPayload) => {
          msg.embeds = newPayload.embeds || msg.embeds;
          msg.components = newPayload.components || msg.components;
          return msg;
        },
      };
      registerChannelMessages.set(msgId, msg);
      return msg;
    },
    threads: {
      create: async (opts) => {
        const tId = `thread_${createdThreads.length + 1}`;
        const threadObj = {
          id: tId,
          name: opts.name,
          url: `https://discord.com/channels/${config.GUILD_ID}/${tId}`,
          deleted: false,
          members: { add: async () => {} },
          messages: [],
          send: async (p) => {
            threadObj.messages.push(p);
            return { id: `tmsg_${tId}` };
          },
          setName: async (n) => {
            threadObj.name = n;
          },
          delete: async () => {
            threadObj.deleted = true;
            channelsMap.delete(tId);
          },
        };
        createdThreads.push(threadObj);
        channelsMap.set(tId, threadObj);
        return threadObj;
      },
    },
  };

  const staffApprovalChannel = {
    id: config.CHANNELS.STAFF_APPROVAL,
    send: async (payload) => {
      const mId = `staff_msg_${staffMessages.length + 1}`;
      const msg = {
        id: mId,
        embeds: payload.embeds || [],
        components: payload.components || [],
        content: payload.content,
        allowedMentions: payload.allowedMentions,
        edit: async (editPayload) => {
          msg.embeds = editPayload.embeds || msg.embeds;
          msg.components = editPayload.components !== undefined ? editPayload.components : msg.components;
          return msg;
        },
      };
      staffMessages.push(msg);
      return msg;
    },
    messages: {
      fetch: async (id) => staffMessages.find((m) => m.id === id) || null,
    },
  };

  const channelsMap = new Collection([
    [config.CHANNELS.REGISTER, registerChannel],
    [config.CHANNELS.STAFF_APPROVAL, staffApprovalChannel],
  ]);

  const guild = {
    id: config.GUILD_ID,
    ownerId: '99999',
    client: { user: { id: 'bot_999', tag: 'Piyade#0001' } },
    roles: {
      cache: guildRoles,
      fetch: async () => guildRoles,
    },
    members: {
      cache: membersMap,
      fetch: async (id) => membersMap.get(String(id)) || null,
    },
    channels: {
      cache: channelsMap,
      fetch: async (id) => channelsMap.get(String(id)) || null,
    },
  };

  return {
    guild,
    guildRoles,
    membersMap,
    applicant,
    staffMember,
    makeMember,
    registerChannel,
    registerChannelMessages,
    staffApprovalChannel,
    staffMessages,
    createdThreads,
    sentDms,
  };
}

// =========================================================================
// 1. MASK MANTIĞI VE OYUN BUTONLARI TESTLERİ
// =========================================================================

test('1. Mask mantığı: oyun seçimi, tekrar basılamaz kuralı, Sıfırla, Devam ve geçersiz mask reddi', async () => {
  // gamesConfig.parseMask doğrulamaları
  assert.equal(gamesConfig.parseMask('0', { allowZero: true }), 0);
  assert.equal(gamesConfig.parseMask('0', { allowZero: false }), null);
  assert.equal(gamesConfig.parseMask('15'), 15);
  assert.equal(gamesConfig.parseMask('16'), null);
  assert.equal(gamesConfig.parseMask('-1', { allowZero: true }), null);
  assert.equal(gamesConfig.parseMask('abc', { allowZero: true }), null);

  // Sıralı bit değerleri: roblox=1, cs2=2, zula=4, minecraft=8
  assert.equal(gamesConfig.getGameBit('roblox'), 1);
  assert.equal(gamesConfig.getGameBit('cs2'), 2);
  assert.equal(gamesConfig.getGameBit('zula'), 4);
  assert.equal(gamesConfig.getGameBit('minecraft'), 8);

  const initialPayload = interactionHandler.buildGameSelectionPayload(0, 'tr', '2001');
  const gameButtonsInitial = initialPayload.components[0].toJSON().components;
  const ctrlButtonsInitial = initialPayload.components[1].toJSON().components;

  assert.equal(gameButtonsInitial.length, 4);
  for (const btn of gameButtonsInitial) {
    assert.equal(btn.style, ButtonStyle.Secondary);
    assert.equal(btn.disabled, false);
  }
  assert.equal(ctrlButtonsInitial[1].disabled, true, 'mask=0 iken Devam devre dışı olmalı');

  // Etkileşim simülasyonu: CS2 (bit=2) seçiliyor -> mask=2
  const env = createMockGuildEnv();
  let updatedPayload = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_g:cs2:0:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    update: async (p) => {
      updatedPayload = p;
    },
    reply: async () => {},
  });

  assert.ok(updatedPayload.content.includes('🔫 CS2'));
  const cs2Btn = updatedPayload.components[0].toJSON().components[1];
  const robloxBtn = updatedPayload.components[0].toJSON().components[0];
  const continueBtn = updatedPayload.components[1].toJSON().components[1];

  assert.equal(cs2Btn.style, ButtonStyle.Success, 'Seçilen buton yeşil olmalı');
  assert.equal(cs2Btn.disabled, true, 'Seçilen buton devre dışı olmalı');
  assert.ok(cs2Btn.label.startsWith('✅ '), 'Seçilen buton ✅ önekli olmalı');
  assert.equal(cs2Btn.custom_id, 'reg_g:cs2:2:tr');
  assert.equal(robloxBtn.style, ButtonStyle.Secondary);
  assert.equal(robloxBtn.custom_id, 'reg_g:roblox:2:tr');
  assert.equal(continueBtn.disabled, false, 'mask>0 iken Devam aktif olmalı');

  // Aynı butona (CS2) tekrar istek gelse bile mask değişmemeli (2 | 2 === 2)
  let updatedAgain = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_g:cs2:2:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    update: async (p) => {
      updatedAgain = p;
    },
    reply: async () => {},
  });
  assert.equal(updatedAgain.components[1].toJSON().components[1].custom_id, 'reg_go:2:tr');

  // Sıfırla butonu (reg_rs:tr) mask=0 döndürmeli
  let resetPayload = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_rs:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    update: async (p) => {
      resetPayload = p;
    },
    reply: async () => {},
  });
  assert.equal(resetPayload.components[1].toJSON().components[1].disabled, true);
  assert.equal(resetPayload.components[0].toJSON().components[1].style, ButtonStyle.Secondary);

  // mask=0 iken Devam'a basılırsa uyarı vermeli
  let warnReply = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_go:0:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    update: async () => {},
    reply: async (p) => {
      warnReply = p;
    },
  });
  assert.equal(warnReply.ephemeral, true);
  assert.match(warnReply.content, /en az bir oyun seç/i);

  // Geçersiz / eskimiş mask reddi (99)
  let invalidMaskReply = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_g:roblox:99:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    update: async () => {},
    reply: async (p) => {
      invalidMaskReply = p;
    },
  });
  assert.equal(invalidMaskReply.ephemeral, true);
  assert.match(invalidMaskReply.content, /eskidi/i);
});

// =========================================================================
// 2. MODAL KOMBINASYONLARI (1..15) VE TEKRAR DENE ÖNBELLEĞİ TESTLERİ
// =========================================================================

test('2. Modal: Tüm 1..15 mask kombinasyonları için alan sayısı, sıra, limitler ve Tekrar dene önbelleği', () => {
  for (let mask = 1; mask <= 15; mask++) {
    const games = gamesConfig.getGamesFromMask(mask);
    for (const lang of ['tr', 'en']) {
      const modal = interactionHandler.buildRegistrationModal({
        mask,
        genderCode: mask % 2 === 0 ? 'f' : 'm',
        lang,
      });
      const json = modal.toJSON();

      assert.ok(json.custom_id.length <= 100);
      assert.ok(json.title.length <= 45, `Modal başlığı 45 karakteri aşmamalı (${lang})`);
      assert.equal(json.components.length, 1 + games.length, `mask=${mask} için alan sayısı yanlış`);

      const firstInput = json.components[0].components[0];
      assert.equal(firstInput.custom_id, 'f_name');
      assert.ok(firstInput.label.length <= 45);
      assert.ok((firstInput.placeholder || '').length <= 100);

      for (let i = 0; i < games.length; i++) {
        const input = json.components[i + 1].components[0];
        assert.equal(input.custom_id, `f_${games[i].id}`);
        assert.ok(input.label.length <= 45, `${games[i].id} etiketi 45 karakteri aşıyor`);
        assert.ok((input.placeholder || '').length <= 100, `${games[i].id} placeholder 100 karakteri aşıyor`);
      }
    }
  }

  // Tekrar dene taslağı TTL kontrolü
  const tNow = 1000000;
  interactionHandler.saveRetryDraft(
    'user_retry',
    { mask: 9, genderCode: 'm', name: 'Deneme', games: { roblox: 'rbNick', minecraft: 'McUser_1' } },
    tNow
  );
  const loadedDraft = interactionHandler.getRetryDraft('user_retry', tNow + 5 * 60 * 1000);
  assert.ok(loadedDraft);
  const prefilledModal = interactionHandler.buildRegistrationModal({
    mask: 9,
    genderCode: 'm',
    lang: 'tr',
    prefill: loadedDraft,
  }).toJSON();
  assert.equal(prefilledModal.components[0].components[0].value, 'Deneme');
  assert.equal(prefilledModal.components[1].components[0].value, 'rbNick');
  assert.equal(prefilledModal.components[2].components[0].value, 'McUser_1');

  // 10 dakika geçince süresi dolmalı ve modal boş açılmalı
  const expired = interactionHandler.getRetryDraft(
    'user_retry',
    tNow + interactionHandler.RETRY_DRAFT_TTL_MS + 1000
  );
  assert.equal(expired, null);
});

// =========================================================================
// 3. ALAN DOĞRULAMA VE HIZ SINIRI TESTLERİ
// =========================================================================

test('3. Doğrulama: Minecraft kuralı, mention/link/davet/küfür, anlamsız değer ve 5 form hız sınırı', async () => {
  const env = createMockGuildEnv();

  // A. Minecraft kural ihlali (geçersiz karakter ve boyut)
  for (const badMc of ['ab', 'a'.repeat(17), 'bad-name', 'mc space', 'yok']) {
    const res = await createRegistrationApplication({
      guild: env.guild,
      member: env.applicant,
      user: env.applicant.user,
      name: 'Ahmet',
      gender: 'male',
      games: [{ id: 'minecraft', username: badMc }],
    });
    assert.equal(res.success, false, `'${badMc}' reddedilmeli`);
    assert.equal(res.code, 'GAME_USERNAME_INVALID');
    assert.equal(res.details?.game, 'minecraft');
  }

  // B. Mention, Link, Discord Daveti, Küfür ve Anlamsız Ad
  const badNames = ['@everyone', '@here', '<@123456>', 'https://evil.com', 'discord.gg/abc', 'orospu', 'yok', 'none', '-'];
  for (const badName of badNames) {
    const res = await createRegistrationApplication({
      guild: env.guild,
      member: env.applicant,
      user: env.applicant.user,
      name: badName,
      gender: 'male',
      games: [{ id: 'cs2', username: 'ProPlayer' }],
    });
    assert.equal(res.success, false, `'${badName}' reddedilmeli`);
    assert.equal(res.code, 'NAME_INVALID');
  }

  // Roblox olmayan oyunda URL reddi
  const badUrlGame = await createRegistrationApplication({
    guild: env.guild,
    member: env.applicant,
    user: env.applicant.user,
    name: 'Caner',
    gender: 'male',
    games: [{ id: 'zula', username: 'https://google.com' }],
  });
  assert.equal(badUrlGame.success, false);
  assert.equal(badUrlGame.code, 'GAME_USERNAME_INVALID');
  assert.equal(badUrlGame.details?.game, 'zula');

  // C. Form gönderim hız sınırı (10 dakikada 5 deneme, 6. reddedilir)
  robloxService.resolveUser = async () => ({ success: false, error: 'NOT_FOUND', message: 'Not found' });
  for (let i = 1; i <= 5; i++) {
    let replyMsg = null;
    await interactionHandler.handleRegistrationModalSubmit({
      customId: 'reg_form:2:m:tr',
      user: env.applicant.user,
      member: env.applicant,
      guild: env.guild,
      fields: {
        getTextInputValue: (cid) => (cid === 'f_name' ? 'Ahmet' : 'cs2_user'),
      },
      deferReply: async () => {},
      editReply: async (p) => {
        replyMsg = p;
      },
    });
    // thread oluşmuş veya doğrulanmış olsa bile aktif app temizleyelim ki 6. deneme rate limit'e takılsın
    database.removeActiveApplication(env.applicant.id);
    if (env.createdThreads[i - 1]) {
      env.guild.channels.cache.delete(env.createdThreads[i - 1].id);
    }
    assert.ok(replyMsg);
  }

  // 6. deneme hız sınırına takılmalı
  let rateLimitedReply = null;
  await interactionHandler.handleRegistrationModalSubmit({
    customId: 'reg_form:2:m:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    fields: {
      getTextInputValue: (cid) => (cid === 'f_name' ? 'Ahmet' : 'cs2_user'),
    },
    deferReply: async () => {},
    editReply: async (p) => {
      rateLimitedReply = p;
    },
  });
  assert.match(rateLimitedReply.content, /saniye/);
});

// =========================================================================
// 4. ROBLOX SENARYOLARI & DETAY TOPLAMA TESTLERİ
// =========================================================================

test('4. Roblox: NOT_FOUND, BANNED, geçici hata, çoklu hesap, kısmi detay hatası ve yeni hesap bayrağı', async () => {
  const env = createMockGuildEnv();

  // A. NOT_FOUND -> thread/kart açılmaz, net red + Tekrar dene butonu
  robloxService.resolveUser = async () => ({ success: false, error: 'NOT_FOUND', message: 'Not found' });
  let notFoundReply = null;
  await interactionHandler.handleRegistrationModalSubmit({
    customId: 'reg_form:1:m:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    fields: {
      getTextInputValue: (cid) => (cid === 'f_name' ? 'Ali' : 'OlmayanRoblox123'),
    },
    deferReply: async () => {},
    editReply: async (p) => {
      notFoundReply = p;
    },
  });
  assert.equal(env.createdThreads.length, 0, 'NOT_FOUND durumunda thread açılmamalı');
  assert.equal(env.staffMessages.length, 0, 'NOT_FOUND durumunda yetkili kartı gitmemeli');
  assert.match(notFoundReply.content, /Display Name/i);
  assert.equal(notFoundReply.components.length, 1, 'Tekrar dene butonu olmalı');
  assert.ok(notFoundReply.components[0].toJSON().components[0].custom_id.startsWith('reg_retry:'));

  // B. BANNED
  robloxService.resolveUser = async () => ({ success: false, error: 'BANNED', message: 'Banned' });
  const bannedRes = await createRegistrationApplication({
    guild: env.guild,
    member: env.applicant,
    user: env.applicant.user,
    name: 'Ali',
    gender: 'male',
    games: [{ id: 'roblox', username: 'BannedUser' }],
  });
  assert.equal(bannedRes.success, false);
  assert.equal(bannedRes.code, 'ROBLOX_BANNED');

  // C. Geçici API Hatası -> ROBLOX_LOOKUP_FAILED + tekrar dene (kullanıcı yok sanma!)
  robloxService.resolveUser = async () => ({ success: false, error: 'CONNECTION_ERROR', message: 'Timeout' });
  let tempErrReply = null;
  await interactionHandler.handleRegistrationModalSubmit({
    customId: 'reg_form:1:m:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    fields: {
      getTextInputValue: (cid) => (cid === 'f_name' ? 'Ali' : 'ValidUser'),
    },
    deferReply: async () => {},
    editReply: async (p) => {
      tempErrReply = p;
    },
  });
  assert.match(tempErrReply.content, /şu an doğrulanamıyor/);
  assert.equal(tempErrReply.components.length, 1);

  // D. Çoklu hesap koruması -> ROBLOX_ALREADY_REGISTERED
  database.addRegistration({
    discordId: '999888',
    displayName: 'Başkası',
    games: [{ id: 'roblox', username: 'TakenUser', verified: true, robloxId: '777777' }],
    robloxId: '777777',
    robloxUsername: 'TakenUser',
  });
  robloxService.resolveUser = async () => ({
    success: true,
    user: { id: '777777', name: 'TakenUser', displayName: 'Taken', avatarUrl: 'https://x.com/a.png' },
  });
  const multiRes = await createRegistrationApplication({
    guild: env.guild,
    member: env.applicant,
    user: env.applicant.user,
    name: 'Ali',
    gender: 'male',
    games: [{ id: 'roblox', username: 'TakenUser' }],
  });
  assert.equal(multiRes.success, false);
  assert.equal(multiRes.code, 'ROBLOX_ALREADY_REGISTERED');

  // E. Detayların bir kısmı alınamasa bile başvuru oluşmalı + yeni hesap (<30 gün) bayrağı + @about zararsızlaştırma
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/usernames/users')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 888888, name: 'FreshRoblox' }] }) };
    }
    if (u.includes('users.roblox.com/v1/users/888888')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 888888,
          name: 'FreshRoblox',
          displayName: 'FreshDisplay',
          description: '@everyone selam https://spam.com ' + 'a'.repeat(230),
          created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 günlük yeni hesap
          isBanned: false,
          hasVerifiedBadge: true,
        }),
      };
    }
    if (u.includes('/friends/count')) {
      throw new Error('Friends API down'); // Arkadaş sayısı başarısız -> "alınamadı" olmalı
    }
    if (u.includes('/followers/count')) {
      return { ok: true, status: 200, json: async () => ({ count: 42 }) };
    }
    if (u.includes('/followings/count')) {
      return { ok: true, status: 200, json: async () => ({ count: 7 }) };
    }
    if (u.includes('avatar-headshot')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ imageUrl: 'https://rbxcdn.com/head.png' }] }) };
    }
    return { ok: false, status: 500 };
  };

  try {
    robloxService.resolveUser = origResolveUser;
    const rbResult = await robloxService.resolveUser('https://www.roblox.com/users/888888/profile');
    assert.equal(rbResult.success, true);
    assert.equal(rbResult.user.friendsCount, null, 'Başarısız uç nokta null olmalı');
    assert.equal(rbResult.user.followersCount, 42);
    assert.equal(rbResult.user.followingsCount, 7);
    assert.equal(rbResult.user.isNewAccount, true);
    assert.ok(rbResult.user.about.length <= 200);
    assert.equal(rbResult.user.about.includes('@everyone'), false);

    // Şimdi başvuruyu oluştur ve yetkili kartını incele
    const appRes = await createRegistrationApplication({
      guild: env.guild,
      member: env.applicant,
      user: env.applicant.user,
      name: 'Alihan',
      gender: 'male',
      games: [
        { id: 'roblox', username: 'https://www.roblox.com/users/888888/profile' },
        { id: 'cs2', username: 'AliCS2' },
      ],
    });
    assert.equal(appRes.success, true);
    assert.equal(env.staffMessages.length, 1);

    const cardJson = env.staffMessages[0].embeds[0].toJSON();
    const rbField = cardJson.fields.find((f) => f.name.includes('Roblox Doğrulama'));
    assert.ok(rbField);
    assert.match(rbField.value, /alınamadı/, 'Alınamayan arkadaş sayısı kartta alınamadı yazmalı');
    assert.match(rbField.value, /Yeni hesap/, '30 günden yeni hesap bayrağı görünmeli');
    assert.match(rbField.value, /✅ Var/, 'Doğrulanmış rozet görünmeli');

    // Link butonu kartın altında bulunmalı
    const btnJson = env.staffMessages[0].components[0].toJSON().components;
    assert.equal(btnJson.length, 3);
    assert.equal(btnJson[2].url, 'https://www.roblox.com/users/888888/profile');
  } finally {
    global.fetch = origFetch;
  }
});

// =========================================================================
// 5 & 6. YETKİLİ KARTI VE ONAY / TAKMA AD / HATA TOLERANSI TESTLERİ
// =========================================================================

test('5 & 6. Yetkili kartı (eksik rol ⚠️), Onay rolleri, 32 krk takma ad kısaltma ve hata dayanıklılığı', async () => {
  // 1. Takma ad biçimleme ve 32 karakter akıllı kısaltma ("…" eklemez, Roblox adını korur)
  assert.equal(formatApprovedNickname('Ahmet', 'ahmet123'), 'Ahmet | ahmet123');
  assert.equal(formatApprovedNickname('Ahmet', null), 'Ahmet');
  const longNick = formatApprovedNickname('Muhammed Mustafa Uzunisim', 'RobloxProOyuncu');
  assert.equal(longNick.length <= 32, true);
  assert.ok(longNick.endsWith(' | RobloxProOyuncu'));
  assert.equal(longNick.includes('…'), false, 'Kısaltmada … eklenmemeli');

  // 2. Oyun rolü sunucuda yokken kartta ⚠️ olmalı ve onay DURMAMALI
  const env = createMockGuildEnv({ includeAllGameRoles: false });
  // Sadece CS2 rolünü sunucuda bırakıp Zula'yı silelim
  env.guildRoles.set(gamesConfig.getGameById('cs2').roleId, {
    id: gamesConfig.getGameById('cs2').roleId,
    name: 'CS2',
    position: 12,
  });

  // Aynı CS2 kullanıcısı başka bir üyede daha kayıtlı olsun (uyarı notu kontrolü)
  database.addRegistration({
    discordId: '888111',
    displayName: 'Eski Üye',
    games: [{ id: 'cs2', username: 'SharedNick' }],
  });

  const appRes = await createRegistrationApplication({
    guild: env.guild,
    member: env.applicant,
    user: env.applicant.user,
    name: 'Deniz',
    gender: 'female',
    games: [
      { id: 'cs2', username: 'sharednick' },
      { id: 'zula', username: 'DenizZula' },
    ],
  });
  assert.equal(appRes.success, true);

  const staffCardJson = env.staffMessages[0].embeds[0].toJSON();
  const rolesField = staffCardJson.fields.find((f) => f.name.includes('Verilecek Roller'));
  const gamesField = staffCardJson.fields.find((f) => f.name.includes('Seçilen Oyunlar'));
  assert.match(rolesField.value, /⚠️.*Zula/, 'Sunucuda olmayan oyun rolü kartta ⚠️ ile gösterilmeli');
  assert.match(gamesField.value, /888111/, 'Aynı kullanıcı adı başka üyedeyse yetkili kartında belirtilmeli');

  // Zula rolü yokken onay çalıştır: onay DURMAMALI, CS2 ve genel roller verilmeli, uyarı dönmeli
  let approveReply = null;
  await interactionHandler.handleApprove(
    {
      member: env.staffMember,
      user: env.staffMember.user,
      guild: env.guild,
      message: env.staffMessages[0],
      deferReply: async () => {},
      editReply: async (p) => {
        approveReply = p;
      },
      reply: async () => {},
    },
    env.applicant.id
  );

  assert.equal(env.applicant.roles.cache.has(config.ROLES.VERIFIED), true);
  assert.equal(env.applicant.roles.cache.has(config.ROLES.REGISTERED_CHECK), true);
  assert.equal(env.applicant.roles.cache.has(config.ROLES.FEMALE), true);
  assert.equal(env.applicant.roles.cache.has(gamesConfig.getGameById('cs2').roleId), true);
  assert.equal(env.applicant.roles.cache.has(config.ROLES.UNREGISTERED), false);
  assert.equal(env.applicant.nickname, 'Deniz');
  assert.match(approveReply.content, /Uyarılar/);
  assert.match(approveReply.content, /Zula/);

  // DM içeriğinde /profilim ipucu, roller ve oyunlar yer almalı
  assert.equal(env.sentDms.length, 1);
  assert.match(env.sentDms[0].payload.content, /\/profilim/);
  assert.match(env.sentDms[0].payload.content, /CS2/);

  // Çift onay koruması
  let doubleApproveReply = null;
  await interactionHandler.handleApprove(
    {
      member: env.staffMember,
      user: env.staffMember.user,
      guild: env.guild,
      message: env.staffMessages[0],
      deferReply: async () => {},
      editReply: async (p) => {
        doubleApproveReply = p;
      },
      reply: async () => {},
    },
    env.applicant.id
  );
  assert.match(doubleApproveReply.content, /zaten sonuçlanmış/i);

  // 3. Genel rol (APPROVED_ROLES) ekleme hatasında başvuru AKTİF kalmalı + Nickname yetki hatasında durmamalı
  const failEnv = createMockGuildEnv({ failRoleId: config.ROLES.VERIFIED, denyNickname: true });
  const failApp = await createRegistrationApplication({
    guild: failEnv.guild,
    member: failEnv.applicant,
    user: failEnv.applicant.user,
    name: 'Mert',
    gender: 'male',
    games: [{ id: 'minecraft', username: 'Mert_MC' }],
  });
  assert.equal(failApp.success, true);

  let firstAttemptReply = null;
  await interactionHandler.handleApprove(
    {
      member: failEnv.staffMember,
      user: failEnv.staffMember.user,
      guild: failEnv.guild,
      message: failEnv.staffMessages[0],
      deferReply: async () => {},
      editReply: async (p) => {
        firstAttemptReply = p;
      },
    },
    failEnv.applicant.id
  );
  assert.match(firstAttemptReply.content, /Başvuru aktif tutuldu/i);
  assert.ok(database.getActiveApplication(failEnv.applicant.id), 'Hata durumunda aktif başvuru silinmemeli');

  // Şimdi rol yetkisi düzeldi (ama nickname hala denyNickname=true), tekrar Onayla -> başarıyla tamamlanmalı ve nick uyarısı vermeli!
  failEnv.applicant.roles.add = async (rid) => {
    failEnv.applicant.roles.cache.set(rid, failEnv.guildRoles.get(rid));
  };
  let retryApproveReply = null;
  await interactionHandler.handleApprove(
    {
      member: failEnv.staffMember,
      user: failEnv.staffMember.user,
      guild: failEnv.guild,
      message: failEnv.staffMessages[0],
      deferReply: async () => {},
      editReply: async (p) => {
        retryApproveReply = p;
      },
    },
    failEnv.applicant.id
  );
  assert.equal(database.getActiveApplication(failEnv.applicant.id), null, 'Başvurunun tamamlanması gerekir');
  assert.match(retryApproveReply.content, /Takma ad.*güncellenemedi/i);
});

// =========================================================================
// 7. /profilim KOMUTU TESTLERİ
// =========================================================================

test('7. /profilim: 3 oyunlu, tek oyunlu, eski format, boş games, kayıtsız, cooldown, gizlilik ve TR/EN', async () => {
  const env = createMockGuildEnv();

  // Parametresi olmamalı
  assert.equal(profilimCmd.data.toJSON().options?.length || 0, 0);
  assert.equal(profilimCmd.data.name_localizations['en-US'], 'profile');

  // A. Kayıtsız kullanıcı
  let unregReply = null;
  await profilimCmd.execute({
    user: env.applicant.user,
    member: env.applicant,
    locale: 'tr',
    reply: async (p) => {
      unregReply = p;
    },
  });
  assert.equal(unregReply.ephemeral, true);
  assert.ok(unregReply.content.includes(config.CHANNELS.REGISTER));

  // B. 3 oyunlu kayıtlı kullanıcı (TR, herkese açık)
  env.applicant.roles.cache.set(config.ROLES.REGISTERED_CHECK, { id: config.ROLES.REGISTERED_CHECK });
  database.addRegistration({
    discordId: env.applicant.id,
    displayName: 'Kaan Demir',
    gender: '👧 Kız', // profilim içinde ASLA görünmemeli!
    lang: 'tr',
    games: [
      { id: 'roblox', username: 'Bacon_Exe1341', verified: true, robloxId: '12345', robloxProfileUrl: 'https://www.roblox.com/users/12345/profile' },
      { id: 'cs2', username: 'KaanCS' },
      { id: 'minecraft', username: 'Kaan_MC' },
    ],
  });

  let trProfileReply = null;
  await profilimCmd.execute({
    user: env.applicant.user,
    member: env.applicant,
    locale: 'tr',
    reply: async (p) => {
      trProfileReply = p;
    },
  });
  assert.equal(trProfileReply.ephemeral, false, '/profilim herkese açık olmalı');
  assert.deepEqual(trProfileReply.allowedMentions, { parse: [] });
  assert.equal(trProfileReply.embeds[0].data.color, config.COLORS.PURPLE);
  assert.equal(trProfileReply.embeds[0].data.title, '🎮✨ Oyuncu Profili');
  const descTr = trProfileReply.embeds[0].data.description;
  assert.match(descTr, /Kaan Demir/);
  assert.match(descTr, /\(3\)/);
  assert.match(descTr, /`Bacon_Exe1341`/);
  assert.match(descTr, /`KaanCS`/);
  assert.match(descTr, /`Kaan_MC`/);
  assert.equal(descTr.includes('Kız'), false, 'Cinsiyet /profilim içinde gizli kalmalı');
  assert.equal(trProfileReply.components.length, 1, 'Roblox link butonu bulunmalı');
  assert.equal(trProfileReply.components[0].toJSON().components[0].url, 'https://www.roblox.com/users/12345/profile');

  // C. Bekleme süresi (cooldown) kontrolü
  let cooldownReply = null;
  await profilimCmd.execute({
    user: env.applicant.user,
    member: env.applicant,
    locale: 'tr',
    reply: async (p) => {
      cooldownReply = p;
    },
  });
  assert.equal(cooldownReply.ephemeral, true);
  assert.match(cooldownReply.content, /sn sonra tekrar dene ⏳/);

  // D. Eski formatlı kayıt (games alanı yok, sadece robloxUsername var)
  profilimCmd.resetProfileCooldowns();
  const legacyDiskRaw = {
    discordId: '4004',
    realName: 'Eski Üye',
    robloxUsername: 'OldRobloxPlayer',
    robloxId: '987654',
    gender: '👦 Erkek',
    registeredAt: 1700000000000,
  };
  database.data.registrations.push(legacyDiskRaw);
  database.save();

  const legacyMember = env.makeMember({
    id: '4004',
    username: 'eski_uye',
    roleIds: [config.ROLES.REGISTERED_CHECK, config.ROLES.ENGLISH],
  });
  database.setUserLang('4004', 'en');

  let enLegacyReply = null;
  await profilimCmd.execute({
    user: legacyMember.user,
    member: legacyMember,
    locale: 'en-US',
    reply: async (p) => {
      enLegacyReply = p;
    },
  });
  assert.equal(enLegacyReply.embeds[0].data.title, '🎮✨ Player Profile');
  assert.match(enLegacyReply.embeds[0].data.description, /`OldRobloxPlayer`/);
  assert.equal(enLegacyReply.components[0].toJSON().components[0].label, '🧱 Roblox Profile');
  // Diskteki ham kayıt yeniden yazılmamış olmalı (games eklenmemeli)
  const rawStored = database.data.registrations.find((r) => r.discordId === '4004');
  assert.equal(rawStored.games, undefined, 'Okuma sırasında eski veri diske yeniden yazılmamalı');

  // E. SHOW_NAME=false ve boş games=[] durumu
  profilimCmd.resetProfileCooldowns();
  const origShowName = config.PROFILE.SHOW_NAME;
  config.PROFILE.SHOW_NAME = false;
  try {
    const emptyGamesPayload = profilimCmd.buildProfilePayload({
      user: env.applicant.user,
      member: env.applicant,
      registration: { displayName: 'Gizli İsim', games: [], registeredAt: 1700000000000 },
      lang: 'tr',
    });
    assert.equal(emptyGamesPayload.embeds[0].data.description.includes('Gizli İsim'), false);
    assert.match(emptyGamesPayload.embeds[0].data.description, /Henüz oyun bilgisi yok/);
  } finally {
    config.PROFILE.SHOW_NAME = origShowName;
  }
});

// =========================================================================
// 8. KAYIT PANELİ BULMA / GÜNCELLEME VE İKİNCİ PANEL AÇMAMA TESTLERİ
// =========================================================================

test('8. Panel: Başlık değişse bile btn_kayit_ol ile mevcut paneli bulup güncelleme ve ikinci panel açmama', async () => {
  const env = createMockGuildEnv();
  const botId = env.guild.client.user.id;

  // Eski başlıklı iki panel mesajı simüle et (bir eski, bir yeni)
  const oldMsg1 = {
    id: '100',
    createdTimestamp: 1000,
    author: { id: botId },
    embeds: [{ title: 'Çok Eski Başlık' }],
    components: [
      { components: [{ customId: 'btn_kayit_ol' }, { customId: 'btn_kayit_ol_en' }] },
    ],
    editedCount: 0,
    edit: async function () {
      this.editedCount++;
      return this;
    },
  };
  const newerMsg2 = {
    id: '200',
    createdTimestamp: 2000,
    author: { id: botId },
    embeds: [{ title: 'Eski Kayıt Sistemi Başlığı' }],
    components: [
      { components: [{ customId: 'btn_kayit_ol' }, { customId: 'btn_kayit_ol_en' }] },
    ],
    editedCount: 0,
    edit: async function (payload) {
      this.editedCount++;
      this.embeds = payload.embeds;
      return this;
    },
  };

  assert.equal(isRegisterPanelMessage(newerMsg2, botId), true);
  env.registerChannelMessages.set(oldMsg1.id, oldMsg1);
  env.registerChannelMessages.set(newerMsg2.id, newerMsg2);

  // Açılış kontrolü yalnızca en yenisini düzenlemeli, silmemeli, yeni mesaj göndermemeli
  const startupRes = await ensureRegisterPanelMessage(env.guild);
  assert.equal(startupRes.action, 'updated');
  assert.equal(startupRes.duplicatesFound, 1);
  assert.equal(oldMsg1.editedCount, 0);
  assert.equal(newerMsg2.editedCount, 1);
  assert.equal(env.registerChannelMessages.size, 2);

  // /kayit-paneli tekrar çalıştırıldığında da yeni panel atmamalı, mevcutu güncellemeli
  let cmdReply = null;
  await kayitPaneliCmd.execute({
    guild: env.guild,
    channel: env.registerChannel,
    options: { getChannel: () => null },
    reply: async (p) => {
      cmdReply = p;
    },
  });
  assert.equal(newerMsg2.editedCount, 2);
  assert.equal(env.registerChannelMessages.size, 2, 'İkinci panel açılmamalı');
  assert.match(cmdReply.content, /güncellendi/);

  // Panel içeriğinde "TSB" veya "klan" olmamalı
  const panelPayload = createRegisterPanel();
  const serialized = JSON.stringify(panelPayload.embeds.map((e) => e.toJSON()));
  assert.equal(/\btsb\b/i.test(serialized), false, 'Panelde TSB ifadesi kalmamalı');
  assert.equal(/\bklan\b/i.test(serialized), false, 'Panelde klan ifadesi kalmamalı');

  // 4+ oyun uyarısı kontrolü
  gamesConfig.GAMES.push({ id: 'extra', emoji: '🎲', enabled: true, name: { tr: 'E', en: 'E' } });
  try {
    const valReport = gamesConfig.validateGamesConfig();
    assert.equal(valReport.ok, false);
    assert.ok(valReport.warnings.some((w) => w.includes('4') || w.includes('5')));
  } finally {
    gamesConfig.GAMES.pop();
  }
});

// =========================================================================
// 9 & 10. VERİTABANI YENİDEN BAŞLATMA VE ESKİ CUSTOMID TESTLERİ
// =========================================================================

test('9 & 10. Veritabanı init/save dayanıklılığı, /kayit-bilgi çoklu oyun ve eski customId yakalama', async () => {
  const env = createMockGuildEnv();

  // A. Kayıt ekle ve veritabanını sıfırdan diskten oku (init)
  database.addRegistration({
    discordId: '7007',
    displayName: 'Baran',
    gender: '👦 Erkek',
    lang: 'en',
    games: [
      { id: 'roblox', username: 'BaranRbx', verified: true, robloxId: '554433', robloxProfileUrl: 'https://www.roblox.com/users/554433/profile' },
      { id: 'zula', username: 'BaranZula' },
    ],
    approvedBy: '3001',
    approvedAt: 1750000000000,
  });

  // Bellekten temizle ve diskten tekrar init et
  database.data = { registrations: [], activeApplications: {}, rejectedApplications: {} };
  database.init();

  const reloaded = database.getRegistrationByDiscordId('7007');
  assert.ok(reloaded);
  assert.equal(reloaded.displayName, 'Baran');
  assert.equal(reloaded.lang, 'en');
  assert.equal(reloaded.games.length, 2);
  assert.equal(reloaded.games[1].username, 'BaranZula');

  // /kayit-bilgi çoklu oyunları göstermeli
  let kbReply = null;
  await kayitBilgiCmd.execute({
    member: env.staffMember,
    user: env.staffMember.user,
    options: {
      getUser: () => ({ id: '7007' }),
      getString: () => null,
    },
    reply: async (p) => {
      kbReply = p;
    },
  });
  const kbJson = kbReply.embeds[0].toJSON();
  const kbGamesField = kbJson.fields.find((f) => f.name.includes('Oyunlar'));
  assert.match(kbGamesField.value, /BaranRbx/);
  assert.match(kbGamesField.value, /BaranZula/);

  // B. Eski customId'ler ("Bu menü eskidi, lütfen kayıt panelindeki butona tekrar bas.")
  for (const oldCid of [
    'select_gender',
    'select_gender_en',
    'select_gender_other',
    'modal_kayit_gender_erkek',
    'btn_reg_type_own',
    'btn_clan_create',
  ]) {
    let legacyReply = null;
    await interactionHandler.execute({
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => !oldCid.startsWith('select_') && !oldCid.startsWith('modal_'),
      isStringSelectMenu: () => oldCid.startsWith('select_'),
      isModalSubmit: () => oldCid.startsWith('modal_'),
      customId: oldCid,
      user: env.applicant.user,
      member: env.applicant,
      guild: env.guild,
      reply: async (p) => {
        legacyReply = p;
      },
    });
    assert.equal(legacyReply.ephemeral, true);
    assert.match(
      legacyReply.content,
      /eskidi|expired/i,
      `Eski customId '${oldCid}' yenileme uyarısı döndürmeli`
    );
  }
});

test('11. Roblox kuyruk / hız sınırı, cinsiyet seçimi -> modal ve Tekrar dene buton akışı', async () => {
  const env = createMockGuildEnv();
  const { RobloxService } = require('../src/services/roblox');

  // A. Eşzamanlı kuyruk kontrolü (max 3 eşzamanlı görev)
  const svc = new RobloxService();
  let active = 0;
  let maxSeen = 0;
  const results = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((n) =>
      svc.enqueue(async () => {
        active++;
        if (active > maxSeen) maxSeen = active;
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return n * 10;
      })
    )
  );
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
  assert.equal(maxSeen <= 3, true, `Eşzamanlı istek sınırı aşıldı: ${maxSeen}`);

  // B. 429 yanıtı NOT_FOUND yerine RATE_LIMITED -> ROBLOX_LOOKUP_FAILED dönmeli
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429 });
  try {
    robloxService.resolveUser = origResolveUser;
    const rateRes = await robloxService.resolveUser('SomePlayer');
    assert.equal(rateRes.success, false);
    assert.equal(rateRes.error, 'RATE_LIMITED');
  } finally {
    global.fetch = origFetch;
  }

  // C. Cinsiyet seçimi -> showModal & Tekrar dene -> ön doldurmalı modal açılması
  let shownModal = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId: 'reg_gender:3:tr',
    values: ['f'],
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    showModal: async (m) => {
      shownModal = m.toJSON();
    },
  });
  assert.ok(shownModal);
  assert.equal(shownModal.custom_id, 'reg_form:3:f:tr');
  assert.equal(shownModal.components.length, 3, 'Ad + Roblox + CS2 = 3 alan olmalı');

  // Taslak kaydedip Tekrar dene butonuna bas
  interactionHandler.saveRetryDraft(env.applicant.id, {
    mask: 3,
    genderCode: 'f',
    lang: 'tr',
    name: 'Ece',
    games: { roblox: 'EceRoblox', cs2: 'EceCS2' },
  });

  let retryShownModal = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_retry:3:f:tr',
    user: env.applicant.user,
    member: env.applicant,
    guild: env.guild,
    showModal: async (m) => {
      retryShownModal = m.toJSON();
    },
  });
  assert.ok(retryShownModal);
  assert.equal(retryShownModal.components[0].components[0].value, 'Ece');
  assert.equal(retryShownModal.components[1].components[0].value, 'EceRoblox');
  assert.equal(retryShownModal.components[2].components[0].value, 'EceCS2');
});

