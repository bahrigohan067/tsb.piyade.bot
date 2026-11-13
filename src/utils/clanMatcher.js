/**
 * Klan Adı Eşleştirme ve Normalizasyon Motoru
 * Harici bağımlılık gerektirmez, tamamen saf ve test edilebilir fonksiyonlar içerir.
 */

const profanityFilter = require('./profanityFilter');

// ==========================================
// 1. TEMİZLEME (SANITIZE)
// ==========================================

const BLOCKED_WORDS = ['yok', 'none', '-', 'klanim yok', 'klanım yok', 'no clan', 'n/a', 'na', 'yoktur', 'bos', 'boş', 'clan yok'];

/**
 * Kullanıcının yazdığı klan adını temizler ve güvenlik/geçerlilik kontrolü yapar.
 * @param {string} rawInput 
 * @returns {{ valid: boolean, error?: string, cleanName?: string }}
 */
function sanitizeClanName(rawInput) {
  if (typeof rawInput !== 'string') {
    return { valid: false, error: 'CLAN_INVALID' };
  }

  // Unicode NFKC normalleştirme
  let text = rawInput.normalize('NFKC');

  // Kontrol karakterleri ve sıfır genişlikli karakterleri temizle
  text = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');

  // Boşlukları teke indir ve kırp
  text = text.replace(/\s+/g, ' ').trim();

  // En çok 32 karakter
  if (text.length > 32) {
    text = text.slice(0, 32).trim();
  }

  // 1. Mention / Etiket kontrolü
  if (/@(everyone|here)/i.test(text) || /<@!?\d+>|<#\d+>|<@&\d+>/i.test(text)) {
    return { valid: false, error: 'CLAN_BLOCKED' };
  }

  // 2. URL veya Davet Bağlantısı kontrolü
  if (/https?:\/\/|discord\.(gg|com\/invite)/i.test(text)) {
    return { valid: false, error: 'CLAN_BLOCKED' };
  }

  // 3. Küfür / Argo kontrolü
  const profanity = profanityFilter.detectLocal(text);
  if (profanity) {
    return { valid: false, error: 'CLAN_BLOCKED' };
  }

  // 4. Geçersiz / Boş / Anlamsız girdi kontrolü
  if (text.length < 2) {
    return { valid: false, error: 'CLAN_INVALID' };
  }

  // Sadece sembol, rakam veya emoji mi? Harf var mı?
  if (!/[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(text)) {
    return { valid: false, error: 'CLAN_INVALID' };
  }

  // "yok", "none", "klanım yok", "n/a" gibi anlamsız girdiler
  const lowerSimple = text
    .toLowerCase()
    .replace(/[^a-z0-9ğüşöçı]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compactSimple = lowerSimple.replace(/\s+/g, '');

  if (
    BLOCKED_WORDS.includes(lowerSimple) ||
    BLOCKED_WORDS.includes(compactSimple) ||
    compactSimple === 'na' ||
    compactSimple === 'none' ||
    compactSimple === 'yok'
  ) {
    return { valid: false, error: 'CLAN_INVALID' };
  }

  return {
    valid: true,
    cleanName: text,
  };
}

// ==========================================
// 2. NORMALİZASYON (NORMALIZE)
// ==========================================

const TR_LOWER_MAP = {
  'İ': 'i', 'I': 'i', 'ı': 'i',
  'ş': 's', 'Ş': 's',
  'ğ': 'g', 'Ğ': 'g',
  'ü': 'u', 'Ü': 'u',
  'ö': 'o', 'Ö': 'o',
  'ç': 'c', 'Ç': 'c',
  'â': 'a', 'Â': 'a',
  'î': 'i', 'Î': 'i',
  'û': 'u', 'Û': 'u',
};

const PHONETIC_MAP = [
  [/ph/g, 'f'],
  [/w/g, 'v'],
  [/q/g, 'k'],
  [/x/g, 'ks'],
  [/th/g, 't'],
  [/ck/g, 'k'],
  [/sh/g, 's'],
  [/kk/g, 'k'],
  [/ee/g, 'e'],
];

const STOP_WORDS = new Set([
  'klan', 'clan', 'team', 'takim', 'gang', 'squad',
  'family', 'esports', 'community', 'official', 'resmi',
]);

/**
 * Klan adını karşılaştırmalar için 3 farklı temsile ve fonetik forma dönüştürür.
 * @param {string} name 
 * @returns {{ full: string, compact: string, core: string, phonetic: string, tag: string | null }}
 */
function normalizeClanName(name) {
  if (!name || typeof name !== 'string') {
    return { full: '', compact: '', core: '', phonetic: '', tag: null };
  }

  let text = name.trim();

  // Etiket sarmalayıcıları yakala: [...] (...) {...} «...» 「...」
  let extractedTag = null;
  const tagMatch = text.match(/^[\[\(\{«「]([^\]\)\}»」]+)[\]\)\}»」]\s*(.*)$/);
  if (tagMatch) {
    extractedTag = tagMatch[1].trim();
    text = `${tagMatch[1]} ${tagMatch[2]}`.trim();
  } else {
    // Sadece sarmalayıcı işaretleri sil
    text = text.replace(/[\[\]\(\)\{\}«»「」]/g, ' ');
  }

  // Türkçe karakter dönüşümleri
  text = text.replace(/[İIışŞğĞüÜöÖçÇâÂîÎûÛ]/g, (ch) => TR_LOWER_MAP[ch] || ch);

  // Unicode NFD ile birleşik işaretleri temizle
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Ayırıcıları boşluğa çevir (_ - . | · • / vb.)
  text = text.replace(/[_.\-|·•\/\\,:;~]/g, ' ');

  // Harf ve rakam dışındakileri temizle (emojiler, süs sembolleri)
  text = text.replace(/[^a-z0-9\s]/g, ' ');

  // 3'ten fazla art arda aynı harfi 2'ye indir (piyadeee -> piyadee)
  text = text.replace(/(.)\1{2,}/g, '$1$1');

  // Boşlukları sadeleştir
  const tokens = text.split(/\s+/).filter(Boolean);
  const full = tokens.join(' ');
  const compact = tokens.join('');

  // Core temsili: genel klan kelimelerini çıkar
  const coreTokens = tokens.filter((tok) => !STOP_WORDS.has(tok) && tok !== extractedTag?.toLowerCase());
  let core = coreTokens.join('');
  if (!core) {
    // Eğer tüm kelimeler stop word idiyse compact'ı koru
    core = compact;
  }

  // Fonetik temsil
  let phonetic = compact;
  for (const [pattern, replacement] of PHONETIC_MAP) {
    phonetic = phonetic.replace(pattern, replacement);
  }

  return {
    full,
    compact,
    core,
    phonetic,
    tag: extractedTag,
  };
}

