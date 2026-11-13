const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeClanName,
  normalizeClanName,
  similarity,
  isSafeClanRole,
  resolveClan,
} = require('../src/utils/clanMatcher');

test('clanMatcher - Sanitize: Temel temizlik, mention, url, küfür ve anlamsız girdiler', () => {
  // Boş ve geçersiz
  assert.equal(sanitizeClanName('').valid, false);
  assert.equal(sanitizeClanName(' ').valid, false);
  assert.equal(sanitizeClanName(null).valid, false);
  assert.equal(sanitizeClanName('a').valid, false); // < 2

  // Anlamsız girdiler ("yok", "none", "klanım yok", "n/a")
  assert.equal(sanitizeClanName('yok').valid, false);
  assert.equal(sanitizeClanName('none').valid, false);
  assert.equal(sanitizeClanName('-').valid, false);
  assert.equal(sanitizeClanName('klanım yok').valid, false);
  assert.equal(sanitizeClanName('no clan').valid, false);
  assert.equal(sanitizeClanName('n/a').valid, false);
  assert.equal(sanitizeClanName('---').valid, false);
  assert.equal(sanitizeClanName('12345').valid, false); // harf yok

  // Mention ve URL engeli
  assert.equal(sanitizeClanName('@everyone').valid, false);
  assert.equal(sanitizeClanName('test @here').valid, false);
  assert.equal(sanitizeClanName('<@123456789>').valid, false);
  assert.equal(sanitizeClanName('<#123456789>').valid, false);
  assert.equal(sanitizeClanName('https://discord.gg/test').valid, false);
  assert.equal(sanitizeClanName('discord.gg/abc').valid, false);

  // Başarılı girdi ve 32 karakter sınırı
  const res = sanitizeClanName('  [DW]  Dark Wolves Clan 🔥  ');
  assert.equal(res.valid, true);
  assert.ok(res.cleanName.length <= 32);
});

test('clanMatcher - Normalize: Temsiller, Türkçe karakterler, tag ve tekrar harf sadeleştirme', () => {
  const norm1 = normalizeClanName('[DW] Dark Wolves');
  assert.equal(norm1.full, 'dw dark wolves');
  assert.equal(norm1.compact, 'dwdarkwolves');
  assert.equal(norm1.tag, 'DW');

  const normTR = normalizeClanName('PİYADE İĞÜŞÖÇ');
  assert.equal(normTR.compact, 'piyadeigusoc');

  const normRepeat = normalizeClanName('Piyadeeeee');
  assert.equal(normRepeat.compact, 'piyadee');
});

test('clanMatcher - Similarity: Metrikler ve Sınırlar', () => {
  // Tam eşitlik
  assert.equal(similarity('Dark Wolves', 'dark wolves'), 1.0);
  assert.equal(similarity('PİYADE', 'piyade'), 1.0);

  // "Team 2" ile "Team 3" ASLA eşleşmemeli (en fazla 0.60)
  const scoreTeams = similarity('Team 2', 'Team 3');
  assert.ok(scoreTeams <= 0.60, `Team 2 vs Team 3 puanı ${scoreTeams} <= 0.60 olmalı`);

  // "DW" (kısa) ile "Dark Wolves" eşleşmemeli
  const scoreShort = similarity('DW', 'Dark Wolves');
  assert.ok(scoreShort < 0.80, `DW vs Dark Wolves puanı ${scoreShort} < 0.80 olmalı`);

  // "Dark Wolfs" vs "Dark Wolves" en az suggested (>= 0.80)
  const scoreWolfs = similarity('Dark Wolfs', 'Dark Wolves');
  assert.ok(scoreWolfs >= 0.80, `Dark Wolfs vs Dark Wolves puanı ${scoreWolfs} >= 0.80 olmalı`);

  // "darkwolves" vs "Dark Wolves"
  const scoreCompact = similarity('darkwolves', 'Dark Wolves');
  assert.ok(scoreCompact >= 0.90, `darkwolves vs Dark Wolves puanı ${scoreCompact} >= 0.90 olmalı`);

  // "DARK-WOLVES" vs "Dark Wolves"
  const scoreHyphen = similarity('DARK-WOLVES', 'Dark Wolves');
  assert.ok(scoreHyphen >= 0.90, `DARK-WOLVES vs Dark Wolves puanı ${scoreHyphen} >= 0.90 olmalı`);

  // "[DW] Dark Wolves" vs "Dark Wolves"
  const scoreTag = similarity('[DW] Dark Wolves', 'Dark Wolves');
  assert.ok(scoreTag >= 0.85, `[DW] Dark Wolves vs Dark Wolves puanı ${scoreTag} >= 0.85 olmalı`);

  // "Wolves Dark" (kelime sırası farklı) en az suggested (>= 0.80)
  const scoreReversed = similarity('Wolves Dark', 'Dark Wolves');
  assert.ok(scoreReversed >= 0.80, `Wolves Dark vs Dark Wolves puanı ${scoreReversed} >= 0.80 olmalı`);

  // "Alpha" ile "Alfa" fonetik eşleşme (en az suggested)
  const scorePhonetic = similarity('Alpha', 'Alfa');
  assert.ok(scorePhonetic >= 0.80, `Alpha vs Alfa puanı ${scorePhonetic} >= 0.80 olmalı`);
});

