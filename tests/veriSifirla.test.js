const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Test için izole veri klasörü
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-reset-test-'));
process.env.DATA_DIR = tempDataDir;

const config = require('../config');
const database = require('../src/utils/database');
const {
  isDeveloper,
  getScopeLabel,
  performReset,
} = require('../src/commands/veriSifirla');

test.before(() => {
  database.init();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

test('1. isDeveloper: Yetki kontrolleri', () => {
  const mockGuild = { ownerId: '1001' };

  // Sunucu Sahibi
  assert.equal(isDeveloper({ id: '1001' }, mockGuild), true, 'Owner developer sayılmalı');

  // Developer Rolü Olan Üye
  const devMember = {
    id: '2002',
    roles: {
      cache: new Map([[config.ROLES.DEVELOPER, { id: config.ROLES.DEVELOPER }]]),
    },
  };
  assert.equal(isDeveloper(devMember, mockGuild), true, 'Developer rolü olan üye developer sayılmalı');

  // Normal Üye (Yetkisiz)
  const normalMember = {
    id: '3003',
    roles: {
      cache: new Map([['9999', { id: '9999' }]]),
    },
  };
  assert.equal(isDeveloper(normalMember, mockGuild), false, 'Normal üye developer sayılmamalı');
  assert.equal(isDeveloper(null, mockGuild), false, 'Null üye false dönmeli');
});

test('2. getScopeLabel: Kapsam etiketleri', () => {
  assert.ok(getScopeLabel('warn').includes('Uyarılar'));
  assert.ok(getScopeLabel('reg').includes('Kayıtlar'));
  assert.ok(getScopeLabel('all').includes('Hepsi'));
});

test('3. getResetPreviewCounts: Önizleme sayıları doğru hesaplanmalı', () => {
  database.data.warningStats = {
    user1: { points: 5, suspendedUntil: Date.now() + 100000 },
    user2: { points: 2, suspendedUntil: null },
  };
  database.data.warnings = {
    w1: { id: 'w1', userId: 'user1' },
    w2: { id: 'w2', userId: 'user1' },
    w3: { id: 'w3', userId: 'user2' },
  };
  database.data.registrations = [
    { discordId: 'r1', robloxId: '1' },
    { discordId: 'r2', robloxId: '2' },
  ];
  database.data.activeApplications = {
    app1: { userId: 'a1', threadId: 't1' },
  };

  const counts = database.getResetPreviewCounts();
  assert.equal(counts.warnedUsersCount, 2);
  assert.equal(counts.totalWarningsCount, 3);
  assert.equal(counts.activeTimeoutCount, 1);
  assert.equal(counts.registrationsCount, 2);
  assert.equal(counts.activeApplicationsCount, 1);
});

test('4. performReset: Scope "warn" izole sıfırlama (Kayıtlara dokunulmaz)', async () => {
  // Test verisi hazırla
  database.data.warnings = { w1: { id: 'w1' } };
  database.data.warningStats = { u1: { points: 10 } };
  database.data.registrations = [{ discordId: 'keep_me' }];
  database.save();

  const result = await performReset({
    guild: null,
    scope: 'warn',
    executorId: 'test_dev',
    executorTag: 'Dev#0001',
  });

  assert.equal(result.success, true);
  assert.ok(result.backupFile.startsWith('database.backup-reset-'));

  // Uyarılar sıfırlanmış olmalı
  assert.deepEqual(database.data.warnings, {});
  assert.deepEqual(database.data.warningStats, {});

  // Kayıtlar korunmuş olmalı
  assert.equal(database.data.registrations.length, 1);
  assert.equal(database.data.registrations[0].discordId, 'keep_me');
});

test('5. performReset: Scope "reg" izole sıfırlama (Uyarılara dokunulmaz)', async () => {
  // Test verisi hazırla
  database.data.warnings = { w2: { id: 'w2' } };
  database.data.warningStats = { u2: { points: 5 } };
  database.data.registrations = [{ discordId: 'delete_me' }];
  database.data.activeApplications = { a1: { threadId: '123' } };
  database.save();

  const result = await performReset({
    guild: null,
    scope: 'reg',
    executorId: 'test_dev',
    executorTag: 'Dev#0001',
  });

  assert.equal(result.success, true);

  // Kayıtlar sıfırlanmış olmalı
  assert.deepEqual(database.data.registrations, []);
  assert.deepEqual(database.data.activeApplications, {});

  // Uyarılar korunmuş olmalı
  assert.equal(Object.keys(database.data.warnings).length, 1);
  assert.equal(Object.keys(database.data.warningStats).length, 1);
});

test('6. performReset: Scope "all" tam sıfırlama (Her ikisi de temizlenir)', async () => {
  database.data.warnings = { w3: { id: 'w3' } };
  database.data.warningStats = { u3: { points: 5 } };
  database.data.registrations = [{ discordId: 'reg3' }];
  database.save();

  const result = await performReset({
    guild: null,
    scope: 'all',
    executorId: 'test_dev',
    executorTag: 'Dev#0001',
  });

  assert.equal(result.success, true);
  assert.deepEqual(database.data.warnings, {});
  assert.deepEqual(database.data.warningStats, {});
  assert.deepEqual(database.data.registrations, []);
});

test('7. backupDatabaseForReset: En fazla 5 adet yedek tutulmalı', () => {
  for (let i = 0; i < 8; i++) {
    database.backupDatabaseForReset();
  }

  const files = fs.readdirSync(tempDataDir).filter((f) => f.startsWith('database.backup-reset-'));
  assert.ok(files.length <= 5, `Yedek dosya sayısı 5'i geçmemeli, bulunan: ${files.length}`);
});