// ==========================================
// 3. BENZERLİK HESAPLAMA (SIMILARITY)
// ==========================================

/**
 * Levenshtein mesafesi
 */
function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  let v0 = new Array(s2.length + 1);
  let v1 = new Array(s2.length + 1);

  for (let i = 0; i <= s2.length; i++) v0[i] = i;

  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= s2.length; j++) v0[j] = v1[j];
  }

  return v1[s2.length];
}

/**
 * Jaro-Winkler Benzerliği (0 ile 1 arası)
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const l1 = s1.length;
  const l2 = s2.length;
  if (!l1 || !l2) return 0.0;

  const matchWindow = Math.floor(Math.max(l1, l2) / 2) - 1;
  const s1Matches = new Array(l1).fill(false);
  const s2Matches = new Array(l2).fill(false);

  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, l2);
    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < l1; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const jaro =
    (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix scaling
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(l1, l2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Bigram Dice katsayısı (Kelimeler sıralanarak token bazında)
 */
function sortedTokenDice(fullA, fullB) {
  const tokensA = fullA.split(' ').filter(Boolean).sort().join('');
  const tokensB = fullB.split(' ').filter(Boolean).sort().join('');

  if (tokensA === tokensB) return 1.0;
  if (tokensA.length < 2 || tokensB.length < 2) return 0.0;

  const getBigrams = (str) => {
    const map = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const bgA = getBigrams(tokensA);
  const bgB = getBigrams(tokensB);

  let intersection = 0;
  for (const [bg, countA] of bgA.entries()) {
    if (bgB.has(bg)) {
      intersection += Math.min(countA, bgB.get(bg));
    }
  }

  const totalA = tokensA.length - 1;
  const totalB = tokensB.length - 1;
  return (2 * intersection) / (totalA + totalB);
}

/**
 * İki klan ismi arasındaki benzerlik puanını (0 - 1) hesaplar.
 * @param {string | object} inputA 
 * @param {string | object} inputB 
 * @returns {number}
 */
function similarity(inputA, inputB) {
  const normA = typeof inputA === 'string' ? normalizeClanName(inputA) : inputA;
  const normB = typeof inputB === 'string' ? normalizeClanName(inputB) : inputB;

  if (!normA.compact || !normB.compact) return 0.0;
  if (normA.compact === normB.compact) return 1.0;

  // 1. RAKAM KONTROLÜ: Rakam dizileri farklıysa puan en fazla 0.60 ("Team 2" vs "Team 3")
  const digitsA = normA.compact.replace(/[^0-9]/g, '');
  const digitsB = normB.compact.replace(/[^0-9]/g, '');
  if (digitsA !== digitsB && (digitsA.length > 0 || digitsB.length > 0)) {
    return 0.60;
  }

  // 2. KISA İSİM SINIRI (<= 4 karakter)
  const maxLen = Math.max(normA.compact.length, normB.compact.length);
  const minLen = Math.min(normA.compact.length, normB.compact.length);

  if (maxLen <= 4) {
    if (normA.compact === normB.compact) return 1.0;
    const lev = levenshteinDistance(normA.compact, normB.compact);
    if (lev === 1 && normA.compact[0] === normB.compact[0]) {
      return 0.93;
    }
    return 0.70;
  }

  // Çok büyük uzunluk farkı varsa ve kısa olan küçücükse (örn. "DW" vs "Dark Wolves")
  if (minLen <= 2 && maxLen >= 6) {
    return 0.65;
  }

  // 3. ÇEŞİTLİ METRİKLERİN HESAPLANMASI
  const jw = jaroWinkler(normA.compact, normB.compact);

  const levDist = levenshteinDistance(normA.compact, normB.compact);
  const levScore = Math.max(0, 1 - levDist / maxLen);

  const tokenDiceScore = sortedTokenDice(normA.full, normB.full);

  // Core eşitliği veya tam içerme kontrolü
  let coreScore = 0.0;
  if (normA.core && normB.core) {
    if (normA.core === normB.core && normA.core.length >= 3) {
      coreScore = 0.95;
    } else if (
      (normA.core.includes(normB.core) || normB.core.includes(normA.core)) &&
      Math.min(normA.core.length, normB.core.length) >= 4
    ) {
      coreScore = 0.90;
    }
  }

  let bestScore = Math.max(jw, levScore, tokenDiceScore, coreScore);

  // 4. FONETİK KONTROL
  let usedPhonetic = false;
  if (normA.phonetic && normB.phonetic && normA.phonetic === normB.phonetic) {
    const phoneticMatchScore = 0.95 - 0.03; // fonetik ceza 0.03
    if (phoneticMatchScore > bestScore) {
      bestScore = phoneticMatchScore;
      usedPhonetic = true;
    }
  } else if (normA.phonetic && normB.phonetic) {
    const phonLev = levenshteinDistance(normA.phonetic, normB.phonetic);
    const phonScore = Math.max(0, 1 - phonLev / Math.max(normA.phonetic.length, normB.phonetic.length)) - 0.03;
    if (phonScore > bestScore) {
      bestScore = phonScore;
      usedPhonetic = true;
    }
  }

  return Number(Math.min(1.0, Math.max(0.0, bestScore)).toFixed(4));
}

// ==========================================
// 4. ROL ATAMA GÜVENLİĞİ (IS SAFE CLAN ROLE)
// ==========================================

const DANGEROUS_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageWebhooks',
  'ManageNicknames',
  'ManageThreads',
  'ManageEvents',
  'ManageGuildExpressions',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'ViewAuditLog',
  'MentionEveryone',
];

