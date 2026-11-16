const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');

// Kullanıcının ilettiği sunucu hiyerarşisindeki 38 rolün referans listesi
const EXPECTED_SERVER_ROLES = [
  { rank: 1,  id: '1570767625188016259', name: '| Community Official' },
  { rank: 2,  id: '1561777507223601353', name: '💻| DEVELOPER' },
  { rank: 3,  id: '1559567065130737664', name: 'FOUNDER' },
  { rank: 4,  id: '1570454776888430593', name: '</>' },
  { rank: 5,  id: '1568543109720317992', name: '🛡️| Yetkili' },
  { rank: 6,  id: '1559926335995117590', name: '®️| Sunucu Botları' },
  { rank: 7,  id: '1559572934983688272', name: 'Piyade RP | Music Bot' },
  { rank: 8,  id: '1559602223183433842', name: 'PİYADE TEAM | TSB BOT' },
  { rank: 9,  id: '1568995152561971312', name: '👑 | VİP' },
  { rank: 10, id: '1559899395233808444', name: 'Siyah' },
  { rank: 11, id: '1559926616535339010', name: 'Mavi' },
  { rank: 12, id: '1559926687645311017', name: 'Pembe' },
  { rank: 13, id: '1559926857472675910', name: 'Kırmızı' },
  { rank: 14, id: '1559926912338362379', name: 'Yeşil' },
  { rank: 15, id: '1559927000183873597', name: 'Sarı' },
  { rank: 16, id: '1563914587273953363', name: '💭| Mesaj Denetimcisi' },
  { rank: 17, id: '1559625308737507358', name: '| Başvuru Yetkilisi' },
  { rank: 18, id: '1559637300042797096', name: '| Kız' },
  { rank: 19, id: '1559637360558350356', name: '| Erkek' },
  { rank: 20, id: '1559604702143062016', name: '♾️| Cengaver' },
  { rank: 21, id: '1559604645821812896', name: '| Hesabı Onaylı' },
  { rank: 22, id: '1571813234644619284', name: 'Server Booster' },
  { rank: 23, id: '1559604540997636147', name: '| Kayıtsız' },
  { rank: 24, id: '1570138106923974867', name: '| Haftanın En Çok Atifi' },
  { rank: 25, id: '1559575677584539769', name: '| Müzik Açma İzni' },
  { rank: 26, id: '1563922256525000895', name: '| Askıda' },
  { rank: 27, id: '1563926964144832623', name: 'Uyarı 1' },
  { rank: 28, id: '1563926965059326147', name: 'Uyarı 2' },
  { rank: 29, id: '1563926966434930850', name: 'Uyarı 3' },
  { rank: 30, id: '1563926967428972704', name: 'Uyarı 4' },
  { rank: 31, id: '1563926968561565726', name: 'Uyarı 5' },
  { rank: 32, id: '1563926970037837975', name: 'Yetkili Uyarı 1' },
  { rank: 33, id: '1563926971409367402', name: 'Yetkili Uyarı 2' },
  { rank: 34, id: '1563926972223066188', name: 'Yetkili Uyarı 3' },
  { rank: 35, id: '1563926973707853884', name: 'Yasaklı' },
  { rank: 36, id: '1566236438574665858', name: 'Quark Logger' },
  { rank: 37, id: '1567541917028458557', name: '🇬🇧 English' },
  { rank: 38, id: '1569339982932475936', name: 'DISBOARD.org' },
];

test('1. config.SERVER_ROLES kataloğunda 38 rolün tamamı eksiksiz ve sıralı olmalı', () => {
  assert.equal(Array.isArray(config.SERVER_ROLES), true, 'SERVER_ROLES bir dizi olmalı');
  assert.equal(config.SERVER_ROLES.length, 38, 'SERVER_ROLES tam olarak 38 rol içermeli');

  const seenIds = new Set();
  for (let i = 0; i < EXPECTED_SERVER_ROLES.length; i++) {
    const expected = EXPECTED_SERVER_ROLES[i];
    const actual = config.SERVER_ROLES[i];

    assert.equal(actual.rank, expected.rank, `${i + 1}. rolün rank değeri ${expected.rank} olmalı`);
    assert.equal(actual.id, expected.id, `${i + 1}. rolün (${expected.name}) ID'si ${expected.id} olmalı`);
    assert.equal(actual.name, expected.name, `${i + 1}. rolün adı ${expected.name} olmalı`);

    assert.equal(seenIds.has(actual.id), false, `Rol ID'si benzersiz olmalı: ${actual.id}`);
    seenIds.add(actual.id);
  }
});

test('2. config.ROLES objesinde 38 rolün tamamının ID karşılığı tanımlı olmalı', () => {
  const roleValues = Object.values(config.ROLES);

  for (const expected of EXPECTED_SERVER_ROLES) {
    const foundInRoles = roleValues.some((val) => {
      if (typeof val === 'string') return val === expected.id;
      if (Array.isArray(val)) return val.includes(expected.id);
      if (typeof val === 'object' && val !== null) return Object.values(val).includes(expected.id);
      return false;
    });

    assert.equal(
      foundInRoles,
      true,
      `'${expected.name}' rolü (ID: ${expected.id}) config.ROLES içinde tanımlı olmalı`
    );
  }
});

test('3. config.getRoleById metodu geçerli ID ile doğru rolü döndürmeli', () => {
  assert.equal(typeof config.getRoleById, 'function', 'getRoleById fonksiyon olmalı');

  for (const expected of EXPECTED_SERVER_ROLES) {
    const role = config.getRoleById(expected.id);
    assert.ok(role, `${expected.id} ID'li rol bulunabilmeli`);
    assert.equal(role.id, expected.id);
    assert.equal(role.name, expected.name);
    assert.equal(role.rank, expected.rank);
  }

  // Geçersiz ID kontrolleri
  assert.equal(config.getRoleById(null), null);
  assert.equal(config.getRoleById(''), null);
  assert.equal(config.getRoleById('olmayan_id'), null);
});

test('4. Uyarı ve ceza sistemi rolleri (WARNINGS, STAFF_WARNINGS, WARNING_ROLES_MAP) eksiksiz olmalı', () => {
  // Katılımcı uyarıları (1-5)
  assert.equal(config.ROLES.WARNINGS.length, 5);
  assert.equal(config.ROLES.WARNINGS[0], '1563926964144832623');
  assert.equal(config.ROLES.WARNINGS[1], '1563926965059326147');
  assert.equal(config.ROLES.WARNINGS[2], '1563926966434930850');
  assert.equal(config.ROLES.WARNINGS[3], '1563926967428972704');
  assert.equal(config.ROLES.WARNINGS[4], '1563926968561565726');

  // Yetkili uyarıları (1-3)
  assert.equal(config.ROLES.STAFF_WARNINGS.length, 3);
  assert.equal(config.ROLES.STAFF_WARNINGS[0], '1563926970037837975');
  assert.equal(config.ROLES.STAFF_WARNINGS[1], '1563926971409367402');
  assert.equal(config.ROLES.STAFF_WARNINGS[2], '1563926972223066188');

  // Yasaklı
  assert.equal(config.ROLES.BANNED, '1563926973707853884');
  assert.equal(config.ROLES.YASAKLI, '1563926973707853884');

  // WARNING_ROLES_MAP
  assert.equal(config.ROLES.WARNING_ROLES_MAP.uyari1, '1563926964144832623');
  assert.equal(config.ROLES.WARNING_ROLES_MAP.yetkiliUyari1, '1563926970037837975');
  assert.equal(config.ROLES.WARNING_ROLES_MAP.yasakli, '1563926973707853884');
});
