const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection } = require('discord.js');

// Test için geçici veri dizini
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-warn-regression-test-'));
process.env.DATA_DIR = tempDataDir;

const config = require('../config');
const database = require('../src/utils/database');
const {
  RULES,
  checkWarningHierarchy,
  executeVerbalWarning,
  executeOfficialWarning,
} = require('../src/utils/warningManager');

test.before(() => {
  database.init();
});

test.after(() => {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch (e) {}
});

test('1. Kural Cetveli Doğrulaması (M1-M13, D1-D3, Y1-Y5 eksiksiz mevcut olmalı)', () => {
  const expectedRules = [
    'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13',
    'D1', 'D2', 'D3',
    'Y1', 'Y2', 'Y3', 'Y4', 'Y5',
  ];

  for (const code of expectedRules) {
    assert.ok(RULES[code], `Kural ${code} RULES sözlüğünde bulunmalı`);
    assert.ok(RULES[code].description, `${code} kural açıklaması olmalı`);
    assert.ok('points' in RULES[code] || 'penaltyLabel' in RULES[code], `${code} puan veya ceza etiketi içermeli`);
  }
});

test('2. checkWarningHierarchy: Uyarı hiyerarşisi kontrolleri', () => {
  // Kendine uyarı verilemez
  const selfActor = { id: 'user_1', roles: { highest: { position: 10 } } };
  const selfTarget = { id: 'user_1', roles: { highest: { position: 10 } } };
  const selfRes = checkWarningHierarchy(selfActor, selfTarget);
  assert.equal(selfRes.allowed, false, 'Kendine uyarı engellenmeli');

  // Düşük rol yüksek role uyarı veremez
  const lowActor = {
    id: 'user_low',
    roles: { cache: new Map(), highest: { position: 10 } },
  };
  const highTarget = {
    id: 'user_high',
    roles: { cache: new Map(), highest: { position: 20 } },
  };
  const lowRes = checkWarningHierarchy(lowActor, highTarget);
  assert.equal(lowRes.allowed, false, 'Düşük rol yüksek role uyarı verememeli');

  // Developer istisnası: Developer kendisi dışında herkese uyarı verebilir
  const devActor = {
    id: 'user_dev',
    roles: {
      cache: new Map([[config.ROLES.DEVELOPER, { id: config.ROLES.DEVELOPER }]]),
      highest: { position: 5 },
    },
  };
  const devRes = checkWarningHierarchy(devActor, highTarget);
  assert.equal(devRes.allowed, true, 'Developer kendisi dışındaki üyelere uyarı verebilmeli');
});

test('3. executeVerbalWarning: Sözlü uyarı işletimi', async () => {
  const channelsCol = new Collection();
  const rolesCol = new Collection();
  const mockGuild = {
    id: 'guild_1',
    channels: {
      cache: channelsCol,
      fetch: async (id) => channelsCol.get(id) || null,
    },
    roles: {
      cache: rolesCol,
      fetch: async () => rolesCol,
      create: async () => ({ id: 'role_test' }),
    },
  };
  const mockStaffUser = { id: 'staff_1', tag: 'Staff#0001', username: 'staff' };
  const mockStaffMember = {
    id: 'staff_1',
    user: mockStaffUser,
    roles: { cache: new Collection(), highest: { position: 30 } },
  };
  const mockTargetUser = { id: 'target_1', tag: 'Target#0001', username: 'target', send: async () => ({}) };
  const mockTargetMember = {
    id: 'target_1',
    user: mockTargetUser,
    roles: { cache: new Collection(), highest: { position: 10 } },
  };

  const result = await executeVerbalWarning({
    guild: mockGuild,
    targetMember: mockTargetMember,
    staffUser: mockStaffUser,
    staffMember: mockStaffMember,
    reason: 'Sözlü uyarı test gerekçesi',
  });

  assert.equal(result.success, true);
  assert.equal(result.record.type, 'verbal');
  assert.ok(result.warnId);

  const stats = database.getUserWarningStats('target_1');
  assert.ok(stats.totalWarnings >= 1, 'Toplam uyarı sayısı artmış olmalı');
});

test('4. executeOfficialWarning: Resmi uyarı ve puan artışı', async () => {
  const rolesCollection = new Collection();
  const channelsCol = new Collection();
  const mockGuild = {
    id: 'guild_1',
    channels: {
      cache: channelsCol,
      fetch: async (id) => channelsCol.get(id) || null,
    },
    roles: {
      cache: rolesCollection,
      fetch: async () => rolesCollection,
      create: async ({ name }) => {
        const r = { id: `role_${name}`, name, position: 1 };
        rolesCollection.set(r.id, r);
        return r;
      },
    },
  };
  const mockStaffUser = { id: 'staff_1', tag: 'Staff#0001', username: 'staff' };
  const mockStaffMember = {
    id: 'staff_1',
    user: mockStaffUser,
    roles: { cache: new Collection(), highest: { position: 30 } },
  };
  const mockTargetUser = { id: 'target_2', tag: 'Target2#0001', username: 'target2', send: async () => ({}) };
  const targetRoles = new Collection();
  const mockTargetMember = {
    id: 'target_2',
    user: mockTargetUser,
    roles: {
      cache: targetRoles,
      add: async (roleId) => { targetRoles.set(roleId, { id: roleId }); },
      remove: async (roleId) => { targetRoles.delete(roleId); },
      highest: { position: 10 },
    },
    timeout: async () => {},
  };

  // M1 kuralı (+2 Puan)
  const result = await executeOfficialWarning({
    guild: mockGuild,
    targetMember: mockTargetMember,
    staffUser: mockStaffUser,
    staffMember: mockStaffMember,
    ruleCode: 'M1',
  });

  assert.equal(result.success, true);
  assert.equal(result.record.ruleCode, 'M1');
  assert.equal(result.record.pointsAdded, 2);

  const stats = database.getUserWarningStats('target_2');
  assert.ok(stats.points >= 1, 'Ceza puanı artmış olmalı');
  assert.ok(stats.totalWarnings >= 1);
});
