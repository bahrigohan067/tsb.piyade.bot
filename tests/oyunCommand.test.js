const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ActivityType,
  ButtonStyle,
  ChannelType,
  Collection,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

// Testler için izole geçici veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-oyun-cmd-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const activityConfig = require('../activity.config');
const database = require('../src/utils/database');
const activityTracker = require('../src/utils/activityTracker');
const aktivitemCmd = require('../src/commands/aktivitem');
const oyunCmd = require('../src/commands/oyun');

const { ActivityTracker, TRANSFER_REASONS } = activityTracker;

/**
 * Deterministik sahte saat ve zamanlayıcı yardımcısı (gece 00:00 ve cooldown testleri için).
 */
function createFakeClock(startMs = Date.parse('2026-11-22T15:00:00Z')) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();

  const setTimeoutFn = (fn, delay = 0) => {
    const id = nextId++;
    const handle = {
      id,
      fn,
      runAt: now + Math.max(0, Number(delay) || 0),
      interval: null,
      unref() {
        return handle;
      },
    };
    timers.set(id, handle);
    return handle;
  };

  const clearTimeoutFn = (handle) => {
    if (handle && typeof handle === 'object') {
      timers.delete(handle.id);
    }
  };

  const setIntervalFn = (fn, delay = 1000) => {
    const id = nextId++;
    const step = Math.max(1, Number(delay) || 1000);
    const handle = {
      id,
      fn,
      runAt: now + step,
      interval: step,
      unref() {
        return handle;
      },
    };
    timers.set(id, handle);
    return handle;
  };

  const clearIntervalFn = clearTimeoutFn;

  async function advanceBy(ms) {
    const target = now + ms;
    while (true) {
      let earliest = null;
      for (const t of timers.values()) {
        if (t.runAt <= target && (!earliest || t.runAt < earliest.runAt)) {
          earliest = t;
        }
      }
      if (!earliest) break;
      now = earliest.runAt;
      if (earliest.interval !== null) {
        earliest.runAt = now + earliest.interval;
      } else {
        timers.delete(earliest.id);
      }
      earliest.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = target;
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    nowFn: () => now,
    setNow: (ms) => {
      now = ms;
    },
    setTimeoutFn,
    clearTimeoutFn,
    setIntervalFn,
    clearIntervalFn,
    advanceBy,
  };
}

/**
 * Sahte Discord Sunucusu (roller, ses kanalları, komut kanalı ve üyeler).
 */