const PROTECTED_ROLE_NAMES = [
  'yonetmenlik', 'developer', 'admin', 'administrator', 'kurucu',
  'staff', 'mod', 'moderator', 'yetkili', 'owner', 'bot',
  'kayitli', 'unregistered', 'kayitsiz', 'uye', 'member',
];

/**
 * Bir Discord rolünün klan rolü olarak atanmasının güvenli olup olmadığını belirler.
 * @param {import('discord.js').Role} role 
 * @param {import('discord.js').Guild} guild 
 * @param {object} config 
 * @param {object} database 
 * @returns {boolean}
 */
function isSafeClanRole(role, guild, config = {}, database = null) {
  if (!role || !guild) return false;

  // @everyone kontrolü
  if (role.id === guild.id || role.name === '@everyone') return false;

  // Bot / Entegrasyon tarafından yönetilen rol
  if (role.managed) return false;

  // Botun en yüksek rolünden yüksek veya eşit mi?
  const botMember = guild.members?.me || guild.members?.cache?.get(guild.client?.user?.id);
  if (botMember && role.position >= botMember.roles.highest.position) {
    return false;
  }

  // Korumalı isim kontrolü
  const normName = normalizeClanName(role.name).compact;
  if (PROTECTED_ROLE_NAMES.some((pn) => normName === pn || normName.includes(pn))) {
    return false;
  }

  // config.ROLES içindeki tüm ID'ler
  const configRoles = config.ROLES || {};
  for (const val of Object.values(configRoles)) {
    if (Array.isArray(val) && val.includes(role.id)) return false;
    if (val === role.id) return false;
  }

  // config.COLOR_ROLES
  if (Array.isArray(config.COLOR_ROLES) && config.COLOR_ROLES.some((cr) => cr.id === role.id)) {
    return false;
  }

  // config.LEVEL_ROLES
  if (Array.isArray(config.LEVEL_ROLES) && config.LEVEL_ROLES.some((lr) => lr.id === role.id)) {
    return false;
  }

  // Database warningRoles & englishRoleId
  if (database && database.data) {
    const warningRoles = database.data.warningRoles || {};
    if (Object.values(warningRoles).includes(role.id)) return false;
    if (database.data.englishRoleId && database.data.englishRoleId === role.id) return false;
  }

  // Tehlikeli izinler
  if (role.permissions) {
    for (const perm of DANGEROUS_PERMISSIONS) {
      if (role.permissions.has(perm)) {
        return false;
      }
    }
  }

  return true;
}

