const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionFlagsBits } = require('discord.js');

// Testler için izole geçici veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-i18n-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.GUILD_ID = '1559313292651008040';

const config = require('../config');
const database = require('../src/utils/database');
const i18n = require('../src/utils/i18n');
const robloxService = require('../src/services/roblox');
const interactionHandler = require('../src/events/interactionCreate');
const dilCmd = require('../src/commands/dil');
const dilSifirlaCmd = require('../src/commands/dilSifirla');
const { createRegisterPanel } = require('../src/utils/panel');

const origResolveUser = robloxService.resolveUser.bind(robloxService);

function createMockGuildEnvironment() {
  const guildRoles = new Collection();
  const auditLogs = [];

  const enRole = {
    id: 'role_english_999',
    name: '🇬🇧 English',
    members: new Collection(),
  };
  guildRoles.set(enRole.id, enRole);

  const devRole = {
    id: config.ROLES.DEVELOPER,
    name: 'Developer',
  };
  guildRoles.set(devRole.id, devRole);

  const membersMap = new Collection();

  const auditChannelId = config.CHANNELS.WEB_AUDIT_LOG || config.CHANNELS.WARNING_LOG;
  const auditChannel = {
    id: auditChannelId,
    send: async (payload) => {
      auditLogs.push(payload);
      return { id: `log_${auditLogs.length}` };
    },
  };

  const guild = {
    id: config.GUILD_ID,
    roles: {
      cache: guildRoles,
      create: async (opts) => {
        const created = { id: 'role_english_created', name: opts.name, members: new Collection() };
        guildRoles.set(created.id, created);
        return created;
      },
    },
    channels: {
      cache: new Collection([[auditChannel.id, auditChannel]]),
      fetch: async (id) => (id === auditChannel.id ? auditChannel : null),
    },
    members: {
      cache: membersMap,
      fetch: async (id) => membersMap.get(id) || null,
    },
  };

  function makeMember(id, { roles = [], throwOnRoleEdit = false, isAdmin = false } = {}) {
    const roleMap = new Collection(roles.map((r) => [r.id, r]));
    const member = {
      id,
      guild,
      displayName: `user_${id}`,
      user: {
        id,
        username: `user_${id}`,
        tag: `user_${id}#0001`,
        send: async () => ({}),
      },
      roles: {
        cache: roleMap,
        add: async (roleId) => {
          if (throwOnRoleEdit) throw new Error('Missing Permissions');
          const r = guildRoles.get(roleId) || { id: roleId, name: roleId };
          roleMap.set(roleId, r);
          if (r.members) r.members.set(id, member);
        },
        remove: async (roleId) => {
          if (throwOnRoleEdit) throw new Error('Missing Permissions');
          roleMap.delete(roleId);
          const r = guildRoles.get(roleId);
          if (r && r.members) r.members.delete(id);
        },
      },
      permissions: {
        has: (perm) => (perm === PermissionFlagsBits.Administrator ? isAdmin : false),
      },
    };
    for (const r of roles) {
      if (r.members) r.members.set(id, member);
    }
    membersMap.set(id, member);
    return member;
  }

  return { guild, enRole, devRole, auditLogs, makeMember };
}

test.beforeEach(() => {
  database.data.languagePrefs = {};
  database.data.localeHints = {};
  database.data.registrations = [];
  database.data.activeApplications = {};
  database.data.rejectedApplications = {};
  database.data.englishRoleId = null;
  database.save();
  dilCmd.resetDilCooldowns();
  robloxService.resolveUser = origResolveUser;
});

