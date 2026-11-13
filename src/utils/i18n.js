const database = require('./database');

/**
 * Sunucuda "🇬🇧 English" rolünü bulur veya yoksa otomatik oluşturur.
 */
async function ensureEnglishRole(guild) {
  if (!guild) return null;

  const savedId = database.getEnglishRoleId();
  if (savedId && guild.roles.cache.has(savedId)) {
    return guild.roles.cache.get(savedId);
  }

  const existing = guild.roles.cache.find(
    (r) =>
      r.name.toLowerCase() === '🇬🇧 english' ||
      r.name.toLowerCase() === 'english' ||
      r.name.toLowerCase() === 'en'
  );

  if (existing) {
    database.setEnglishRoleId(existing.id);
    return existing;
  }

  try {
    const created = await guild.roles.create({
      name: '🇬🇧 English',
      color: 0x3498DB,
      hoist: false,
      mentionable: false,
      reason: 'İngilizce konuşan üyeler için dil rolü',
    });
    database.setEnglishRoleId(created.id);
    return created;
  } catch (err) {
    // Botun rol oluşturma yetkisi yoksa yalnızca veritabanı kaydı kullanılır
    return null;
  }
}

/**
 * Kullanıcının dil tercihini ('tr' veya 'en') kaydeder ve gerekirse 🇬🇧 English rolünü senkronize eder.
 */
async function setMemberLanguage(member, lang) {
  const cleanLang = lang === 'en' ? 'en' : 'tr';
  const userId = member?.id || member?.user?.id;
  if (userId) {
    database.setUserLang(userId, cleanLang);
  }

  if (member && member.guild && member.roles) {
    const enRole = await ensureEnglishRole(member.guild);
    if (enRole) {
      if (cleanLang === 'en' && !member.roles.cache.has(enRole.id)) {
        await member.roles.add(enRole.id, 'Dil tercihi: English').catch(() => {});
      } else if (cleanLang === 'tr' && member.roles.cache.has(enRole.id)) {
        await member.roles.remove(enRole.id, 'Dil tercihi: Türkçe').catch(() => {});
      }
    }
  }

  return cleanLang;
}

/**
 * Etkileşim, üye, mesaj veya kullanıcı ID'sinden kullanıcının dilini ('tr' | 'en') çözümler.
 * Öncelik sırası:
 * 1. Explicit parametre ('en' / 'tr')
 * 2. Veritabanında kayıtlı dil tercihi
 * 3. Üyede 🇬🇧 English rolü bulunması
 * 4. Discord istemci dili (interaction.locale)
 * 5. Varsayılan: 'tr'
 */
function resolveLang(context, explicitLang = null) {
  let userId = null;
  let member = null;
  let locale = null;

  if (typeof context === 'string') {
    userId = context;
  } else if (context && typeof context === 'object') {
    userId = context.user?.id || context.author?.id || context.id || null;
    member = context.member || (context.roles ? context : null);
    locale = context.locale || null;
  }

  if (explicitLang === 'en' || explicitLang === 'tr') {
    if (userId) database.setUserLang(userId, explicitLang);
    return explicitLang;
  }

  if (userId) {
    const saved = database.getUserLang(userId);
    if (saved === 'en' || saved === 'tr') {
      return saved;
    }
  }

  if (member && member.roles && member.roles.cache) {
    const enRoleId = database.getEnglishRoleId();
    const cacheValues = Array.from(member.roles.cache.values());
    const hasEnRole =
      (enRoleId && member.roles.cache.has(enRoleId)) ||
      cacheValues.some(
        (r) =>
          r && r.name &&
          (r.name.toLowerCase() === '🇬🇧 english' ||
           r.name.toLowerCase() === 'english')
      );
    if (hasEnRole) {
      if (userId) database.setUserLang(userId, 'en');
      return 'en';
    }
  }

  if (locale && typeof locale === 'string' && !locale.toLowerCase().startsWith('tr')) {
    return 'en';
  }

  return 'tr';
}

/**
 * Türkçe ve İngilizce cinsiyet girdilerini doğru şekilde çözümler.
 */
function parseGenderInput(rawInput, fallbackCustomId = '') {
  const raw = String(rawInput || '').trim().toLowerCase();
  const cid = String(fallbackCustomId || '').toLowerCase();

  const checkStr = raw || cid;
  const isFemale =
    checkStr.includes('kız') ||
    checkStr.includes('kiz') ||
    checkStr.includes('kadın') ||
    checkStr.includes('kadin') ||
    checkStr.includes('bayan') ||
    checkStr.includes('female') ||
    checkStr.includes('woman') ||
    checkStr.includes('girl') ||
    checkStr === 'k' ||
    checkStr === 'f';

  return {
    isFemale,
    tr: isFemale ? '👩 Kız' : '👨 Erkek',
    en: isFemale ? '👩 Female' : '👨 Male',
    genderTr: isFemale ? '👩 Kız' : '👨 Erkek',
    genderEn: isFemale ? '👩 Female' : '👨 Male',
  };
}

// Çeviri önbelleği (Aynı metnin tekrar tekrar çevrilmesini önler)
const translationCache = new Map();

/**
 * Türkçe serbest metinleri (Örn: Tryout değerlendirme açıklaması) İngilizceye çevirir.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function translateToEnglish(text) {
  const clean = String(text || '').trim();
  if (!clean) return 'Not specified.';

  if (translationCache.has(clean)) {
    return translationCache.get(clean);
  }

  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=tr&tl=en&dt=t&q=` +
      encodeURIComponent(clean.slice(0, 1800));

    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = data[0]
          .map((part) => (Array.isArray(part) ? part[0] : ''))
          .join('')
          .trim();

        if (translated) {
          translationCache.set(clean, translated);
          if (translationCache.size > 300) {
            translationCache.delete(translationCache.keys().next().value);
          }
          return translated;
        }
      }
    }
  } catch (err) {
    // Çeviri servisine ulaşılamazsa orijinal metni koru
  }

  return clean;
}

module.exports = {
  ensureEnglishRole,
  setMemberLanguage,
  resolveLang,
  parseGenderInput,
  translateToEnglish,
};