function createMockGuild({
  ownerId = 'owner_uid',
  missingFamilyRoles = [],
  botRolePos = 50,
  roleAddError = null,
  roleRemoveError = null,
  commandChannelCanSend = true,
} = {}) {
  const roles = new Collection();
  const channels = new Collection();
  const members = new Collection();
  const presences = new Collection();
  const voiceStates = new Collection();

  const apiLog = {
    roleAdds: [],
    roleRemoves: [],
    moves: [],
    commandMessages: [],
  };

  const missingSet = new Set(missingFamilyRoles);
  for (const [key, fam] of Object.entries(activityConfig.FAMILIES)) {
    if (missingSet.has(key)) continue;
    roles.set(fam.roleId, {
      id: fam.roleId,
      name: `${fam.emoji} ${fam.name.tr}`,
      position: 10,
      members: new Collection(),
    });
  }

  // Yetki rolleri: Developer, Yönetmenlik (TRYOUT_STAFF), Founder
  roles.set(config.ROLES.DEVELOPER, {
    id: config.ROLES.DEVELOPER,
    name: '💻| DEVELOPER',
    position: 45,
    members: new Collection(),
  });
  roles.set(config.ROLES.TRYOUT_STAFF, {
    id: config.ROLES.TRYOUT_STAFF,
    name: '🛡️| Yetkili',
    position: 40,
    members: new Collection(),
  });
  roles.set(config.ROLES.FOUNDER, {
    id: config.ROLES.FOUNDER,
    name: 'FOUNDER',
    position: 44,
    members: new Collection(),
  });

  function makeVoiceChannel(id, name) {
    const ch = {
      id,
      name,
      type: ChannelType.GuildVoice,
      userLimit: 0,
      members: new Collection(),
      permissionsFor: () => ({ has: () => true }),
    };
    channels.set(id, ch);
    return ch;
  }

  for (const g of activityConfig.GAMES) {
    for (const chId of g.voiceChannelIds) {
      makeVoiceChannel(chId, `🔊 ${g.name}`);
    }
  }
  for (const chId of activityConfig.ROBLOX_UNKNOWN.voiceChannelIds) {
    makeVoiceChannel(chId, '🔊 OTHER GAMES');
  }
  const returnChannel = makeVoiceChannel(activityConfig.RETURN_CHANNEL_ID, '🔊 Salon 1');
  const lobbyChannel = makeVoiceChannel('voice_lobby_1', '🔊 Sohbet 1');

  const commandChannel = {
    id: activityConfig.COMMAND_CHANNEL_ID,
    name: 'bot-komut',
    type: ChannelType.GuildText,
    permissionsFor: () => ({
      has: (p) => !(p === PermissionFlagsBits.SendMessages && !commandChannelCanSend),
    }),
    send: async (payload) => {
      if (!commandChannelCanSend) {
        const err = new Error('Missing Access');
        err.code = 50013;
        throw err;
      }
      apiLog.commandMessages.push(payload);
      return { id: `msg_${apiLog.commandMessages.length}`, delete: async () => {} };
    },
  };
  channels.set(commandChannel.id, commandChannel);

  const guild = {
    id: '1559313292651008040',
    ownerId,
    roles: { cache: roles },
    channels: { cache: channels },
    members: {
      cache: members,
      me: {
        id: 'bot_id',
        roles: { highest: { position: botRolePos } },
        permissions: { has: () => true },
      },
      fetch: async (arg) => {
        if (typeof arg === 'string') return members.get(arg) || null;
        if (arg && Array.isArray(arg.user)) {
          const col = new Collection();
          for (const uid of arg.user) {
            const m = members.get(String(uid));
            if (m) col.set(String(uid), m);
          }
          return col;
        }
        return null;
      },
    },
    presences: { cache: presences },
    voiceStates: { cache: voiceStates },
  };

  let dynamicRoleRemoveError = roleRemoveError;
  let dynamicRoleAddError = roleAddError;

  function makeMember(
    id,
    { roleIds = [], isAdmin = false, voiceChannel = null, bot = false } = {}
  ) {
    const roleMap = new Collection();
    for (const rid of roleIds) {
      const rObj = roles.get(rid) || { id: rid, name: rid, members: new Collection() };
      roleMap.set(rid, rObj);
    }

    const member = {
      id: String(id),
      guild,
      displayName: `User_${id}`,
      user: {
        id: String(id),
        username: `user_${id}`,
        globalName: `User_${id}`,
        bot,
        displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/a.png`,
      },
      presence: null,
      permissions: {
        has: (perm) => Boolean(isAdmin && perm === PermissionFlagsBits.Administrator),
      },
      voice: {
        channelId: voiceChannel ? voiceChannel.id : null,
        channel: voiceChannel || null,
        setChannel: async (targetId, reason) => {
          if (member.voice.channel) member.voice.channel.members.delete(member.id);
          const next = channels.get(targetId) || null;
          member.voice.channelId = next ? next.id : null;
          member.voice.channel = next;
          if (next) next.members.set(member.id, member);
          apiLog.moves.push({ userId: member.id, targetId, reason });
        },
      },
      roles: {
        cache: roleMap,
        add: async (roleId, reason) => {
          const err = typeof dynamicRoleAddError === 'function' ? dynamicRoleAddError(member, roleId) : dynamicRoleAddError;
          if (err) throw err;
          const rObj = roles.get(roleId) || { id: roleId, name: roleId, members: new Collection() };
          roleMap.set(roleId, rObj);
          if (rObj.members) rObj.members.set(member.id, member);
          apiLog.roleAdds.push({ userId: member.id, roleId, reason });
        },
        remove: async (roleId, reason) => {
          const err = typeof dynamicRoleRemoveError === 'function' ? dynamicRoleRemoveError(member, roleId) : dynamicRoleRemoveError;
          if (err) throw err;
          roleMap.delete(roleId);
          const rObj = roles.get(roleId);
          if (rObj?.members) rObj.members.delete(member.id);
          apiLog.roleRemoves.push({ userId: member.id, roleId, reason });
        },
      },
    };

    for (const rid of roleIds) {
      const rObj = roles.get(rid);
      if (rObj?.members) rObj.members.set(member.id, member);
    }
    if (voiceChannel) {
      voiceChannel.members.set(member.id, member);
      voiceStates.set(member.id, {
        id: member.id,
        channelId: voiceChannel.id,
        channel: voiceChannel,
        member,
        guild,
      });
    }
    members.set(member.id, member);
    return member;
  }

  function makePresence(member, activities = [], { status = 'online' } = {}) {
    const p = {
      userId: member.id,
      user: member.user,
      member,
      guild,
      status,
      activities,
    };
    member.presence = p;
    presences.set(member.id, p);
    return p;
  }

  return {
    guild,
    roles,
    channels,
    returnChannel,
    lobbyChannel,
    apiLog,
    makeMember,
    makePresence,
    setRoleAddError: (err) => {
      dynamicRoleAddError = err;
    },
    setRoleRemoveError: (err) => {
      dynamicRoleRemoveError = err;
    },
  };
}

function makeTestConfig(overrides = {}) {
  return {
    ...activityConfig,
    ...overrides,
    TIMINGS: {
      ...activityConfig.TIMINGS,
      ROLE_QUEUE_GAP_MS: 0,
      MOVE_QUEUE_GAP_MS: 0,
      ...(overrides.TIMINGS || {}),
    },
  };
}

test.beforeEach(() => {
  const curMonth = database.getCurrentIstanbulMonth();
  const curDay = database.getCurrentIstanbulDay();
  database.data.activityPrefs = {};
  database.data.activityStats = { month: curMonth, users: {} };
  database.data.activityMeta = {
    announcedAt: Date.now(),
    returnAnnouncedAt: Date.now(),
    manualAnnouncedAt: Date.now(),
    lastResetMonth: curMonth,
  };
  database.data.activityManual = { day: curDay, users: {} };
  database.data.languagePrefs = {};
  database.data.localeHints = {};
  database.save();
  aktivitemCmd.resetActivityCooldowns();
  oyunCmd.resetManualButtonCooldowns();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

// =========================================================================
// 1. 🛠️ SİSTEM DURUMU: SADECE DEVELOPER YETKİSİ VE YENİ BİLGİLER
// =========================================================================

test('1. Sistem Durumu SADECE Developer rolüne görünür ve açılır; Yönetmenlik/Admin/Sunucu Sahibi reddedilir ve veri sızmaz', async () => {
  const clock = createFakeClock();
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockGuild({ ownerId: 'u_owner' });
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  const devM = env.makeMember('u_dev', { roleIds: [config.ROLES.DEVELOPER] });
  const mgmtM = env.makeMember('u_mgmt', { roleIds: [config.ROLES.TRYOUT_STAFF, config.ROLES.FOUNDER] });
  const adminM = env.makeMember('u_admin', { isAdmin: true });
  const ownerM = env.makeMember('u_owner', { isAdmin: true, roleIds: [config.ROLES.FOUNDER] });
  const normalM = env.makeMember('u_norm');

  // Görünürlük kontrolü (Ayarlarım Satır 2)
  assert.equal(aktivitemCmd.hasSystemStatusAuthority(devM), true);
  assert.equal(aktivitemCmd.hasSystemStatusAuthority(mgmtM), false);
  assert.equal(aktivitemCmd.hasSystemStatusAuthority(adminM), false);
  assert.equal(aktivitemCmd.hasSystemStatusAuthority(ownerM), false);
  assert.equal(aktivitemCmd.hasSystemStatusAuthority(normalM), false);

  const devPanel = aktivitemCmd.buildSettingsPanelPayload('u_dev', 'tr', null, database, {
    member: devM,
    guild: env.guild,
  });
  assert.match(devPanel.content, /Mobilden oynuyorsan `\/oyun` komutunu kullan/);
  assert.equal(devPanel.components[1].toJSON().components.some((c) => c.custom_id === 'act_sys:u_dev'), true);

  const devPanelEn = aktivitemCmd.buildSettingsPanelPayload('u_dev', 'en', null, database, {
    member: devM,
    guild: env.guild,
  });
  assert.match(devPanelEn.content, /Playing on mobile\? Use the `\/game` command/);

  for (const deniedMember of [mgmtM, adminM, ownerM, normalM]) {
    const p = aktivitemCmd.buildSettingsPanelPayload(deniedMember.id, 'tr', null, database, {
      member: deniedMember,
      guild: env.guild,
    });
    assert.equal(
      p.components[1].toJSON().components.some((c) => c.custom_id.startsWith('act_sys:')),
      false,
      `${deniedMember.id} Sistem Durumu düğmesini görmemeli`
    );

    // Sahte customId ile tıklamaya çalışsa bile sunucu tarafında ephemeral red alır ve veri sızmaz
    let replyTr = null;
    await aktivitemCmd.handleActivityButton(
      {
        customId: `act_sys:${deniedMember.id}`,
        user: deniedMember.user,
        member: deniedMember,
        guild: env.guild,
        locale: 'tr',
        reply: async (payload) => {
          replyTr = payload;
        },
      },
      { tracker, db: database }
    );
    assert.equal(replyTr.flags, MessageFlags.Ephemeral);
    assert.match(replyTr.content, /sadece \*\*Developer\*\* rolündekiler/);
    assert.equal(replyTr.content.includes('Zincir Sayaçları'), false, 'Hiçbir sistem verisi sızmamalı');

    let replyEn = null;
    await aktivitemCmd.handleActivityButton(
      {
        customId: `act_sys:${deniedMember.id}`,
        user: deniedMember.user,
        member: deniedMember,
        guild: env.guild,
        locale: 'en-US',
        reply: async (payload) => {
          replyEn = payload;
        },
      },
      { tracker, db: database }
    );
    assert.equal(replyEn.flags, MessageFlags.Ephemeral);
    assert.match(replyEn.content, /Only members with the \*\*Developer\*\* role/);
  }

  // Developer açtığında yeni mobil /oyun bilgilerini, 00:00 temizlik zamanlarını, ClearAll ve hazır rol sayısını görmeli (kimliksiz!)
  database.setManualActivityRole('gizli_uye_777', 'roblox', { immediate: true });
  let devReply = null;
  await aktivitemCmd.handleActivityButton(
    {
      customId: 'act_sys:u_dev',
      user: devM.user,
      member: devM,
      guild: env.guild,
      locale: 'tr',
      reply: async (payload) => {
        devReply = payload;
      },
    },
    { tracker, db: database }
  );
  assert.equal(devReply.flags, MessageFlags.Ephemeral);
  assert.ok(devReply.content.length <= 2000);
  assert.match(devReply.content, /✅ \*\*Mobil `\/oyun`:\*\* Hazır rol `4\/4` • Aktif manuel işaret: `1` • ClearAll: `Kapalı`/);
  assert.match(devReply.content, /🌙 \*\*00:00 Temizliği:\*\*/);
  assert.equal(devReply.content.includes('gizli_uye_777'), false, 'Sistem Durumu hiçbir kullanıcı ID içermemeli');

  // Eksik rol veya hiyerarşi sorununda ⚠️ görünmeli
  const lowBotEnv = createMockGuild({ botRolePos: 5 });
  const lowStatus = aktivitemCmd.buildSystemStatusPayload({
    guild: lowBotEnv.guild,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.match(lowStatus.content, /⚠️ \*\*Mobil `\/oyun`:\*\* Hazır rol `0\/4`/);

  await tracker.shutdown();
});

// =========================================================================
// 2. /oyun KOMUTU, BUTONLAR, COOLDOWN, HATA YÖNETİMİ VE SIFIR AKTARMA KONTROLÜ
// =========================================================================

test('2. /oyun komutu: TR/EN ephemeral (flags), 4 buton sırası/etiketi, ver/geri al, çoklu aile, hata/cooldown, takip kapalı erişimi ve AKTARMA YOK', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T15:00:00Z'));
  const warns = [];
  const logger = { log: () => {}, warn: (m) => warns.push(String(m)), error: () => {} };
  const env = createMockGuild();
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger,
  });
  tracker.guild = env.guild;

  // Slash komut tanımı ve yerelleştirme doğrulaması
  const cmdJson = oyunCmd.data.toJSON();
  assert.equal(cmdJson.name, 'oyun');
  assert.equal(cmdJson.name_localizations['en-US'], 'game');
  assert.equal(cmdJson.name_localizations['en-GB'], 'game');

  const mobileUser = env.makeMember('u_mob', { voiceChannel: env.lobbyChannel });
  const otherUser = env.makeMember('u_other');

  // 1) /oyun execute -> ephemeral (flags: MessageFlags.Ephemeral), 4 buton sırası (config'ten) ve gri durum
  let execReplyTr = null;
  await oyunCmd.execute({
    user: mobileUser.user,
    member: mobileUser,
    guild: env.guild,
    locale: 'tr',
    reply: async (p) => {
      execReplyTr = p;
    },
  });
  assert.equal(execReplyTr.flags, MessageFlags.Ephemeral);
  assert.match(execReplyTr.content, /Oyun Rolü \(Mobil\)/);
  assert.match(execReplyTr.content, /00:00/);
  assert.equal(execReplyTr.components.length, 1);
  const btns = execReplyTr.components[0].toJSON().components;
  assert.equal(btns.length, 4);
  assert.deepEqual(
    btns.map((b) => b.custom_id),
    ['act_gr:roblox:u_mob', 'act_gr:zula:u_mob', 'act_gr:minecraft:u_mob', 'act_gr:cs2:u_mob']
  );
  assert.deepEqual(
    btns.map((b) => b.label),
    ['🧱 Roblox', '🪖 Zula', '⛏️ Minecraft', '🎯 CS2']
  );
  assert.ok(btns.every((b) => b.style === ButtonStyle.Secondary));
  assert.ok(btns.every((b) => b.custom_id.length <= 100));

  // EN metin doğrulaması
  const enPanel = oyunCmd.buildManualGamePanelPayload({
    member: mobileUser,
    guild: env.guild,
    lang: 'en',
    tracker,
  });
  assert.match(enPanel.content, /Turkey time \(UTC\+3\)/);
  assert.match(enPanel.content, /does \*\*not\*\* move you to a voice channel/);

  // 2) Başkası tıklarsa reddedilir
  let stealReply = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_mob',
      user: otherUser.user,
      member: otherUser,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        stealReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(stealReply.flags, MessageFlags.Ephemeral);
  assert.match(stealReply.content, /Bu buton sana ait değil/);
  assert.equal(mobileUser.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);

  // 3) Roblox butonuna bas -> rol verilir, manuel işaret konur, düğme yeşil + ✅ olur
  let updateAfterGrant = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      update: async (p) => {
        updateAfterGrant = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(mobileUser.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  assert.equal(database.hasManualActivityRole('u_mob', 'roblox'), true);
  assert.equal(tracker.counters.manuelVerilen, 1);
  assert.match(updateAfterGrant.content, /Roblox.*rolün verildi/);
  const robloxBtnAfter = updateAfterGrant.components[0].toJSON().components[0];
  assert.equal(robloxBtnAfter.style, ButtonStyle.Success);
  assert.equal(robloxBtnAfter.label, '✅ 🧱 Roblox');

  // 4) 2 sn bekleme süresi (aynı ailede anında ikinci tıklama -> Biraz yavaş; başka aile CS2 hemen çalışır!)
  let cooldownReply = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        cooldownReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(cooldownReply.flags, MessageFlags.Ephemeral);
  assert.match(cooldownReply.content, /Biraz yavaş/);

  // Başka aile (CS2) aynı anda alınabilir (birden fazla aile)
  let updateCs2 = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:cs2:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      update: async (p) => {
        updateCs2 = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(mobileUser.roles.cache.has(activityConfig.FAMILIES.cs2.roleId), true);
  assert.equal(database.hasManualActivityRole('u_mob', 'cs2'), true);
  assert.equal(updateCs2.components[0].toJSON().components[0].style, ButtonStyle.Success);
  assert.equal(updateCs2.components[0].toJSON().components[3].style, ButtonStyle.Success);

  // 5) AKTARMA / OTURUM / SÜRE / KARAR İZİ / "ŞU AN OYNUYOR" HİÇ OLUŞMAMALI!
  await clock.advanceBy(30000);
  assert.equal(env.apiLog.moves.length, 0, '/oyun ses kanalına taşımamalı');
  assert.equal(env.apiLog.commandMessages.length, 0, '/oyun geri sayım mesajı atmamalı');
  assert.equal(mobileUser.voice.channelId, env.lobbyChannel.id);
  assert.equal(tracker.sessions.has('u_mob'), false, '/oyun tracker oturumu yaratmamalı');
  assert.deepEqual(database.getUserActivityStats('u_mob').games, {}, '/oyun süre yazmamalı');
  assert.equal(tracker.getLastDecision('u_mob'), null, '/oyun karar izine aktarma kodu yazmamalı');
  const summaryPayload = aktivitemCmd.buildActivitySummaryPayload({
    user: mobileUser.user,
    member: mobileUser,
    lang: 'tr',
    tracker,
    db: database,
  });
  assert.equal(summaryPayload.embeds[0].toJSON().description.includes('Şu an oynuyor'), false);

  // 6) Tekrar basınca (2 sn geçti) -> rol geri alınır, işaret silinir
  let updateAfterRevoke = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      update: async (p) => {
        updateAfterRevoke = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(mobileUser.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), false);
  assert.equal(database.hasManualActivityRole('u_mob', 'roblox'), false);
  assert.equal(tracker.counters.manuelGeriAlinan, 1);
  assert.match(updateAfterRevoke.content, /Roblox.*rolün geri alındı/);
  assert.equal(updateAfterRevoke.components[0].toJSON().components[0].style, ButtonStyle.Secondary);

  // CS2'yi de geri al -> boş kullanıcı kaydı activityManual.users'tan tamamen silinmeli
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:cs2:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      update: async () => {},
    },
    { tracker, db: database }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(database.data.activityManual.users, 'u_mob'), false);

  // 7) Rol zaten otomatik sistemce verilmişken basınca: roles.add çağrılmadan sadece işaret konur
  await mobileUser.roles.add(activityConfig.FAMILIES.zula.roleId);
  const addsBeforeAlready = env.apiLog.roleAdds.length;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:zula:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      update: async () => {},
    },
    { tracker, db: database }
  );
  assert.equal(env.apiLog.roleAdds.length, addsBeforeAlready, 'Rol zaten varken tekrar add çağrılmamalı');
  assert.equal(database.hasManualActivityRole('u_mob', 'zula'), true);

  // 8) Rol verme hatasında (50013 hiyerarşi) işaret KONMAMALI ve nazik hata dönmeli (uyarı saatte bir)
  const err50013 = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  env.setRoleAddError(err50013);
  let errReply = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:minecraft:u_mob',
      user: mobileUser.user,
      member: mobileUser,
      guild: env.guild,
      locale: 'tr',
      reply: async (p) => {
        errReply = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(errReply.flags, MessageFlags.Ephemeral);
  assert.match(errReply.content, /Rol verilemedi, yetkililere haber ver/);
  assert.equal(database.hasManualActivityRole('u_mob', 'minecraft'), false, 'Hata olursa manuel işaret konmamalı');
  env.setRoleAddError(null);

  // 9) Rol sunucuda yoksa buton devre dışı görünür, tıklamada nazik hata döner
  const missingEnv = createMockGuild({ missingFamilyRoles: ['zula'] });
  const mMiss = missingEnv.makeMember('u_miss');
  const missPanel = oyunCmd.buildManualGamePanelPayload({
    member: mMiss,
    guild: missingEnv.guild,
    lang: 'tr',
    tracker,
  });
  assert.equal(missPanel.components[0].toJSON().components[1].disabled, true);
  let missClick = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:zula:u_miss',
      user: mMiss.user,
      member: mMiss,
      guild: missingEnv.guild,
      locale: 'tr',
      reply: async (p) => {
        missClick = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(missClick.flags, MessageFlags.Ephemeral);
  assert.match(missClick.content, /Bu rol şu an kullanılamıyor/);

  // 10) Etkinlik takibi KAPALI (tracking: false) kullanıcı da /oyun butonunu kullanabilir
  const uNoTrack = env.makeMember('u_notrack');
  database.setActivityPrefs('u_notrack', { tracking: false });
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_notrack',
      user: uNoTrack.user,
      member: uNoTrack,
      guild: env.guild,
      locale: 'tr',
      update: async () => {},
    },
    { tracker, db: database }
  );
  assert.equal(uNoTrack.roles.cache.has(activityConfig.FAMILIES.roblox.roleId), true);
  assert.equal(database.hasManualActivityRole('u_notrack', 'roblox'), true);

  await tracker.shutdown();
});

// =========================================================================
// 3. OTOMATİK SİSTEMLE ETKİLEŞİM (MANUEL ROL ASLA OTOMATİK ALINMAZ)
// =========================================================================

test('3. Otomatik sistem etkileşimi: 5 dk temizlik, açılış temizliği, oyun bitişi, takip kapatma manuel rolü ALMAZ; Salon 1 dönüşü ve sunucudan çıkış doğru çalışır', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T16:00:00Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockGuild();
  const tracker = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  tracker.guild = env.guild;

  const robloxRole = activityConfig.FAMILIES.roblox.roleId;
  const cs2Role = activityConfig.FAMILIES.cs2.roleId;
  const zulaRole = activityConfig.FAMILIES.zula.roleId;
  const tsbCh = env.channels.get('1571912346773885050');

  // Üye: Roblox MANUEL işaretli, CS2 manuel DEĞİL
  const uMix = env.makeMember('u_mix', { roleIds: [robloxRole, cs2Role], voiceChannel: tsbCh });
  env.makePresence(uMix, [], { status: 'online' });
  database.setManualActivityRole('u_mix', 'roblox', { immediate: true });

  // a) 5 dakikalık periyodik rol temizliği -> CS2'yi alır, manuel Roblox'a DOKUNMAZ
  await tracker.runPeriodicRoleCleanup(env.guild);
  assert.equal(uMix.roles.cache.has(robloxRole), true, '5 dk temizlik manuel rolü almamalı');
  assert.equal(uMix.roles.cache.has(cs2Role), false, '5 dk temizlik manuel olmayan pasif rolü almalı');

  // b) Açılış 2 dk temizliği -> Zula'yı alır, manuel Roblox'a DOKUNMAZ
  await uMix.roles.add(zulaRole);
  await tracker.runStartupRoleCleanup(env.guild);
  assert.equal(uMix.roles.cache.has(robloxRole), true, 'Açılış temizliği manuel rolü almamalı');
  assert.equal(uMix.roles.cache.has(zulaRole), false, 'Açılış temizliği manuel olmayan rolü almalı');

  // c) Oyun bitiş akışı: Roblox oyunu bittiğinde manuel işaret varsa rol ALINMAZ ama Salon 1'e dönüş ÇALIŞIR!
  const pPlay = env.makePresence(uMix, [{ type: ActivityType.Playing, name: 'The Strongest Battlegrounds' }]);
  tracker.handlePresenceUpdate(null, pPlay);
  await clock.advanceBy(15000);

  // Canlı oturum varken /oyun'da Roblox'a tekrar basma -> işaret kalkar ama rol ALINMAZ (not gösterir)
  let liveRevokeUpdate = null;
  await oyunCmd.handleManualGameRoleButton(
    {
      customId: 'act_gr:roblox:u_mix',
      user: uMix.user,
      member: uMix,
      guild: env.guild,
      locale: 'tr',
      update: async (p) => {
        liveRevokeUpdate = p;
      },
    },
    { tracker, db: database }
  );
  assert.equal(database.hasManualActivityRole('u_mix', 'roblox'), false);
  assert.equal(uMix.roles.cache.has(robloxRole), true, 'Canlı oturum sürerken rol alınmamalı');
  assert.match(liveRevokeUpdate.content, /Oyunun algılanıyor, .*rolün oyunu bırakınca alınacak/);

  // Şimdi manuel işareti tekrar koyalım ve oyunu kapatalım -> rol KALMALI, Salon 1'e TAŞINMALI!
  database.setManualActivityRole('u_mix', 'roblox', { immediate: true });
  const pStop = env.makePresence(uMix, [], { status: 'online' });
  tracker.handlePresenceUpdate(pPlay, pStop);
  await clock.advanceBy(5000);
  assert.equal(uMix.roles.cache.has(robloxRole), true, 'Oyun bitişinde manuel işaretli rol alınmamalı');
  assert.equal(uMix.voice.channelId, activityConfig.RETURN_CHANNEL_ID, 'Salon 1 dönüşü manuel işaretten bağımsız çalışmalı');
  assert.equal(tracker.getLastDecision('u_mix')?.reason, TRANSFER_REASONS.RETURN_MOVED);

  // d) Takibi kapatma -> manuel olmayan Zula alınır, manuel Roblox KORUNUR
  await uMix.roles.add(zulaRole);
  await tracker.disableTrackingForUser('u_mix', uMix);
  assert.equal(uMix.roles.cache.has(robloxRole), true, 'Takip kapatılınca manuel role dokunulmamalı');
  assert.equal(uMix.roles.cache.has(zulaRole), false, 'Takip kapatılınca manuel olmayan rol alınmalı');

  // e) Sunucudan ayrılma -> manuel işaretler silinir
  tracker.handleMemberRemove(uMix);
  assert.equal(database.hasManualActivityRole('u_mix', 'roblox'), false);

  await tracker.shutdown();
});

// =========================================================================
// 4. GECE 00:00 (Europe/Istanbul) TEMİZLİĞİ, YENİDEN DENEME, CLEAR_ALL VE KALICILIK
// =========================================================================

test('4. Gece 00:00 (Europe/Istanbul) temizliği: 23:59:59 bekleme, 00:00 silme, canlı oturum koruma, kapalıyken açılışta temizlik, idempotent kilit, 10 yeniden deneme ve MANUAL_CLEAR_ALL', async () => {
  // 2026-11-22 23:59:59 Europe/Istanbul = 2026-11-22T20:59:59.000Z
  const clock = createFakeClock(Date.parse('2026-11-22T20:59:59.000Z'));
  const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };
  const env = createMockGuild();

  database.data.activityManual = { day: '2026-11-22', users: {} };
  database.save();

  const tracker = new ActivityTracker({
    config: makeTestConfig({ MANUAL_CLEAR_ALL_ACTIVITY_ROLES: false }),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });

  const robloxRole = activityConfig.FAMILIES.roblox.roleId;
  const cs2Role = activityConfig.FAMILIES.cs2.roleId;
  const zulaRole = activityConfig.FAMILIES.zula.roleId;

  // uManual: Manuel Roblox rolü var, canlı oturumu yok -> 00:00'da rolü ALINMALI
  const uManual = env.makeMember('u_man', { roleIds: [robloxRole] });
  database.setManualActivityRole('u_man', 'roblox', { day: '2026-11-22', immediate: true });

  // uLive: Manuel CS2 rolü var AMA şu an canlı CS2 oynuyor -> 00:00'da rolü KALMALI, sadece manuel işareti silinmeli
  const uLive = env.makeMember('u_live', { roleIds: [cs2Role] });
  env.makePresence(uLive, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]);
  database.setManualActivityRole('u_live', 'cs2', { day: '2026-11-22', immediate: true });

  // uNoRole: Manuel işareti var ama rol zaten elle alınmış -> hata vermeden işareti silinmeli
  env.makeMember('u_norole', { roleIds: [] });
  database.setManualActivityRole('u_norole', 'zula', { day: '2026-11-22', immediate: true });

  // uLeft: Sunucudan ayrılmış eski ID -> hata vermeden işareti silinmeli
  database.setManualActivityRole('u_left_guild', 'roblox', { day: '2026-11-22', immediate: true });

  // uOtherAuto: Manuel işareti YOK ama Zula rolü var -> MANUAL_CLEAR_ALL_ACTIVITY_ROLES=false iken KALMALI
  const uOtherAuto = env.makeMember('u_other_auto', { roleIds: [zulaRole] });

  await tracker.initForGuild(env.guild);

  // 23:59:59 -> henüz 00:00 olmadı, hiçbir şey silinmemeli!
  assert.equal(uManual.roles.cache.has(robloxRole), true);
  assert.equal(database.data.activityManual.day, '2026-11-22');

  // 1 saniye ilerlet -> tam 2026-11-23 00:00:00 Europe/Istanbul!
  await clock.advanceBy(1000);

  assert.equal(uManual.roles.cache.has(robloxRole), false, '00:00\'da manuel rol alınmalı');
  assert.equal(database.hasManualActivityRole('u_man', 'roblox'), false);
  assert.equal(uLive.roles.cache.has(cs2Role), true, 'Canlı oturumu olan üyenin rolü alınmamalı');
  assert.equal(database.hasManualActivityRole('u_live', 'cs2'), false, 'Canlı oturumlu üyenin manuel işareti silinmeli');
  assert.equal(database.hasManualActivityRole('u_norole', 'zula'), false);
  assert.equal(database.hasManualActivityRole('u_left_guild', 'roblox'), false);
  assert.equal(uOtherAuto.roles.cache.has(zulaRole), true, 'CLEAR_ALL kapalıyken manuel olmayan rol kalmalı');
  assert.equal(database.data.activityManual.day, '2026-11-23', 'day yeni güne güncellenmeli');
  assert.equal(env.apiLog.commandMessages.length, 0, 'Gece temizliği hiç mesaj atmamalı');
  assert.equal(tracker.counters.geceTemizligiAlinan, 1);

  // Çift zamanlayıcı (eşzamanlı çağrı) tek sefer çalışmalı (idempotent)
  database.setManualActivityRole('u_man', 'roblox', { immediate: true });
  await uManual.roles.add(robloxRole);
  database.data.activityManual.day = '2026-11-22';
  const remBefore = env.apiLog.roleRemoves.length;
  await Promise.all([
    tracker.runMidnightManualCleanup(env.guild),
    tracker.runMidnightManualCleanup(env.guild),
  ]);
  assert.equal(env.apiLog.roleRemoves.length - remBefore, 1, 'Eşzamanlı gece temizliği tek sefer çalışmalı');

  // Geçici hata yeniden denemesi: en çok 10 kez dener (yeni günün taze işaretine dokunmaz!), 10. hatadan sonra işareti bırakır
  const uRetry = env.makeMember('u_retry', { roleIds: [robloxRole] });
  const uFreshToday = env.makeMember('u_fresh', { roleIds: [cs2Role] });
  database.setManualActivityRole('u_retry', 'roblox', { immediate: true });
  database.data.activityManual.day = '2026-11-22';
  env.setRoleRemoveError(new Error('Temporary 503'));

  // 1. deneme (gün dönümü)
  await tracker.runMidnightManualCleanup(env.guild);
  assert.equal(database.data.activityManual.day, '2026-11-23');
  assert.equal(database.hasManualActivityRole('u_retry', 'roblox'), true, '1. hatada işaret retry için kalmalı');

  // Yeni gün içinde başka bir kullanıcı taze manuel rol alır -> retry turları ona DOKUNMAMALI!
  database.setManualActivityRole('u_fresh', 'cs2', { immediate: true });

  // 2..9. denemeler (8 kez 60 sn ileri)
  for (let i = 0; i < 8; i++) {
    await clock.advanceBy(60000);
    assert.equal(database.hasManualActivityRole('u_retry', 'roblox'), true);
    assert.equal(database.hasManualActivityRole('u_fresh', 'cs2'), true, 'Taze bugünkü işarete dokunulmamalı');
  }
  // 10. deneme -> üst sınıra ulaştı -> işaret bırakılır!
  await clock.advanceBy(60000);
  assert.equal(database.hasManualActivityRole('u_retry', 'roblox'), false, '10 başarısız denemeden sonra işaret bırakılmalı');
  assert.equal(database.hasManualActivityRole('u_fresh', 'cs2'), true, 'Taze bugünkü işaret hâlâ korunmalı');
  assert.equal(uFreshToday.roles.cache.has(cs2Role), true);
  assert.equal(tracker.counters.geceTemizligiBasarisiz, 10);
  env.setRoleRemoveError(null);
  await tracker.shutdown();

  // Bot gece kapalıydıysa açılışta (initForGuild) eski gün temizlenmeli + MANUAL_CLEAR_ALL_ACTIVITY_ROLES: true testi
  const envClearAll = createMockGuild();
  const uOldMan = envClearAll.makeMember('u_old_man', { roleIds: [robloxRole] });
  const uNonMan = envClearAll.makeMember('u_non_man', { roleIds: [zulaRole] });
  const uLiveKeep = envClearAll.makeMember('u_live_keep', { roleIds: [cs2Role] });
  envClearAll.makePresence(uLiveKeep, [{ type: ActivityType.Playing, name: 'Counter-Strike 2' }]);

  database.data.activityManual = { day: '2026-11-21', users: { u_old_man: { roblox: true } } };
  database.save();

  const trackerClearAll = new ActivityTracker({
    config: makeTestConfig({ MANUAL_CLEAR_ALL_ACTIVITY_ROLES: true }),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger: silentLogger,
  });
  await trackerClearAll.initForGuild(envClearAll.guild);

  assert.equal(uOldMan.roles.cache.has(robloxRole), false, 'Açılışta eski gün manuel rolü temizlenmeli');
  assert.equal(uNonMan.roles.cache.has(zulaRole), false, 'CLEAR_ALL açıkken canlı oturumsuz diğer rol de alınmalı');
  assert.equal(uLiveKeep.roles.cache.has(cs2Role), true, 'CLEAR_ALL açıkken canlı oturumlu rol korunmalı');
  assert.equal(database.data.activityManual.day, '2026-11-23');

  await trackerClearAll.shutdown();
});

// =========================================================================
// 5. KALICILIK, TEK SEFERLİK DUYURU VE GİZLİLİK KONTROLÜ
// =========================================================================

test('5. Kalıcılık (activityManual + manualAnnouncedAt), tek seferlik etiketsiz duyuru (hata sonrası tekrar) ve gizlilik/log denetimi', async () => {
  const clock = createFakeClock(Date.parse('2026-11-22T18:00:00Z'));
  const logs = [];
  const logger = {
    log: (m) => logs.push(String(m)),
    warn: (m) => logs.push(String(m)),
    error: (m) => logs.push(String(m)),
  };

  // 1) activityManual kaydet-yükle testi
  database.data.activityManual = { day: '2026-11-22', users: {} };
  database.setManualActivityRole('888777666555', 'minecraft', { immediate: false });
  database.flushDirty();
  database.data.activityManual = { day: '1999-01-01', users: {} };
  database.init();
  assert.equal(database.data.activityManual.day, '2026-11-22');
  assert.equal(database.hasManualActivityRole('888777666555', 'minecraft'), true);

  // 2) Tek seferlik duyuru: hata olursa işaretlenmez, sonra gönderilince işaretlenir ve tekrar gitmez
  database.data.activityMeta.manualAnnouncedAt = null;
  database.save();

  const failEnv = createMockGuild({ commandChannelCanSend: false });
  const tFail = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger,
  });
  const failRes = await tFail.checkOneTimeManualAnnouncement(failEnv.guild);
  assert.equal(failRes.announced, false);
  assert.equal(database.getActivityMeta().manualAnnouncedAt, null);
  await tFail.shutdown();

  const okEnv = createMockGuild();
  const tOk = new ActivityTracker({
    config: makeTestConfig(),
    db: database,
    nowFn: clock.nowFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    logger,
  });
  await tOk.initForGuild(okEnv.guild);
  assert.equal(okEnv.apiLog.commandMessages.length, 1);
  assert.deepEqual(okEnv.apiLog.commandMessages[0].allowedMentions, { parse: [] });
  assert.match(okEnv.apiLog.commandMessages[0].content, /\/oyun/);
  assert.match(okEnv.apiLog.commandMessages[0].content, /\/game/);
  assert.ok(typeof database.getActivityMeta().manualAnnouncedAt === 'number');

  // Diskten yeniden yükle -> manualAnnouncedAt korunmalı ve tekrar gönderilmemeli
  database.data.activityMeta.manualAnnouncedAt = null;
  database.init();
  assert.ok(typeof database.getActivityMeta().manualAnnouncedAt === 'number');
  const secondRes = await tOk.checkOneTimeManualAnnouncement(okEnv.guild);
  assert.equal(secondRes.announced, false);
  assert.equal(okEnv.apiLog.commandMessages.length, 1);

  // 3) Konsol loglarında kimlik yok; diskte oyun geçmişi / karar izi yok
  tOk.logCounterSummary('test');
  assert.equal(logs.join('\n').includes('888777666555'), false, 'Konsol logunda kullanıcı ID bulunmamalı');

  database.save();
  const diskData = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'database.json'), 'utf8'));
  assert.equal(diskData.activityHistory, undefined);
  assert.equal(diskData.lastDecisions, undefined);
  assert.equal(diskData.manualHistory, undefined);
  assert.ok(diskData.activityManual && diskData.activityMeta);

  await tOk.shutdown();
});