test.after(() => {
  robloxService.resolveUser = origResolveUser;
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

test('1. Eski (legacy) string languagePrefs yükleme göçü ve veri kaybı olmaması', () => {
  const dbFile = path.join(tempDataDir, 'database.json');
  const seed = {
    registrations: [{ discordId: 'reg_1', displayName: 'Kayıtlı' }],
    activeApplications: {},
    rejectedApplications: {},
    warnings: [],
    languagePrefs: {
      legacy_en: 'en',
      legacy_tr: 'tr',
      manual_en: { lang: 'en', source: 'manual', updatedAt: 1700000000000 },
    },
    englishRoleId: '123456',
  };
  fs.writeFileSync(dbFile, JSON.stringify(seed, null, 2), 'utf8');

  database.init();

  assert.deepEqual(database.getUserLangInfo('legacy_en'), {
    lang: 'en',
    source: 'legacy',
    updatedAt: null,
  });
  assert.deepEqual(database.getUserLangInfo('legacy_tr'), {
    lang: 'tr',
    source: 'legacy',
    updatedAt: null,
  });
  assert.deepEqual(database.getUserLangInfo('manual_en'), {
    lang: 'en',
    source: 'manual',
    updatedAt: 1700000000000,
  });
  assert.equal(database.getUserLang('legacy_en'), 'en');
  assert.equal(database.getLegacyLangCount(), 2);
  assert.equal(database.data.registrations.length, 1);
  assert.equal(database.data.registrations[0].discordId, 'reg_1');
});

test('2. resolveLang 6 kademeli öncelik sırası ve SIFIR veritabanı yazımı (yan etkisiz)', () => {
  const { guild, enRole, makeMember } = createMockGuildEnvironment();

  // Casus (spy): resolveLang ASLA DB'ye yazmamalı
  const origSetUserLang = database.setUserLang.bind(database);
  const origSave = database.save.bind(database);
  let writeCount = 0;

  database.setUserLang('u_manual_tr', 'tr', 'manual');
  database.setUserLang('u_legacy_en', 'en', 'legacy');
  database.setLocaleHint('u_hint_en', 'en');
  database.setLocaleHint('u_hint_and_legacy', 'tr');
  database.setUserLang('u_hint_and_legacy', 'en', 'legacy');

  const memberWithEnRoleOnly = makeMember('u_role_only', { roles: [enRole] });

  database.setUserLang = (...args) => {
    writeCount += 1;
    return origSetUserLang(...args);
  };
  database.save = (...args) => {
    writeCount += 1;
    return origSave(...args);
  };

  try {
    // 1. sessionLang her zaman kazanır
    assert.equal(
      i18n.resolveLang({ user: { id: 'u_manual_tr' }, locale: 'tr' }, 'en'),
      'en'
    );

    // 2. manual > locale
    assert.equal(
      i18n.resolveLang({ user: { id: 'u_manual_tr' }, locale: 'en-US' }),
      'tr'
    );

    // 3. interaction.locale > localeHints & legacy
    assert.equal(
      i18n.resolveLang({ user: { id: 'u_legacy_en' }, locale: 'tr' }),
      'tr'
    );
    assert.equal(
      i18n.resolveLang({ user: { id: 'u_new' }, locale: 'en-GB' }),
      'en'
    );

    // 4. locale yoksa localeHints > legacy
    assert.equal(i18n.resolveLang('u_hint_en'), 'en');
    assert.equal(i18n.resolveLang('u_hint_and_legacy'), 'tr');

    // 5. manual/locale/hint yoksa legacy
    assert.equal(i18n.resolveLang('u_legacy_en'), 'en');

    // 6. Hiçbiri yoksa varsayılan 'tr' (English rolüne SAHİP olsa bile rol kaynak alınmaz!)
    assert.equal(i18n.resolveLang({ user: memberWithEnRoleOnly.user, member: memberWithEnRoleOnly, guild }), 'tr');

    assert.equal(writeCount, 0, 'resolveLang hiçbir durumda veritabanına yazmamalı!');
  } finally {
    database.setUserLang = origSetUserLang;
    database.save = origSave;
  }
});

test('3. Legacy + locale:tr otomatik iyileştirme vs en-US ve manual dokunulmazlığı', async () => {
  const { enRole, makeMember } = createMockGuildEnvironment();

  const legTrMember = makeMember('leg_tr_1', { roles: [enRole] });
  database.setUserLang('leg_tr_1', 'en', 'legacy');

  const legEnMember = makeMember('leg_en_1', { roles: [enRole] });
  database.setUserLang('leg_en_1', 'en', 'legacy');

  const manEnMember = makeMember('man_en_1', { roles: [enRole] });
  database.setUserLang('man_en_1', 'en', 'manual');

  // Legacy + locale='tr' -> sessizce iyileştirilir ve English rolü kaldırılır
  const healRes = await i18n.healLegacyLanguageOnInteraction({
    user: legTrMember.user,
    member: legTrMember,
    locale: 'tr',
  });
  assert.equal(healRes.healed, true);
  assert.equal(healRes.removedRole, true);
  assert.equal(legTrMember.roles.cache.has(enRole.id), false);
  assert.equal(database.getUserLangInfo('leg_tr_1').lang, 'tr');
  assert.equal(database.getUserLangInfo('leg_tr_1').source, 'legacy');

  // Legacy + locale='en-US' -> dokunulmaz
  const enRes = await i18n.healLegacyLanguageOnInteraction({
    user: legEnMember.user,
    member: legEnMember,
    locale: 'en-US',
  });
  assert.equal(enRes.healed, false);
  assert.equal(legEnMember.roles.cache.has(enRole.id), true);
  assert.equal(database.getUserLangInfo('leg_en_1').lang, 'en');

  // Manual 'en' + locale='tr' -> dokunulmaz
  const manRes = await i18n.healLegacyLanguageOnInteraction({
    user: manEnMember.user,
    member: manEnMember,
    locale: 'tr',
  });
  assert.equal(manRes.healed, false);
  assert.equal(manEnMember.roles.cache.has(enRole.id), true);
  assert.equal(database.getUserLangInfo('man_en_1').lang, 'en');
  assert.equal(database.getUserLangInfo('man_en_1').source, 'manual');
});

test('4. btn_kayit_ol_en + reg_lang: akış içi gidiş-dönüş çevirisi ve kalıcı yazmama', async () => {
  const { guild, enRole, makeMember } = createMockGuildEnvironment();
  const applicant = makeMember('app_lang_1');

  // Panelde her iki buton ve yönlendirme notu bulunmalı
  const panelPayload = createRegisterPanel();
  const panelBtns = panelPayload.components[0].toJSON().components;
  assert.equal(panelBtns[0].custom_id, 'btn_kayit_ol');
  assert.equal(panelBtns[1].custom_id, 'btn_kayit_ol_en');

  // 1) "🇬🇧 Register (English)" tıklanınca EN oyun seçimi açılır ama DB/Rol YAZILMAZ
  let step1Reply = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'btn_kayit_ol_en',
    locale: 'tr',
    user: applicant.user,
    member: applicant,
    guild,
    reply: async (p) => {
      step1Reply = p;
    },
  });

  assert.ok(step1Reply);
  assert.match(step1Reply.content, /Select the games you play/);
  assert.ok(step1Reply.components.length <= 5);
  assert.equal(database.getUserLangInfo('app_lang_1'), null, 'btn_kayit_ol_en DB ye yazmamalı');
  assert.equal(applicant.roles.cache.has(enRole.id), false, 'btn_kayit_ol_en English rolü vermemeli');

  // Dil butonu customId uzunluğu <= 100 kontrolü
  const langBtn1 = step1Reply.components[2].toJSON().components[0];
  assert.equal(langBtn1.custom_id, 'reg_lang:g:0:-:tr');
  assert.ok(langBtn1.custom_id.length <= 100);

  // 2) Roblox + CS2 seçildikten sonra (mask=3) "🇹🇷 Türkçe" dil butonuna basılırsa mask=3 korunur
  let updatedToTr = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_lang:g:3:-:tr',
    locale: 'tr',
    user: applicant.user,
    member: applicant,
    guild,
    update: async (p) => {
      updatedToTr = p;
    },
  });
  assert.match(updatedToTr.content, /Oynadığın oyunları seç/);
  assert.match(updatedToTr.content, /Roblox/);
  assert.match(updatedToTr.content, /CS2/);
  assert.equal(updatedToTr.components[2].toJSON().components[0].custom_id, 'reg_lang:g:3:-:en');

  // 3) Cinsiyet seçiminde EN -> TR -> EN gidiş dönüş
  let genderEn = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_lang:s:3:-:en',
    locale: 'tr',
    user: applicant.user,
    member: applicant,
    guild,
    update: async (p) => {
      genderEn = p;
    },
  });
  assert.equal(genderEn.components.length, 2);
  assert.equal(genderEn.components[0].toJSON().components[0].custom_id, 'reg_gender:3:en');
  assert.equal(genderEn.components[1].toJSON().components[0].custom_id, 'reg_lang:s:3:-:tr');

  // 4) Modal hatası (ROBLOX_NOT_FOUND) sonrası reg_lang:r:... hem mesajı hem reg_retry'yi çevirir + draft korunur
  robloxService.resolveUser = async () => ({ success: false, error: 'NOT_FOUND', message: 'Yok' });
  let errorEnReply = null;
  await interactionHandler.handleRegistrationModalSubmit({
    customId: 'reg_form:3:f:en',
    user: applicant.user,
    member: applicant,
    guild,
    fields: {
      getTextInputValue: (cid) => (cid === 'f_name' ? 'Ece' : cid === 'f_roblox' ? 'NoRoblox123' : 'EceCS2'),
    },
    deferReply: async () => {},
    editReply: async (p) => {
      errorEnReply = p;
    },
  });
  assert.match(errorEnReply.content, /No Roblox account was found/);
  assert.equal(errorEnReply.components.length, 1);
  assert.equal(errorEnReply.components[0].toJSON().components[0].custom_id, 'reg_retry:3:f:en');
  assert.equal(errorEnReply.components[0].toJSON().components[1].custom_id, 'reg_lang:r:3:f:tr');

  // Türkçe'ye çevir
  let errorTrUpdate = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_lang:r:3:f:tr',
    locale: 'tr',
    user: applicant.user,
    member: applicant,
    guild,
    update: async (p) => {
      errorTrUpdate = p;
    },
  });
  assert.match(errorTrUpdate.content, /hesap bulunamadı/);
  assert.equal(errorTrUpdate.components[0].toJSON().components[0].custom_id, 'reg_retry:3:f:tr');
  assert.equal(errorTrUpdate.components[0].toJSON().components[1].custom_id, 'reg_lang:r:3:f:en');

  // Tekrar dene butonuna basınca modal Türkçe başlıkla ve önceden doldurulmuş değerlerle açılmalı
  let retriedModal = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_retry:3:f:tr',
    user: applicant.user,
    member: applicant,
    guild,
    showModal: async (m) => {
      retriedModal = m.toJSON();
    },
  });
  assert.equal(retriedModal.custom_id, 'reg_form:3:f:tr');
  assert.equal(retriedModal.components[0].components[0].value, 'Ece');
  assert.equal(retriedModal.components[1].components[0].value, 'NoRoblox123');
  assert.equal(retriedModal.components[2].components[0].value, 'EceCS2');

  // Tüm kayıt boyunca DB'de hala manual kayıt olmamalı
  assert.equal(database.getUserLangInfo('app_lang_1'), null);
});