test('clanMatcher - resolveClan: Karar Eşikleri, ownClan, ambiguous ve bilinen klanlar', () => {
  const registryRoles = [
    { roleId: '101', name: 'Dark Wolves', compact: 'darkwolves', aliases: ['DW'] },
    { roleId: '102', name: 'Shadow Clan', compact: 'shadowclan', aliases: [] },
  ];

  const safeGuildRoles = [
    { id: '201', name: 'Red Dragons' },
  ];

  const knownClans = [
    { id: 'kc1', name: 'Vanguard', compact: 'vanguard', type: 'ally' },
    { id: 'kc2', name: 'Nemesis', compact: 'nemesis', type: 'enemy' },
  ];

  // 1. ownClan testi
  const ownRes = resolveClan('Piyade Team', { registryRoles, safeGuildRoles, knownClans });
  assert.equal(ownRes.ownClan, true);

  const ownRes2 = resolveClan('TSB Piyade', { registryRoles, safeGuildRoles, knownClans });
  assert.equal(ownRes2.ownClan, true);

  // 2. Existing / Suggested rol eşleşmesi
  const wolfRes = resolveClan('Dark Wolves', { registryRoles, safeGuildRoles, knownClans });
  assert.equal(wolfRes.mode, 'existing');
  assert.equal(wolfRes.roleId, '101');

  const wolfTypo = resolveClan('Dark Wolfs', { registryRoles, safeGuildRoles, knownClans });
  assert.ok(['existing', 'suggested'].includes(wolfTypo.mode));
  assert.equal(wolfTypo.roleId, '101');

  // 3. Guild safe role tam eşleşme
  const guildExact = resolveClan('Red Dragons', { registryRoles, safeGuildRoles, knownClans });
  assert.equal(guildExact.mode, 'existing');
  assert.equal(guildExact.roleId, '201');

  // 4. Guild safe role fuzzy eşleşmemeli (sadece tam eşleşme)
  const guildFuzzy = resolveClan('Red Dragon', { registryRoles, safeGuildRoles, knownClans });
  assert.notEqual(guildFuzzy.roleId, '201');

  // 5. New clan ve Known Clan tespiti
  const nemRes = resolveClan('Nemesis', { registryRoles, safeGuildRoles, knownClans });
  assert.equal(nemRes.knownClan?.type, 'enemy');
  assert.equal(nemRes.knownClan?.name, 'Nemesis');

  // 6. Ambiguous testi: iki çok yakın aday
  const ambigRoles = [
    { roleId: '301', name: 'Wolf Pack A', compact: 'wolfpacka', aliases: [] },
    { roleId: '302', name: 'Wolf Pack B', compact: 'wolfpackb', aliases: [] },
  ];
  const ambigRes = resolveClan('Wolf Pack', { registryRoles: ambigRoles, safeGuildRoles: [], knownClans: [] });
  assert.equal(ambigRes.ambiguous, true);
  assert.equal(ambigRes.mode, 'suggested');
});

test('clanMatcher - isSafeClanRole: Güvenlik, korumalı roller ve yetki kontrolleri', () => {
  const mockGuild = {
    id: 'guild123',
    members: {
      me: { roles: { highest: { position: 50 } } },
    },
  };

  const mockConfig = {
    ROLES: {
      REGISTERED_CHECK: 'role_reg',
      OTHER_CLAN: 'role_other',
      DEVELOPER: 'role_dev',
      TRYOUT_STAFF: 'role_staff',
    },
    COLOR_ROLES: [{ id: 'role_color' }],
    LEVEL_ROLES: [{ id: 'role_level' }],
  };

  const mockDatabase = {
    data: {
      warningRoles: { WARN: 'role_warn' },
      englishRoleId: 'role_en',
    },
  };

  // @everyone
  assert.equal(isSafeClanRole({ id: 'guild123', name: '@everyone' }, mockGuild, mockConfig, mockDatabase), false);

  // Bot rolünden yüksek pozisyon
  assert.equal(isSafeClanRole({ id: 'r1', name: 'High Role', position: 60 }, mockGuild, mockConfig, mockDatabase), false);

  // Korumalı isimler ("Yönetmenlik", "Admin", "Developer")
  assert.equal(isSafeClanRole({ id: 'r2', name: 'Yönetmenlik', position: 10 }, mockGuild, mockConfig, mockDatabase), false);
  assert.equal(isSafeClanRole({ id: 'r3', name: 'Developer', position: 10 }, mockGuild, mockConfig, mockDatabase), false);
  assert.equal(isSafeClanRole({ id: 'r4', name: 'Server Admin', position: 10 }, mockGuild, mockConfig, mockDatabase), false);

  // Config rolü (OTHER_CLAN, REGISTERED_CHECK vb.)
  assert.equal(isSafeClanRole({ id: 'role_other', name: 'Other Clan', position: 10 }, mockGuild, mockConfig, mockDatabase), false);
  assert.equal(isSafeClanRole({ id: 'role_reg', name: 'Kayıtlı', position: 10 }, mockGuild, mockConfig, mockDatabase), false);

  // Tehlikeli izin (Administrator)
  const roleWithAdmin = {
    id: 'r5',
    name: 'Normal Clan',
    position: 10,
    permissions: { has: (p) => p === 'Administrator' },
  };
  assert.equal(isSafeClanRole(roleWithAdmin, mockGuild, mockConfig, mockDatabase), false);

  // Güvenli rol
  const safeRole = {
    id: 'r6',
    name: 'Dark Wolves',
    position: 10,
    permissions: { has: () => false },
  };
  assert.equal(isSafeClanRole(safeRole, mockGuild, mockConfig, mockDatabase), true);
});
