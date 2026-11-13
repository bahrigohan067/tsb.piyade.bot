const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Testler için izole geçici veri klasörü ve gizli anahtar (gerçek data/database.json dosyasına dokunulmaz)
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb-feedback-test-'));
process.env.DATA_DIR = tempDataDir;
process.env.API_SECRET = 'test-api-secret-123';
process.env.GUILD_ID = '1559313292651008040';
process.env.FEEDBACK_CHANNEL_ID = '999000111222333444';

const config = require('../config');
const database = require('../src/utils/database');
const { createApp } = require('../src/api/server');
const {
  checkFeedbackChannelOnStartup,
  resetStartupCheckForTest,
} = require('../src/utils/feedbackManager');

/**
 * Sahte Discord istemcisi oluşturucu
 */
function createMockDiscordSetup() {
  const sentMessages = [];
  let failChannelSend = false;
  let channelExists = true;

  const feedbackChannel = {
    id: '999000111222333444',
    async send(payload) {
      if (failChannelSend) {
        throw new Error('Missing Permissions');
      }
      sentMessages.push(payload);
      return { id: `msg-${sentMessages.length}` };
    },
  };

  function makeMember({ id, username, roleIds = [], isAdmin = false }) {
    const roleMap = new Map(roleIds.map((rid) => [rid, { id: rid }]));
    return {
      id,
      displayName: username,
      user: { id, username },
      roles: { cache: roleMap },
      permissions: {
        has: (perm) => (isAdmin ? true : false),
      },
    };
  }

  const membersMap = new Map([
    [
      '1001',
      makeMember({
        id: '1001',
        username: 'kayitsiz_uye',
        roleIds: [config.ROLES.UNREGISTERED],
      }),
    ],
    [
      '1002',
      makeMember({
        id: '1002',
        username: 'normal_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1003',
      makeMember({
        id: '1003',
        username: 'yonetici_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK, config.ROLES.TRYOUT_STAFF],
      }),
    ],
    [
      '1004',
      makeMember({
        id: '1004',
        username: 'ikinci_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1005',
      makeMember({
        id: '1005',
        username: 'rate_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1006',
      makeMember({
        id: '1006',
        username: 'gunluk_limit_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1007',
      makeMember({
        id: '1007',
        username: 'mention_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1008',
      makeMember({
        id: '1008',
        username: 'kanalsiz_uye',
        roleIds: [config.ROLES.REGISTERED_CHECK],
      }),
    ],
    [
      '1009',
      makeMember({
        id: '1009',
        username: 'other_clan_uye',
        roleIds: [config.ROLES.OTHER_CLAN],
      }),
    ],
  ]);

  const channelMap = new Map([[feedbackChannel.id, feedbackChannel]]);

  const mockGuild = {
    id: config.GUILD_ID,
    ownerId: '999999999999999999',
    members: {
      async fetch(id) {
        return membersMap.get(String(id)) || null;
      },
    },
    channels: {
      cache: {
        get(id) {
          return channelExists ? channelMap.get(String(id)) || null : null;
        },
      },
      async fetch(id) {
        return channelExists ? channelMap.get(String(id)) || null : null;
      },
    },
  };

  const mockClient = {
    isReady: () => true,
    user: { tag: 'MockBot#0001' },
    guilds: {
      cache: {
        get: (id) => (id === mockGuild.id ? mockGuild : null),
        first: () => mockGuild,
      },
    },
  };

  return {
    mockClient,
    mockGuild,
    sentMessages,
    setChannelExists(val) {
      channelExists = val;
    },
    setFailChannelSend(val) {
      failChannelSend = val;
    },
  };
}

let server;
let baseUrl;
let mockEnv;

test.before(async () => {
  mockEnv = createMockDiscordSetup();
  const app = createApp(mockEnv.mockClient);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

async function postFeedback({ actorId = '1002', body = {}, headers = {} }) {
  const reqHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.API_SECRET}`,
    ...headers,
  };
  if (actorId !== null) {
    reqHeaders['X-Actor-Id'] = actorId;
  }

  const res = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, headers: res.headers, json };
}

test('1. Normal gönderim, embed formatı, sahte gövde ID yoksayma ve gizli log kontrolü', async () => {
  process.env.FEEDBACK_CHANNEL_ID = '999000111222333444';
  mockEnv.setChannelExists(true);
  mockEnv.setFailChannelSend(false);
  mockEnv.sentMessages.length = 0;

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const secretText = 'GİZLİ_GERİ_BİLDİRİM_İÇERİĞİ';
    const { status, json } = await postFeedback({
      actorId: '1001', // Kayıtsız üye de gönderebilmeli
      body: {
        userId: '999999', // Gövdedeki kullanıcı alanına güvenilmemeli
        actorId: '888888',
        message: `${secretText}\n\n\n\n\n\nİkinci paragraf\u200B\u200C`,
        page: '/tryout/leaderboard',
        lang: 'tr',
      },
    });

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.delivered, true);
    assert.match(json.id, /^[A-Z0-9]{6}$/);

    // Loglarda mesaj içeriği kesinlikle geçmemeli
    const joinedLogs = logs.join('\n');
    assert.equal(joinedLogs.includes(secretText), false);
    assert.equal(joinedLogs.includes(json.id), true);
    assert.equal(joinedLogs.includes('1001'), true);

    // DB kaydı kontrolü
    const saved = database.data.feedback.find((f) => f.id === json.id);
    assert.ok(saved);
    assert.equal(saved.userId, '1001');
    assert.equal(saved.usernameSnapshot, 'kayitsiz_uye');
    assert.equal(saved.page, '/tryout/leaderboard');
    assert.equal(saved.lang, 'tr');
    assert.equal(saved.status, 'new');
    assert.equal(saved.channelId, '999000111222333444');
    assert.ok(saved.messageId);
    // Ardışık 3'ten fazla boş satır 2 boş satıra (\n\n\n) indirgenmiş olmalı
    assert.equal(saved.message.includes('\n\n\n\n'), false);
    assert.equal(saved.message.includes('\u200B'), false);

    // Discord embed kontrolü
    assert.equal(mockEnv.sentMessages.length, 1);
    const sent = mockEnv.sentMessages[0];
    assert.deepEqual(sent.allowedMentions, { parse: [] });
    const embedData = sent.embeds[0].toJSON();
    assert.equal(embedData.title, `💬 Yeni Geri Bildirim #${json.id}`);
    assert.equal(embedData.color, config.COLORS.PRIMARY);
    assert.ok(embedData.description.startsWith('```\n'));
    assert.ok(embedData.description.endsWith('\n```'));
    assert.equal(embedData.footer.text, 'Piyade Clan | TSB Web Sitesi');
    assert.ok(embedData.timestamp);

    const fieldMap = Object.fromEntries(embedData.fields.map((f) => [f.name, f.value]));
    assert.ok(fieldMap['Gönderen'].includes('<@1001>'));
    assert.ok(fieldMap['Gönderen'].includes('kayitsiz_uye'));
    assert.ok(fieldMap['Gönderen'].includes('1001'));
    assert.equal(fieldMap['Sayfa'], '`/tryout/leaderboard`');
    assert.ok(fieldMap['Dil'].includes('tr'));
    assert.equal(fieldMap['Seviye'], 'Kayıtsız');
  } finally {
    console.log = origLog;
  }
});

test('2. Geçersiz sayfa, geçersiz dil ve Yönetim / Üye seviyelerinin doğru tespiti + 401 koruması', async () => {
  mockEnv.sentMessages.length = 0;

  // Yetkisiz istek -> 401
  const unauthRes = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Actor-Id': '1002' },
    body: JSON.stringify({ message: 'Yetkisiz deneme', page: '/', lang: 'tr' }),
  });
  assert.equal(unauthRes.status, 401);

  const res = await postFeedback({
    actorId: '1003', // Yönetim
    body: {
      message: 'Yönetim seviyesinden gelen test bildirimi.',
      page: 'https://evil.example/phish?x=1',
      lang: 'fr',
    },
  });

  assert.equal(res.status, 200);
  const saved = database.data.feedback.find((f) => f.id === res.json.id);
  assert.equal(saved.page, '/');
  assert.equal(saved.lang, 'tr');

  const fields = Object.fromEntries(
    mockEnv.sentMessages[0].embeds[0].toJSON().fields.map((f) => [f.name, f.value])
  );
  assert.equal(fields['Sayfa'], '`/`');
  assert.equal(fields['Seviye'], 'Yönetim');

  // Üye seviyesi testi (Normal Kayıtlı Üye)
  const memberRes = await postFeedback({
    actorId: '1004',
    body: { message: 'Kayıtlı üye seviyesi testi.', page: '/profile', lang: 'en' },
  });
  assert.equal(memberRes.status, 200);
  const memberFields = Object.fromEntries(
    mockEnv.sentMessages[1].embeds[0].toJSON().fields.map((f) => [f.name, f.value])
  );
  assert.equal(memberFields['Seviye'], 'Üye');

  // Diğer Klan (Other Clan) üye seviyesi testi
  const otherClanRes = await postFeedback({
    actorId: '1009',
    body: { message: 'Other clan üye seviyesi kontrolü.', page: '/profile', lang: 'tr' },
  });
  assert.equal(otherClanRes.status, 200);
  const otherClanFields = Object.fromEntries(
    mockEnv.sentMessages[2].embeds[0].toJSON().fields.map((f) => [f.name, f.value])
  );
  assert.equal(otherClanFields['Seviye'], 'Üye');
});

test('3. Çok kısa ve boşluk/görünmez karakterlerden oluşan mesajlar (400 TOO_SHORT)', async () => {
  const cases = ['ab', '   ', '\u200B\u200C\u200D\x00\x07  \n\t\r ', 'a\u200Bb'];

  for (const msg of cases) {
    const { status, json } = await postFeedback({
      actorId: '1002',
      body: { message: msg, page: '/', lang: 'tr' },
    });
    assert.equal(status, 400);
    assert.equal(json.code, 'TOO_SHORT');
  }
});

test('4. Çok uzun mesaj (400 TOO_LONG)', async () => {
  const { status, json } = await postFeedback({
    actorId: '1002',
    body: { message: 'x'.repeat(1001), page: '/', lang: 'tr' },
  });
  assert.equal(status, 400);
  assert.equal(json.code, 'TOO_LONG');
});

test('5. Sunucuda olmayan aktör (403 NOT_IN_GUILD)', async () => {
  const { status, json } = await postFeedback({
    actorId: '999999999999999999',
    body: { message: 'Sunucu dışı kullanıcı testi', page: '/', lang: 'tr' },
  });
  assert.equal(status, 403);
  assert.equal(json.code, 'NOT_IN_GUILD');
});

test('6. Tekrarlanan mesaj engeli (409 DUPLICATE)', async () => {
  const first = await postFeedback({
    actorId: '1002',
    body: { message: 'Aynı Mesaj\nKontrol  Testi', page: '/', lang: 'tr' },
  });
  assert.equal(first.status, 200);

  // Büyük/küçük harf ve boşluk farkı olan tekrar -> 409 DUPLICATE
  const dup = await postFeedback({
    actorId: '1002',
    body: { message: '  aynı   mesaj kontrol testi  ', page: '/', lang: 'tr' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'DUPLICATE');

  // Başka kullanıcı aynı mesajı gönderebilmeli -> 200
  const otherUser = await postFeedback({
    actorId: '1004',
    body: { message: '  aynı   mesaj kontrol testi  ', page: '/', lang: 'tr' },
  });
  assert.equal(otherUser.status, 200);
});

test('7. Hız sınırı (10 dakikada 3 ve 24 saatte 10 -> 429 RATE_LIMITED)', async () => {
  // 10 dakika içinde 3 başarılı gönderim
  for (let i = 1; i <= 3; i++) {
    const res = await postFeedback({
      actorId: '1005',
      body: { message: `Hız sınırı kısa pencere mesaj #${i}`, page: '/', lang: 'tr' },
    });
    assert.equal(res.status, 200);
  }

  const fourth = await postFeedback({
    actorId: '1005',
    body: { message: 'Hız sınırı dördüncü mesaj', page: '/', lang: 'tr' },
  });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.code, 'RATE_LIMITED');
  assert.ok(fourth.json.retryAfterSec > 0);

  // 24 saatte 10 limiti testi (son 10 dakikadan eski 10 kayıt ekle)
  const twentyMinAgo = Date.now() - 20 * 60 * 1000;
  for (let i = 1; i <= 10; i++) {
    database.addFeedback({
      userId: '1006',
      usernameSnapshot: 'gunluk_limit_uye',
      message: `Eski günlük mesaj ${i}`,
      page: '/',
      lang: 'tr',
      createdAt: twentyMinAgo + i * 1000,
    });
  }

  const eleventh = await postFeedback({
    actorId: '1006',
    body: { message: '24 saatteki on birinci mesaj', page: '/', lang: 'en' },
  });
  assert.equal(eleventh.status, 429);
  assert.equal(eleventh.json.code, 'RATE_LIMITED');
  assert.ok(eleventh.json.retryAfterSec > 0);
});

test('8. @everyone, @here ve üç ters tırnak içeren mesajlarda etiket/kaçış koruması', async () => {
  mockEnv.sentMessages.length = 0;

  const { status, json } = await postFeedback({
    actorId: '1007',
    body: {
      message: 'Merhaba @everyone ve @here ```js\n[link](https://example.com)\n``` bitiş',
      page: '/support',
      lang: 'en',
    },
  });

  assert.equal(status, 200);
  assert.equal(json.delivered, true);
  assert.equal(mockEnv.sentMessages.length, 1);

  const payload = mockEnv.sentMessages[0];
  assert.deepEqual(payload.allowedMentions, { parse: [] });

  const desc = payload.embeds[0].toJSON().description;
  assert.equal(desc.includes('@everyone'), false);
  assert.equal(desc.includes('@here'), false);

  // Kod bloğunun içindeki kısımda üçlü ters tırnak bulunmamalı
  const inner = desc.slice(4, -4);
  assert.equal(inner.includes('```'), false);
});

test('9. Kanal yok veya gönderim başarısızsa kaydı saklayıp 200 delivered: false dönmeli', async () => {
  mockEnv.setChannelExists(false);

  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    const res1 = await postFeedback({
      actorId: '1008',
      body: { message: 'Kanal mevcut değilken gönderilen geri bildirim #1', page: '/', lang: 'tr' },
    });

    assert.equal(res1.status, 200);
    assert.deepEqual(res1.json, {
      success: true,
      id: res1.json.id,
      delivered: false,
      reason: 'CHANNEL_UNAVAILABLE',
    });

    const saved1 = database.data.feedback.find((f) => f.id === res1.json.id);
    assert.ok(saved1);
    assert.equal(saved1.messageId, null);

    // FEEDBACK_CHANNEL_ID tanımsızken test
    process.env.FEEDBACK_CHANNEL_ID = '';
    const res2 = await postFeedback({
      actorId: '1008',
      body: { message: 'Ortam değişkeni boşken gönderilen geri bildirim #2', page: '/', lang: 'tr' },
    });

    assert.equal(res2.status, 200);
    assert.equal(res2.json.delivered, false);
    assert.equal(res2.json.reason, 'CHANNEL_UNAVAILABLE');

    // Kanal mevcut ama send() hata fırlatıyorsa
    process.env.FEEDBACK_CHANNEL_ID = '999000111222333444';
    mockEnv.setChannelExists(true);
    mockEnv.setFailChannelSend(true);
    const res3 = await postFeedback({
      actorId: '1008',
      body: { message: 'Kanal send hatası fırlattığında bile kaydedilmeli #3', page: '/', lang: 'tr' },
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.json.delivered, false);
    assert.equal(res3.json.reason, 'CHANNEL_UNAVAILABLE');
    assert.ok(database.data.feedback.find((f) => f.id === res3.json.id));

    // Açılışta bir kez uyarı loglama testi (çökmemeli)
    mockEnv.setChannelExists(false);
    resetStartupCheckForTest();
    await checkFeedbackChannelOnStartup(mockEnv.mockGuild);
    await checkFeedbackChannelOnStartup(mockEnv.mockGuild);
    const startupWarns = warns.filter((w) => w.includes('[FEEDBACK UYARI]'));
    assert.equal(startupWarns.length, 1);
  } finally {
    console.warn = origWarn;
    process.env.FEEDBACK_CHANNEL_ID = '999000111222333444';
    mockEnv.setChannelExists(true);
    mockEnv.setFailChannelSend(false);
  }
});

test('10. Veritabanı en fazla 2000 geri bildirim kaydı saklamalı ve eskileri silmeli', () => {
  database.data.feedback = [];
  database.save();

  for (let i = 1; i <= 2005; i++) {
    database.addFeedback({
      userId: '2000',
      usernameSnapshot: 'limit_test',
      message: `Kayıt numarası ${i}`,
      page: '/',
      lang: 'tr',
      createdAt: i,
    });
  }

  assert.equal(database.data.feedback.length, 2000);
  assert.equal(database.data.feedback[0].message, 'Kayıt numarası 6');
  assert.equal(database.data.feedback[1999].message, 'Kayıt numarası 2005');
});
