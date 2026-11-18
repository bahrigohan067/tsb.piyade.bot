const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');

// İzole geçici test veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-afk-voice-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const database = require('../src/utils/database');
const afkVoiceManager = require('../src/utils/afkVoiceManager');
const voiceStateEvent = require('../src/events/voiceStateUpdate');

const AFK_ID = '1571913130684973177';
const OTHER_VOICE_ID = '999000111222333444';

function createMockVoiceMember(id, { channelId = null, serverMute = false, serverDeaf = false, failEdit = null } = {}) {
  const editCalls = [];

  const member = {
    id,
    user: { id, tag: `user_${id}#0001` },
    voice: {
      channelId,
      serverMute,
      serverDeaf,
    },
    editCalls,
    edit: async (patch) => {
      if (failEdit) {
        throw failEdit;
      }
      editCalls.push(patch);
      if (typeof patch.mute === 'boolean') member.voice.serverMute = patch.mute;
      if (typeof patch.deaf === 'boolean') member.voice.serverDeaf = patch.deaf;
      return member;
    },
  };

  return member;
}

function createVoiceState({ guildId = config.GUILD_ID, member, channelId, serverMute, serverDeaf, membersMap, channelsMap }) {
  const resolvedMute = typeof serverMute === 'boolean' ? serverMute : Boolean(member?.voice?.serverMute);
  const resolvedDeaf = typeof serverDeaf === 'boolean' ? serverDeaf : Boolean(member?.voice?.serverDeaf);

  return {
    id: member?.id,
    channelId: channelId || null,
    serverMute: resolvedMute,
    serverDeaf: resolvedDeaf,
    member,
    guild: {
      id: guildId,
      members: {
        cache: membersMap || new Collection(member ? [[member.id, member]] : []),
        fetch: async (uid) => membersMap?.get(uid) || (member && member.id === uid ? member : null),
      },
      channels: {
        cache: channelsMap || new Collection(),
        fetch: async (cid) => channelsMap?.get(cid) || null,
      },
    },
  };
}

test.beforeEach(() => {
  database.data.afkMutedUsers = {};
  database.save();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

test('1. AFK kanal yapılandırması ve index.js GuildVoiceStates intent kontrolü', () => {
  assert.equal(config.CHANNELS.AFK_VOICE, AFK_ID);
  assert.equal(afkVoiceManager.getAfkVoiceChannelId(), AFK_ID);

  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(indexSrc, /GatewayIntentBits\.GuildVoiceStates/);
});

test('2. AFK kanalına giren kişi hem susturma hem sağırlaştırma alır; tekrar eventlerde gereksiz PATCH atılmaz', async () => {
  const member = createMockVoiceMember('u_enter_1');

  const oldState = createVoiceState({ member, channelId: null, serverMute: false, serverDeaf: false });
  const newState = createVoiceState({ member, channelId: AFK_ID, serverMute: false, serverDeaf: false });

  const res = await voiceStateEvent.execute(oldState, newState);
  // event execute return değeri değil yan etkiler kontrol edilir
  assert.equal(member.editCalls.length, 1);
  assert.equal(member.editCalls[0].mute, true);
  assert.equal(member.editCalls[0].deaf, true);
  assert.equal(member.voice.serverMute, true);
  assert.equal(member.voice.serverDeaf, true);
  assert.equal(database.isAfkMutedUser('u_enter_1'), true);
  assert.equal(res, undefined);

  // Zaten mute & deaf olan ikinci AFK içi event'te ek PATCH olmamalı
  const repeatRes = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member, channelId: AFK_ID, serverMute: true, serverDeaf: true }),
    createVoiceState({ member, channelId: AFK_ID, serverMute: true, serverDeaf: true })
  );
  assert.equal(repeatRes.changed, false);
  assert.equal(member.editCalls.length, 1);
});

