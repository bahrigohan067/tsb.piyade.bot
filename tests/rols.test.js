const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const config = require('../config');
const {
  isAuthorized,
  sortGuildRoles,
  buildRoleEmbeds,
  execute,
} = require('../src/commands/rols');

test('1. isAuthorized: Yalnızca Sunucu Sahibi & Developer yetkili olmalı', () => {
  const mockGuild = { ownerId: '1001' };

  // Sunucu Sahibi
  assert.equal(isAuthorized({ id: '1001' }, mockGuild), true, 'Owner yetkili olmalı');

  // Developer Rolü Olan Üye
  const devMember = {
    id: '2002',
    roles: {
      cache: new Map([[config.ROLES.DEVELOPER, { id: config.ROLES.DEVELOPER }]]),
    },
  };
  assert.equal(isAuthorized(devMember, mockGuild), true, 'Developer rolü olan üye yetkili olmalı');

  // Normal / Diğer Yetkili Üye
  const normalMember = {
    id: '3003',
    roles: {
      cache: new Map([['9999', { id: '9999' }]]),
    },
  };
  assert.equal(isAuthorized(normalMember, mockGuild), false, 'Normal üye yetkisiz olmalı');
  assert.equal(isAuthorized(null, mockGuild), false, 'Null üye false dönmeli');
});

test('2. sortGuildRoles: Roller pozisyona göre düzgün sıralanmalı ve @everyone hariç tutulmalı', () => {
  const guildId = 'guild_123';
  const roles = new Collection([
    [guildId, { id: guildId, name: '@everyone', position: 0 }],
    ['role_low', { id: 'role_low', name: 'Üye', position: 5, managed: false }],
    ['role_high', { id: 'role_high', name: 'Yönetici', position: 50, managed: false }],
    ['role_mid', { id: 'role_mid', name: 'Moderatör', position: 25, managed: false }],
  ]);

  const sorted = sortGuildRoles(roles, guildId);

  assert.equal(sorted.length, 3, '@everyone filtrelenmiş olmalı');
  assert.equal(sorted[0].name, 'Yönetici', 'En yüksek rol en başta olmalı');
  assert.equal(sorted[1].name, 'Moderatör', 'Orta seviye rol ortada olmalı');
  assert.equal(sorted[2].name, 'Üye', 'En düşük rol sonda olmalı');
});

test('3. buildRoleEmbeds: Rol etiketi ve ismi yan yana düzgün biçimlendirilmeli', () => {
  const sorted = [
    { id: '111', name: 'Kurucu Rolü', position: 100, managed: false },
    { id: '222', name: 'Bot Rolü', position: 50, managed: true },
  ];

  const embeds = buildRoleEmbeds(sorted, 'Piyade');
  assert.equal(embeds.length, 1);

  const desc = embeds[0].data.description;
  // Rol etiketini içermeli
  assert.ok(desc.includes('<@&111>'), 'Rol etiketi içermeli');
  // Rol ismini yanında içermeli
  assert.ok(desc.includes('Kurucu Rolü'), 'Rol ismi yanında yazmalı');
  // Sıralama numarası
  assert.ok(desc.includes('**1.**'), 'Sıralama numarası içermeli');
  assert.ok(desc.includes('**2.**'), 'Sıralama numarası içermeli');
  // Bot/entegrasyon rozeti
  assert.ok(desc.includes('*(Bot/Entegrasyon)*'));
});

test('4. execute: Yetkisiz kullanıcının komutu çalıştırması engellenmeli', async () => {
  let replyPayload = null;
  const mockInteraction = {
    guild: { ownerId: 'owner_999' },
    user: { id: 'user_regular' },
    member: {
      id: 'user_regular',
      roles: { cache: new Map() },
    },
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await execute(mockInteraction);

  assert.ok(replyPayload);
  assert.equal(replyPayload.ephemeral, true);
  assert.ok(replyPayload.content.includes('Sunucu Sahibi'));
  assert.ok(replyPayload.content.includes('Developer'));
});

test('5. execute: Yetkili kullanıcı için roller çekilip allowedMentions ile yanıtlanmalı', async () => {
  const guildId = 'guild_test';
  const rolesMap = new Collection([
    [guildId, { id: guildId, name: '@everyone', position: 0 }],
    ['r1', { id: 'r1', name: 'Admin', position: 20, managed: false }],
    ['r2', { id: 'r2', name: 'Member', position: 10, managed: false }],
  ]);

  let deferred = false;
  let editReplyPayload = null;

  const mockInteraction = {
    guild: {
      id: guildId,
      ownerId: 'owner_1',
      roles: {
        cache: rolesMap,
        fetch: async () => rolesMap,
      },
    },
    user: { id: 'owner_1' },
    member: {
      id: 'owner_1',
      roles: { cache: new Map() },
    },
    deferReply: async () => { deferred = true; },
    editReply: async (payload) => { editReplyPayload = payload; return payload; },
  };

  await execute(mockInteraction);

  assert.equal(deferred, true);
  assert.ok(editReplyPayload);
  assert.ok(editReplyPayload.embeds.length >= 1);
  assert.deepEqual(editReplyPayload.allowedMentions, { parse: [] }, 'Bildirim spamını engellemek için allowedMentions boş olmalı');
});