test('5. /dil (/language) komutu: tr, en, auto, rol hata dayanıklılığı ve 10 sn cooldown', async () => {
  const { enRole, makeMember } = createMockGuildEnvironment();
  const member = makeMember('dil_user_1');
  let lastReply = null;

  const makeCommandInteraction = (choice, locale = 'tr', targetMember = member) => ({
    user: targetMember.user,
    member: targetMember,
    locale,
    options: { getString: () => choice },
    reply: async (p) => {
      lastReply = p;
    },
  });

  // 1) /dil en
  await dilCmd.execute(makeCommandInteraction('en', 'tr'));
  assert.equal(database.getUserLangInfo('dil_user_1').lang, 'en');
  assert.equal(database.getUserLangInfo('dil_user_1').source, 'manual');
  assert.equal(member.roles.cache.has(enRole.id), true);
  assert.match(lastReply.content, /English/);

  // 2) Cooldown kontrolü (10 sn dolmadan ikinci çağrı engellenir)
  await dilCmd.execute(makeCommandInteraction('tr', 'tr'));
  assert.match(lastReply.content, /wait|bekle/i);
  assert.equal(database.getUserLangInfo('dil_user_1').lang, 'en');

  // 3) Cooldown sıfırlanıp /dil tr
  dilCmd.resetDilCooldowns();
  await dilCmd.execute(makeCommandInteraction('tr', 'en-US'));
  assert.equal(database.getUserLangInfo('dil_user_1').lang, 'tr');
  assert.equal(database.getUserLangInfo('dil_user_1').source, 'manual');
  assert.equal(member.roles.cache.has(enRole.id), false);
  assert.match(lastReply.content, /Türkçe/);

  // 4) /dil auto -> DB kaydını siler ve Discord dilini uygular
  dilCmd.resetDilCooldowns();
  await dilCmd.execute(makeCommandInteraction('en', 'tr')); // önce rol verilsin
  assert.equal(member.roles.cache.has(enRole.id), true);

  dilCmd.resetDilCooldowns();
  await dilCmd.execute(makeCommandInteraction('auto', 'tr'));
  assert.equal(database.getUserLangInfo('dil_user_1'), null);
  assert.equal(member.roles.cache.has(enRole.id), false);
  assert.match(lastReply.content, /otomatik|Discord/i);

  // 5) Rol verme yetkisi hatasında kullanıcı yine de hata görmemeli, DB güncellenmeli
  const restrictedMember = makeMember('dil_user_noperm', { throwOnRoleEdit: true });
  dilCmd.resetDilCooldowns();
  await dilCmd.execute(makeCommandInteraction('en', 'tr', restrictedMember));
  assert.equal(database.getUserLangInfo('dil_user_noperm').lang, 'en');
  assert.equal(database.getUserLangInfo('dil_user_noperm').source, 'manual');
  assert.match(lastReply.content, /English/);
});