test('3. AFK içindeyken birisi susturma veya sağırlaştırmayı açarsa hemen geri uygulanır', async () => {
  const member = createMockVoiceMember('u_inside_1', { channelId: AFK_ID, serverMute: false, serverDeaf: true });
  database.markAfkMutedUser('u_inside_1', AFK_ID);

  const oldState = createVoiceState({ member, channelId: AFK_ID, serverMute: true, serverDeaf: true });
  const newState = createVoiceState({ member, channelId: AFK_ID, serverMute: false, serverDeaf: true });

  const res = await afkVoiceManager.handleVoiceStateUpdate(oldState, newState);
  assert.equal(res.action, 're_enforced_afk');
  assert.equal(res.changed, true);
  assert.equal(member.editCalls.length, 1);
  assert.deepEqual(member.editCalls[0].mute, true);
  assert.equal(Object.prototype.hasOwnProperty.call(member.editCalls[0], 'deaf'), false);
});

test('4. AFK kanalından doğrudan başka bir ses kanalına çıkan kişiden susturma ve sağırlaştırma anında alınır', async () => {
  const member = createMockVoiceMember('u_move_1', { channelId: OTHER_VOICE_ID, serverMute: true, serverDeaf: true });
  database.markAfkMutedUser('u_move_1', AFK_ID);

  const oldState = createVoiceState({ member, channelId: AFK_ID, serverMute: true, serverDeaf: true });
  const newState = createVoiceState({ member, channelId: OTHER_VOICE_ID, serverMute: true, serverDeaf: true });

  const res = await afkVoiceManager.handleVoiceStateUpdate(oldState, newState);
  assert.equal(res.action, 'left_afk_to_voice');
  assert.equal(res.ok, true);
  assert.equal(member.editCalls.length, 1);
  assert.equal(member.editCalls[0].mute, false);
  assert.equal(member.editCalls[0].deaf, false);
  assert.equal(member.voice.serverMute, false);
  assert.equal(member.voice.serverDeaf, false);
  assert.equal(database.isAfkMutedUser('u_move_1'), false);
});

test('5. AFK kanalından bağlantıyı tamamen kesen kişi sonraki ilk normal odaya girişte otomatik temizlenir (40032 koruması + DB kalıcılığı)', async () => {
  const member = createMockVoiceMember('u_disc_1', { channelId: null, serverMute: true, serverDeaf: true });
  database.markAfkMutedUser('u_disc_1', AFK_ID, { pendingUnmute: false });

  // A. AFK -> null (ses bağlantısını kesti): API PATCH atılmamalı, pendingUnmute kaydedilmeli
  const discRes = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member, channelId: AFK_ID, serverMute: true, serverDeaf: true }),
    createVoiceState({ member, channelId: null, serverMute: true, serverDeaf: true })
  );
  assert.equal(discRes.action, 'disconnected_from_afk');
  assert.equal(member.editCalls.length, 0, 'Ses kanalına bağlı değilken edit/unmute atılmamalı');
  assert.equal(database.getAfkMutedUser('u_disc_1')?.pendingUnmute, true);

  // Bot yeniden başlatılmış gibi DB'yi diskten tekrar yükle
  database.init();
  assert.equal(database.isAfkMutedUser('u_disc_1'), true);

  // B. Sonra normal bir odaya bağlandı (null -> OTHER_VOICE_ID): susturma & sağırlaştırma anında alınmalı
  member.voice.channelId = OTHER_VOICE_ID;
  const rejoinRes = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member, channelId: null, serverMute: true, serverDeaf: true }),
    createVoiceState({ member, channelId: OTHER_VOICE_ID, serverMute: true, serverDeaf: true })
  );
  assert.equal(rejoinRes.action, 'cleared_pending_unmute');
  assert.equal(member.editCalls.length, 1);
  assert.equal(member.editCalls[0].mute, false);
  assert.equal(member.editCalls[0].deaf, false);
  assert.equal(database.isAfkMutedUser('u_disc_1'), false);
});

