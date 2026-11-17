const config = require('../../config');
const database = require('./database');

/**
 * Desteklenen Diller Listesi (Merkezi Yapı)
 */
const SUPPORTED_LANGUAGES = ['tr', 'en'];
const DEFAULT_LANGUAGE = 'tr';

/**
 * Sunucuda mevcut 🇬🇧 English rolünü (oluşturmadan) arar.
 */
function findEnglishRoleInGuild(guild) {
  if (!guild || !guild.roles || !guild.roles.cache) return null;

  const candidateIds = [config.ROLES?.ENGLISH, database.getEnglishRoleId()].filter(Boolean);
  for (const id of candidateIds) {
    if (guild.roles.cache.has(id)) {
      return guild.roles.cache.get(id);
    }
  }

  return (
    guild.roles.cache.find(
      (r) =>
        r &&
        r.name &&
        (r.name.toLowerCase() === '🇬🇧 english' ||
          r.name.toLowerCase() === 'english' ||
          r.name.toLowerCase() === 'en')
    ) || null
  );
}

/**
 * Sunucuda "🇬🇧 English" rolünü bulur veya yoksa otomatik oluşturur.
 */
async function ensureEnglishRole(guild) {
  if (!guild) return null;

  const existing = findEnglishRoleInGuild(guild);
  if (existing) {
    if (database.getEnglishRoleId() !== existing.id) {
      database.setEnglishRoleId(existing.id);
    }
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
 * Discord istemci dilinden ('tr' veya 'en') dil kodunu türetir; geçerli locale yoksa null döner.
 */
function deriveLangFromLocale(rawLocale) {
  if (typeof rawLocale !== 'string') return null;
  const clean = rawLocale.trim().toLowerCase();
  if (!clean) return null;
  return clean.startsWith('tr') ? 'tr' : 'en';
}

/**
 * Kullanıcının dil tercihini bilerek ('tr' | 'en' | 'auto') kaydeder ve English rolünü senkronize eder.
 * NOT: Yalnızca /dil komutu tarafından çağrılmalıdır.
 * Rol senkronizasyonu başarısız olursa hata fırlatmaz, sadece loglar.
 */
async function setMemberLanguage(targetMemberOrId, choice) {
  const userId =
    typeof targetMemberOrId === 'string'
      ? targetMemberOrId
      : targetMemberOrId?.id || targetMemberOrId?.user?.id || null;
  const member =
    targetMemberOrId && typeof targetMemberOrId === 'object' && targetMemberOrId.roles
      ? targetMemberOrId
      : null;

  const cleanChoice = choice === 'en' ? 'en' : choice === 'auto' ? 'auto' : 'tr';
  let roleSynced = true;
  let roleAction = 'none';

  if (cleanChoice === 'auto') {
    if (userId) {
      database.clearUserLang(userId);
    }
    if (member && member.guild && member.roles) {
      const enRole = findEnglishRoleInGuild(member.guild);
      if (enRole && member.roles.cache?.has?.(enRole.id)) {
        try {
          await member.roles.remove(enRole.id, 'Dil tercihi: Otomatik (Discord dili)');
          roleAction = 'removed';
        } catch (err) {
          roleSynced = false;
          console.warn(
            `[DİL ROL SENKRON HATASI] ${userId} kullanıcısından English rolü alınamadı:`,
            err.message
          );
        }
      }
    }
    return { lang: 'auto', roleSynced, roleAction };
  }

  if (userId) {
    database.setUserLang(userId, cleanChoice, 'manual');
  }

  if (member && member.guild && member.roles) {
    if (cleanChoice === 'en') {
      const enRole = await ensureEnglishRole(member.guild);
      if (enRole && !member.roles.cache?.has?.(enRole.id)) {
        try {
          await member.roles.add(enRole.id, 'Dil tercihi: English (/dil)');
          roleAction = 'added';
        } catch (err) {
          roleSynced = false;
          console.warn(
            `[DİL ROL SENKRON HATASI] ${userId} kullanıcısına English rolü verilemedi:`,
            err.message
          );
        }
      }
    } else if (cleanChoice === 'tr') {
      const enRole = findEnglishRoleInGuild(member.guild);
      if (enRole && member.roles.cache?.has?.(enRole.id)) {
        try {
          await member.roles.remove(enRole.id, 'Dil tercihi: Türkçe (/dil)');
          roleAction = 'removed';
        } catch (err) {
          roleSynced = false;
          console.warn(
            `[DİL ROL SENKRON HATASI] ${userId} kullanıcısından English rolü alınamadı:`,
            err.message
          );
        }
      }
    }
  }

  return { lang: cleanChoice, roleSynced, roleAction };
}

/**
 * Etkileşim, üye, mesaj veya kullanıcı ID'sinden kullanıcının dilini ('tr' | 'en') çözümler.
 * TAMAMEN YAN ETKİSİZDİR (hiçbir koşulda veritabanına yazmaz ve English rolüne bakmaz).
 *
 * Öncelik sırası:
 * 1. sessionLang ('tr'|'en') verilmişse (oturum/customId/başvuru içi)
 * 2. Veritabanında source === 'manual' olan kayıtlı tercih
 * 3. Etkileşimin Discord istemci dili (interaction.locale: 'tr*' -> 'tr', diğer -> 'en')
 * 4. localeHints[userId] (etkileşimi olmayan DM/zamanlayıcı bağlamları için)
 * 5. source === 'legacy' olan eski kayıt
 * 6. 'tr'
 */
function resolveLang(context, sessionLang = null) {
  if (sessionLang === 'en' || sessionLang === 'tr') {
    return sessionLang;
  }

  let userId = null;
  let locale = null;

  if (typeof context === 'string') {
    userId = context;
  } else if (context && typeof context === 'object') {
    userId = context.user?.id || context.author?.id || context.id || null;
    locale = context.locale || null;
  }

  const langInfo = userId ? database.getUserLangInfo(userId) : null;

  // 2. Bilerek (/dil) seçilmiş kayıtlı tercih
  if (langInfo && langInfo.source === 'manual') {
    return langInfo.lang;
  }

  // 3. Bu etkileşimin Discord istemci dili
  const localeLang = deriveLangFromLocale(locale);
  if (localeLang) {
    return localeLang;
  }

  // 4. Daha önceki etkileşimlerden bilinen istemci dili ipucu
  const hint = userId ? database.getLocaleHint(userId) : null;
  if (hint === 'tr' || hint === 'en') {
    return hint;
  }

  // 5. Eski (legacy) kayıt (yukarıdakilerin hiçbiri yoksa)
  if (langInfo && langInfo.source === 'legacy') {
    return langInfo.lang;
  }

  // 6. Varsayılan
  return DEFAULT_LANGUAGE;
}

/**
 * Etkileşimdeki Discord istemci dilinden localeHints kaydını (yalnızca değiştiyse) günceller.
 */
function updateLocaleHintFromInteraction(interaction) {
  if (!interaction || !interaction.user || !interaction.user.id) return false;
  const derived = deriveLangFromLocale(interaction.locale);
  if (!derived) return false;
  return database.setLocaleHint(interaction.user.id, derived);
}

/**
 * Eski (source === 'legacy') dil kaydı olan bir kullanıcı Türkçe Discord istemcisiyle
 * etkileşime geçtiğinde kaydını sessizce 'tr' yapar ve varsa 🇬🇧 English rolünü kaldırır.
 */
async function healLegacyLanguageOnInteraction(interaction) {
  if (!interaction || !interaction.user || !interaction.user.id) return { healed: false };

  const localeLang = deriveLangFromLocale(interaction.locale);
  if (localeLang !== 'tr') return { healed: false };

  const userId = String(interaction.user.id);
  const info = database.getUserLangInfo(userId);
  if (!info || info.source !== 'legacy') return { healed: false };

  if (info.lang !== 'tr') {
    database.setUserLang(userId, 'tr', 'legacy');
  }

  let removedRole = false;
  const member = interaction.member;
  if (member && member.guild && member.roles && member.roles.cache) {
    const enRole = findEnglishRoleInGuild(member.guild);
    if (enRole && member.roles.cache.has(enRole.id)) {
      try {
        await member.roles.remove(
          enRole.id,
          'Eski dil kaydı Türkçe Discord istemcisiyle eşleştiği için English rolü kaldırıldı'
        );
        removedRole = true;
        console.log(
          `[DİL OTO-DÜZELTME] ${interaction.user.tag || userId} (locale=${interaction.locale}) legacy dil kaydı düzeltildi ve 🇬🇧 English rolü kaldırıldı.`
        );
      } catch (err) {
        // En iyi çaba: yetki vb. hatada kullanıcıyı engelleme
      }
    }
  }

  return { healed: true, removedRole };
}

/**
 * Açılışta veritabanındaki legacy dil kaydı sayısını ve English rolü üye sayısını tek satırda loglar.
 */
function logLanguageStartupStats(guild) {
  const legacyCount = database.getLegacyLangCount();
  let englishRoleCount = 0;

  if (guild) {
    const enRole = findEnglishRoleInGuild(guild);
    if (enRole) {
      if (enRole.members && typeof enRole.members.size === 'number') {
        englishRoleCount = enRole.members.size;
      } else if (guild.members?.cache) {
        englishRoleCount = Array.from(guild.members.cache.values()).filter((m) =>
          m.roles?.cache?.has?.(enRole.id)
        ).length;
      }
    }
  }

  console.log(
    `[DİL SİSTEMİ] Açılış raporu: ${legacyCount} eski (legacy) dil kaydı, ${englishRoleCount} üyede 🇬🇧 English rolü bulunuyor.`
  );
  return { legacyCount, englishRoleCount };
}

/**
 * Türkçe ve İngilizce cinsiyet girdilerini doğru şekilde çözümler.
 */
function parseGenderInput(rawInput, fallbackCustomId = '') {
  const raw = String(rawInput || '').trim().toLowerCase();
  const cid = String(fallbackCustomId || '').trim().toLowerCase();

  let isFemale = false;
  if (raw) {
    if (
      raw === 'm' ||
      raw === 'male' ||
      raw.includes('erkek') ||
      raw === 'boy' ||
      raw === 'man' ||
      raw === 'e'
    ) {
      isFemale = false;
    } else {
      isFemale =
        raw.includes('kız') ||
        raw.includes('kiz') ||
        raw.includes('kadın') ||
        raw.includes('kadin') ||
        raw.includes('bayan') ||
        raw.includes('female') ||
        raw.includes('woman') ||
        raw.includes('girl') ||
        raw === 'k' ||
        raw === 'f';
    }
  } else if (cid) {
    isFemale =
      cid.includes('kız') ||
      cid.includes('kiz') ||
      cid.includes('female') ||
      cid.includes(':f:') ||
      cid.endsWith(':f');
  }

  return {
    isFemale,
    code: isFemale ? 'f' : 'm',
    tr: isFemale ? '👧 Kız' : '👦 Erkek',
    en: isFemale ? '👧 Female' : '👦 Male',
    genderTr: isFemale ? '👧 Kız' : '👦 Erkek',
    genderEn: isFemale ? '👧 Female' : '👦 Male',
  };
}

// Çeviri önbelleği (Aynı metnin tekrar tekrar çevrilmesini önler)
const translationCache = new Map();

/**
 * Türkçe serbest metinleri (örn: uyarı gerekçesi) İngilizceye çevirir.
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
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  findEnglishRoleInGuild,
  ensureEnglishRole,
  deriveLangFromLocale,
  setMemberLanguage,
  resolveLang,
  updateLocaleHintFromInteraction,
  healLegacyLanguageOnInteraction,
  logLanguageStartupStats,
  parseGenderInput,
  translateToEnglish,
};