test('6. /dil-sifirla komutu: yetki, veritabanı/rol temizliği ve denetim logu', async () => {
  const { guild, enRole, devRole, auditLogs, makeMember } = createMockGuildEnvironment();

  const regularMember = makeMember('reg_actor');
  const devMember = makeMember('dev_actor', { roles: [devRole] });
  const targetMember = makeMember('target_user', { roles: [enRole] });
  database.setUserLang('target_user', 'en', 'manual');

  let replyPayload = null;

  // Yetkisiz çağrı
  await dilSifirlaCmd.execute({
    user: regularMember.user,
    member: regularMember,
    guild,
    options: { getUser: () => targetMember.user },
    reply: async (p) => {
      replyPayload = p;
    },
  });
  assert.match(replyPayload.content, /Developer|Yönetmenlik/);
  assert.notEqual(database.getUserLangInfo('target_user'), null);

  // Yetkili çağrı
  await dilSifirlaCmd.execute({
    user: devMember.user,
    member: devMember,
    guild,
    options: { getUser: () => targetMember.user },
    reply: async (p) => {
      replyPayload = p;
    },
  });

  assert.equal(database.getUserLangInfo('target_user'), null);
  assert.equal(targetMember.roles.cache.has(enRole.id), false);
  assert.match(replyPayload.content, /sıfırlandı/);
  assert.equal(auditLogs.length, 1, 'Denetim log kanalına 1 kayıt atılmalı');
});