// ==========================================
// 5. KLAN ÇÖZÜMLEME (RESOLVE CLAN)
// ==========================================

/**
 * Kullanıcının yazdığı klan adını mevcut klan rolleri, sunucu rolleri ve dost/düşman listesiyle karşılaştırır.
 * @param {string} typedName 
 * @param {object} ctx 
 * @returns {object}
 */
function resolveClan(typedName, ctx = {}) {
  const {
    registryRoles = [],    // database.getClanRoles()
    safeGuildRoles = [],   // guild.roles.cache where isSafeClanRole is true
    knownClans = [],       // database.getKnownClans()
    ownClanAliases = [
      'piyade', 'piyade team', 'piyade clan', 'tsb piyade', 'piyade tsb', 'piyadeler',
    ],
  } = ctx;

  const normalizedInput = normalizeClanName(typedName);

  // 1. Kendi klanımız mı? (ownClan)
  let isOwn = false;
  for (const alias of ownClanAliases) {
    const normAlias = normalizeClanName(alias);
    if (
      normalizedInput.core === normAlias.core ||
      normalizedInput.compact === normAlias.compact ||
      similarity(normalizedInput, normAlias) >= 0.90
    ) {
      isOwn = true;
      break;
    }
  }

  // 2. Aday listesi oluşturma
  const candidates = [];

  // A) Önce kayıt defterindeki klan rolleri (fuzzy serbest)
  for (const cr of registryRoles) {
    let bestRoleScore = similarity(normalizedInput, cr.compact || cr.name);
    if (Array.isArray(cr.aliases)) {
      for (const al of cr.aliases) {
        const alScore = similarity(normalizedInput, al);
        if (alScore > bestRoleScore) bestRoleScore = alScore;
      }
    }

    candidates.push({
      roleId: cr.roleId,
      name: cr.name,
      score: bestRoleScore,
      source: 'registry',
    });
  }

  // B) Kayıt defterinde olmayıp sadece sunucuda bulunan güvenli roller (SADECE compact tam eşleşme)
  for (const role of safeGuildRoles) {
    if (candidates.some((c) => c.roleId === role.id)) continue;
    const roleNorm = normalizeClanName(role.name);
    if (roleNorm.compact && roleNorm.compact === normalizedInput.compact) {
      candidates.push({
        roleId: role.id,
        name: role.name,
        score: 1.0,
        source: 'guild_exact',
      });
    }
  }

  // Adayları puana göre sırala (en yüksek başta)
  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, 3);
  const topCandidate = topCandidates[0] || null;

  // 3. Karar Eşikleri
  let mode = 'new';
  let bestScore = topCandidate ? topCandidate.score : 0;
  let ambiguous = false;

  if (topCandidate) {
    if (bestScore >= 0.92) {
      mode = 'existing';
    } else if (bestScore >= 0.80) {
      mode = 'suggested';
    } else {
      mode = 'new';
    }

    // Ambiguous kontrolü: İlk iki aday arasındaki fark < 0.03 ve her ikisi de >= 0.80 ise
    if (topCandidates.length >= 2) {
      const secondScore = topCandidates[1].score;
      if (bestScore >= 0.80 && secondScore >= 0.80 && (bestScore - secondScore) < 0.03) {
        ambiguous = true;
        mode = 'suggested';
      }
    }
  }

  // 4. Known Clan (Dost / Düşman Listesi) Kontrolü
  let matchedKnownClan = null;
  let canonicalKnownName = null;

  for (const kc of knownClans) {
    const kcScore = similarity(normalizedInput, kc.compact || kc.name);
    if (kcScore >= 0.88) {
      if (!matchedKnownClan || kcScore > matchedKnownClan.score) {
        matchedKnownClan = {
          id: kc.id,
          name: kc.name,
          type: kc.type,
          score: kcScore,
        };
      }
      if (kcScore >= 0.92) {
        canonicalKnownName = kc.name;
      }
    }
  }

  // 5. Görünen Rol Adı (displayName)
  let displayName = typedName;
  if (mode === 'existing' || mode === 'suggested') {
    displayName = topCandidate ? topCandidate.name : typedName;
  } else {
    // mode 'new' ise
    displayName = canonicalKnownName || typedName;
  }

  return {
    mode,
    roleId: (mode === 'existing' || mode === 'suggested') && topCandidate ? topCandidate.roleId : null,
    displayName,
    score: bestScore,
    candidates: topCandidates,
    knownClan: matchedKnownClan ? { id: matchedKnownClan.id, name: matchedKnownClan.name, type: matchedKnownClan.type } : null,
    ownClan: isOwn,
    ambiguous,
  };
}

module.exports = {
  sanitizeClanName,
  normalizeClanName,
  similarity,
  isSafeClanRole,
  resolveClan,
};