test('6. Sadece AFK kanalındakiler etkilenir: AFK dışı odalardaki üyelere ve yetkili cezalarına dokunulmaz', async () => {
  // Normal bir odada yetkili tarafından susturulmuş üye (afkMutedUsers içinde değil)
  const punishedMember = createMockVoiceMember('u_punished', {
    channelId: OTHER_VOICE_ID,
    serverMute: true,
    serverDeaf: false,
  });

  const res = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member: punishedMember, channelId: null, serverMute: true, serverDeaf: false }),
    createVoiceState({ member: punishedMember, channelId: OTHER_VOICE_ID, serverMute: true, serverDeaf: false })
  );

  assert.equal(res.action, 'noop');
  assert.equal(punishedMember.editCalls.length, 0);
  assert.equal(punishedMember.voice.serverMute, true, 'Yetkili cezası kaldırılmamalı');
});

test('7. Hata dayanıklılığı: Yetki eksikliği, 40032 ses kopması ve farklı sunucu olayları botu çökertmez', async () => {
  const err40032 = Object.assign(new Error('Target user is not connected to voice.'), { code: 40032 });
  const mDisconnect = createMockVoiceMember('u_err_1', { channelId: AFK_ID, failEdit: err40032 });
  const r1 = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member: mDisconnect, channelId: null }),
    createVoiceState({ member: mDisconnect, channelId: AFK_ID, serverMute: false, serverDeaf: false })
  );
  assert.equal(r1.ok, false);
  assert.equal(r1.notConnected, true);

  const errPerm = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  const mPerm = createMockVoiceMember('u_err_2', { channelId: AFK_ID, failEdit: errPerm });
  const r2 = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ member: mPerm, channelId: null }),
    createVoiceState({ member: mPerm, channelId: AFK_ID, serverMute: false, serverDeaf: false })
  );
  assert.equal(r2.ok, false);

  // Farklı sunucu yoksayılmalı
  const mOtherGuild = createMockVoiceMember('u_other_g');
  const r3 = await afkVoiceManager.handleVoiceStateUpdate(
    createVoiceState({ guildId: '111111111111111111', member: mOtherGuild, channelId: null }),
    createVoiceState({ guildId: '111111111111111111', member: mOtherGuild, channelId: AFK_ID })
  );
  assert.equal(r3.action, 'ignored_other_guild');
  assert.equal(mOtherGuild.editCalls.length, 0);
});

test('8. Açılış eşitlemesi (syncAfkVoiceStatesOnStartup) hem AFK içindekileri kapatır hem dışarı çıkanları temizler', async () => {
  const inAfkUnmuted = createMockVoiceMember('u_boot_afk', {
    channelId: AFK_ID,
    serverMute: false,
    serverDeaf: false,
  });
  const escapedToOther = createMockVoiceMember('u_boot_escaped', {
    channelId: OTHER_VOICE_ID,
    serverMute: true,
    serverDeaf: true,
  });

  // Bot kapalıyken u_boot_escaped AFK'dan normal odaya geçmişti
  database.markAfkMutedUser('u_boot_escaped', AFK_ID, { pendingUnmute: false });

  const afkMembersMap = new Collection([['u_boot_afk', inAfkUnmuted]]);
  const guildMembersMap = new Collection([
    ['u_boot_afk', inAfkUnmuted],
    ['u_boot_escaped', escapedToOther],
  ]);

  const mockGuild = {
    id: config.GUILD_ID,
    channels: {
      cache: new Collection([[AFK_ID, { id: AFK_ID, members: afkMembersMap }]]),
      fetch: async (id) => (id === AFK_ID ? { id: AFK_ID, members: afkMembersMap } : null),
    },
    members: {
      cache: guildMembersMap,
      fetch: async (id) => guildMembersMap.get(id) || null,
    },
  };

  const result = await afkVoiceManager.syncAfkVoiceStatesOnStartup(mockGuild);
  assert.equal(result.enforcedCount, 1);
  assert.equal(result.clearedCount, 1);
  assert.equal(inAfkUnmuted.voice.serverMute, true);
  assert.equal(inAfkUnmuted.voice.serverDeaf, true);
  assert.equal(database.isAfkMutedUser('u_boot_afk'), true);

  assert.equal(escapedToOther.voice.serverMute, false);
  assert.equal(escapedToOther.voice.serverDeaf, false);
  assert.equal(database.isAfkMutedUser('u_boot_escaped'), false);
});