test('7. Renk Rehberi EN & Uyarı Log EN butonları kalıcı dil yazmamalı + precheck reg_lang + açılış raporu', async () => {
  const { guild, enRole, makeMember } = createMockGuildEnvironment();
  const member = makeMember('color_user_1');
  let colorReply = null;

  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'btn_color_en_info',
    locale: 'tr',
    user: member.user,
    member,
    guild,
    reply: async (p) => {
      colorReply = p;
    },
  });

  assert.ok(colorReply?.embeds?.length === 1);
  assert.equal(database.getUserLangInfo('color_user_1'), null);
  assert.equal(member.roles.cache.has(enRole.id), false);

  // Uyarı log "🇬🇧 English" butonu (ağ çağrısı olmadan çeviri fallback ile test)
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => [[['Translated title']]],
  });
  let warnReply = null;
  try {
    await interactionHandler.execute({
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'btn_warn_log_en_9999',
      locale: 'tr',
      user: member.user,
      member,
      guild,
      message: { embeds: [{ title: 'Uyarı Kaydı', description: 'Deneme', fields: [], footer: { text: '' } }] },
      deferReply: async () => {},
      editReply: async (p) => {
        warnReply = p;
      },
    });
  } finally {
    global.fetch = origFetch;
  }
  assert.ok(warnReply);
  assert.equal(database.getUserLangInfo('color_user_1'), null);
  assert.equal(member.roles.cache.has(enRole.id), false);

  // Ön kontrol (p0: Zaten kayıtlı) dil değiştirme butonu
  let p0En = null;
  await interactionHandler.execute({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'reg_lang:p0:0:-:en',
    locale: 'tr',
    user: member.user,
    member,
    guild,
    update: async (p) => {
      p0En = p;
    },
  });
  assert.match(p0En.content, /already registered/);
  assert.equal(p0En.components[0].toJSON().components[0].custom_id, 'reg_lang:p0:0:-:tr');

  database.setUserLang('legacy_count_1', 'en', 'legacy');
  const stats = i18n.logLanguageStartupStats(guild);
  assert.equal(stats.legacyCount, 1);
  assert.equal(stats.englishRoleCount, 0);
});
