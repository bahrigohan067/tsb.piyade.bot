/**
 * Roblox API Servisi
 * Roblox profil bilgilerini doğrulamak, kullanıcı ID/adı/detay çekmek ve avatar resmini almak için kullanılır.
 * Eşzamanlı yoğunlukta istekleri sıraya alan basit bir kuyruk (rate-limit/queue) ve 5 sn zaman aşımı içerir.
 */

const { sanitizeTextInput, neutralizeMentions } = require('../utils/inputSanitizer');

const NEW_ACCOUNT_DAYS_THRESHOLD = 30;
const DETAIL_TIMEOUT_MS = 5000;
const RESOLVE_TIMEOUT_MS = 5000;
const AVATAR_TIMEOUT_MS = 5000;
const AVATAR_BATCH_MAX = 100;
const AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 saat
const AVATAR_CACHE_MAX_ENTRIES = 5000;
const AVATAR_MAX_CONCURRENT = 2;
const AVATAR_BACKOFF_BASE_MS = 2000;
const AVATAR_BACKOFF_MAX_MS = 60 * 1000;
const DEFAULT_AVATAR_URL =
  'https://tr.rbxcdn.com/30DAY-Avatar-Headshot-Default/150/150/AvatarHeadshot/Png/noFilter';

/**
 * Roblox küçük resim URL'sinin yalnızca HTTPS üzerinden rbxcdn.com alan adına ait olduğunu doğrular.
 * Geçersiz veya farklı alan adlı URL'ler güvenlik gereği reddedilir (false).
 */
function isValidRbxCdnUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'rbxcdn.com' || host.endsWith('.rbxcdn.com');
  } catch {
    return false;
  }
}

/**
 * Hesap açıklamasını (about) güvenli hale getirir ve en fazla 200 karaktere kısaltır.
 */
function sanitizeAboutText(rawDescription) {
  if (rawDescription === undefined || rawDescription === null) return null;
  const cleaned = neutralizeMentions(sanitizeTextInput(String(rawDescription)))
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/\S*/gi, '[davet]')
    .replace(/([\\*_~`>|[\]])/g, '\\$1');
  if (!cleaned) return '';
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}

/**
 * ISO tarih dizesinden hesap yaşını gün olarak hesaplar.
 */
function computeAccountAgeDays(createdIso) {
  if (!createdIso) return null;
  const parsed = Date.parse(createdIso);
  if (!Number.isFinite(parsed)) return null;
  const diffMs = Math.max(0, Date.now() - parsed);
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

class RobloxService {
  constructor(options = {}) {
    this._queue = [];
    this._activeCount = 0;
    this._maxConcurrent = 3;
    this._minDispatchGapMs = 60;
    this._lastDispatchAt = 0;

    // Toplu avatar küçük resim (headshot) kuyruğu, 6 saatlik önbellek ve 429 geri çekilme durumu
    this._avatarQueue = [];
    this._avatarActiveCount = 0;
    this._avatarMaxConcurrent = options.avatarMaxConcurrent || AVATAR_MAX_CONCURRENT;
    this._avatarCache = new Map(); // Map<robloxId, { url: string, expiresAt: number }>
    this._avatarBackoffUntil = 0;
    this._avatarConsecutive429 = 0;
    this._fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : null;
    this._nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
  }

  /**
   * Aynı anda çok sayıda Roblox API isteği geldiğinde basit kuyruk / hız sınırlaması uygular.
   */
  enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ taskFn, resolve, reject });
      this._drainQueue();
    });
  }

  _drainQueue() {
    if (this._activeCount >= this._maxConcurrent || this._queue.length === 0) {
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, this._lastDispatchAt + this._minDispatchGapMs - now);
    if (waitMs > 0) {
      setTimeout(() => this._drainQueue(), waitMs);
      return;
    }

    const item = this._queue.shift();
    if (!item) return;

    this._activeCount += 1;
    this._lastDispatchAt = Date.now();

    Promise.resolve()
      .then(() => item.taskFn())
      .then((res) => item.resolve(res))
      .catch((err) => item.reject(err))
      .finally(() => {
        this._activeCount -= 1;
        this._drainQueue();
      });
  }

  /**
   * Girilen metinden (Link, ID veya Kullanıcı Adı) Roblox kullanıcısını bulur ve doğrular.
   * @param {string} rawInput
   * @returns {Promise<{success: boolean, user?: object, error?: string, message?: string}>}
   */
  async resolveUser(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') {
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: 'Lütfen geçerli bir Roblox kullanıcı adı, ID veya profil linki giriniz.',
      };
    }

    const input = sanitizeTextInput(rawInput);
    if (!input) {
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: 'Lütfen geçerli bir Roblox kullanıcı adı, ID veya profil linki giriniz.',
      };
    }

    return this.enqueue(async () => {
      try {
        // 1. Durum: Profil Linki (örn: https://www.roblox.com/users/156/profile)
        const linkMatch = input.match(/roblox\.com\/users\/(\d+)/i);
        if (linkMatch) {
          const userId = linkMatch[1];
          return await this.fetchUserById(userId);
        }

        // 2. Durum: Sadece rakamlardan oluşan Kullanıcı ID'si (örn: 156)
        if (/^\d+$/.test(input)) {
          return await this.fetchUserById(input);
        }

        // 3. Durum: Kullanıcı Adı (örn: @builderman veya builderman)
        const cleanUsername = input.replace(/^@/, '').trim();
        if (!cleanUsername) {
          return {
            success: false,
            error: 'INVALID_INPUT',
            message: 'Lütfen geçerli bir Roblox kullanıcı adı giriniz.',
          };
        }
        return await this.fetchUserByUsername(cleanUsername);
      } catch (err) {
        console.error('[ROBLOX SERVICE] Sorgu sırasında beklenmedik hata:', err);
        return {
          success: false,
          error: 'API_ERROR',
          message: 'Roblox API servisine bağlanırken bir sorun oluştu. Lütfen daha sonra tekrar deneyiniz.',
        };
      }
    });
  }

  /**
   * Roblox ID'si ile kullanıcı temel bilgilerini çeker.
   */
  async fetchUserById(userId) {
    try {
      const response = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return {
          success: false,
          error: 'RATE_LIMITED',
          message: 'Roblox API hız sınırına ulaşıldı. Lütfen birkaç dakika sonra tekrar deneyiniz.',
        };
      }

      if (response.status === 404 || response.status === 400) {
        return {
          success: false,
          error: 'NOT_FOUND',
          message: "Girilen Roblox ID'sine ait bir hesap bulunamadı.",
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error: 'API_ERROR',
          message: `Roblox API hatası (Kod: ${response.status}).`,
        };
      }

      const data = await response.json();
      return await this.validateAndFormatUser(data);
    } catch (err) {
      console.error(`[ROBLOX SERVICE] ID (${userId}) sorgulanırken hata:`, err.message);
      return {
        success: false,
        error: 'CONNECTION_ERROR',
        message: 'Roblox sunucularına erişilemedi veya zaman aşımına uğradı.',
      };
    }
  }

  /**
   * Roblox Kullanıcı Adı ile kullanıcı bilgilerini sorgular.
   */
  async fetchUserByUsername(username) {
    try {
      const response = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: false,
        }),
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return {
          success: false,
          error: 'RATE_LIMITED',
          message: 'Roblox API hız sınırına ulaşıldı. Lütfen birkaç dakika sonra tekrar deneyiniz.',
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error: 'API_ERROR',
          message: `Roblox API hatası (Kod: ${response.status}).`,
        };
      }

      const resData = await response.json();
      if (!resData.data || resData.data.length === 0) {
        return {
          success: false,
          error: 'NOT_FOUND',
          message:
            'Bu kullanıcı adına sahip bir Roblox hesabı bulunamadı. Lütfen görünen adınızı (Display Name) değil, asıl **@kullanıcı** adınızı girdiğinizden emin olun.',
        };
      }

      const userBasic = resData.data[0];
      // Ban durumu ve tam detaylar için ID sorgusu yap
      return await this.fetchUserById(userBasic.id);
    } catch (err) {
      console.error(`[ROBLOX SERVICE] Kullanıcı adı (${username}) sorgulanırken hata:`, err.message);
      return {
        success: false,
        error: 'CONNECTION_ERROR',
        message: 'Roblox sunucularına erişilemedi veya zaman aşımına uğradı.',
      };
    }
  }

  /**
   * Arkadaş / Takipçi / Takip Edilen sayısı uç noktalarından tekil sayı çeker (5 sn timeout).
   * Hata durumunda işlemi iptal etmez, null döner ("alınamadı").
   */
  async fetchCountEndpoint(url, label) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data.count === 'number' ? data.count : null;
    } catch (err) {
      console.warn(`[ROBLOX SERVICE] ${label} sayısı alınamadı:`, err.message);
      return null;
    }
  }

  /**
   * Kullanıcı banlı mı kontrol eder ve avatar + profil detaylarını paralel olarak çeker.
   */
  async validateAndFormatUser(userData) {
    // 1. Yasaklı hesap kontrolü
    if (userData.isBanned) {
      return {
        success: false,
        error: 'BANNED',
        message: `Belirtilen Roblox hesabı (**${userData.name}**) Roblox platformunda kalıcı olarak yasaklanmıştır (Banned). Yasaklı hesaplarla kayıt olunamaz!`,
      };
    }

    const userId = userData.id;

    // 2. Avatar ve sosyal istatistikleri paralel ve bağımsız 5 sn zaman aşımıyla çek
    const [avatarSettled, friendsSettled, followersSettled, followingsSettled] =
      await Promise.allSettled([
        this.fetchAvatarUrl(userId),
        this.fetchCountEndpoint(
          `https://friends.roblox.com/v1/users/${userId}/friends/count`,
          'Arkadaş'
        ),
        this.fetchCountEndpoint(
          `https://friends.roblox.com/v1/users/${userId}/followers/count`,
          'Takipçi'
        ),
        this.fetchCountEndpoint(
          `https://friends.roblox.com/v1/users/${userId}/followings/count`,
          'Takip edilen'
        ),
      ]);

    const avatarUrl =
      avatarSettled.status === 'fulfilled' && avatarSettled.value
        ? avatarSettled.value
        : DEFAULT_AVATAR_URL;
    const friendsCount = friendsSettled.status === 'fulfilled' ? friendsSettled.value : null;
    const followersCount = followersSettled.status === 'fulfilled' ? followersSettled.value : null;
    const followingsCount = followingsSettled.status === 'fulfilled' ? followingsSettled.value : null;

    const createdAt = userData.created || null;
    const accountAgeDays = computeAccountAgeDays(createdAt);
    const isNewAccount =
      accountAgeDays !== null && accountAgeDays < NEW_ACCOUNT_DAYS_THRESHOLD;
    const hasVerifiedBadge =
      typeof userData.hasVerifiedBadge === 'boolean' ? userData.hasVerifiedBadge : null;
    const about = sanitizeAboutText(userData.description);

    return {
      success: true,
      user: {
        id: userData.id,
        name: userData.name,
        displayName: userData.displayName || userData.name,
        profileUrl: `https://www.roblox.com/users/${userData.id}/profile`,
        avatarUrl,
        createdAt,
        accountAgeDays,
        isNewAccount,
        hasVerifiedBadge,
        about,
        friendsCount,
        followersCount,
        followingsCount,
      },
    };
  }

  /**
   * Roblox Avatar kafa/gövde resmini çeker (5 sn timeout).
   */
  async fetchAvatarUrl(userId) {
    try {
      const response = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.data && data.data.length > 0 && data.data[0].imageUrl) {
          return data.data[0].imageUrl;
        }
      }
    } catch (err) {
      console.warn(`[ROBLOX SERVICE] Avatar çekilemedi (${userId}):`, err.message);
    }

    // Yedek avatar URL (varsayılan)
    return DEFAULT_AVATAR_URL;
  }

  /**
   * Toplu avatar istekleri için en çok 2 eşzamanlı istek çalıştıran iç kuyruk.
   */
  _enqueueAvatarTask(taskFn) {
    return new Promise((resolve, reject) => {
      this._avatarQueue.push({ taskFn, resolve, reject });
      this._drainAvatarQueue();
    });
  }

  _drainAvatarQueue() {
    while (this._avatarActiveCount < this._avatarMaxConcurrent && this._avatarQueue.length > 0) {
      const item = this._avatarQueue.shift();
      if (!item) break;
      this._avatarActiveCount += 1;

      Promise.resolve()
        .then(() => item.taskFn())
        .then((res) => item.resolve(res))
        .catch((err) => item.reject(err))
        .finally(() => {
          this._avatarActiveCount -= 1;
          this._drainAvatarQueue();
        });
    }
  }

  /**
   * 6 saatlik avatar önbelleğini ve 429 geri çekilme sayacını temizler (testler için).
   */
  clearAvatarHeadshotCache() {
    this._avatarCache.clear();
    this._avatarBackoffUntil = 0;
    this._avatarConsecutive429 = 0;
  }

  /**
   * Önbellek boyutunu üst sınırda tutarak belleğin büyümesini engeller.
   */
  _setCachedAvatarUrl(robloxId, url, now) {
    if (this._avatarCache.size >= AVATAR_CACHE_MAX_ENTRIES) {
      for (const [key, entry] of this._avatarCache.entries()) {
        if (entry.expiresAt <= now) {
          this._avatarCache.delete(key);
        }
      }
      if (this._avatarCache.size >= AVATAR_CACHE_MAX_ENTRIES) {
        const firstKey = this._avatarCache.keys().next().value;
        if (firstKey !== undefined) {
          this._avatarCache.delete(firstKey);
        }
      }
    }
    this._avatarCache.set(robloxId, {
      url,
      expiresAt: now + AVATAR_CACHE_TTL_MS,
    });
  }

  /**
   * Herkese açık Roblox thumbnails API'si üzerinden en çok 100'lü gruplar hâlinde
   * kullanıcı avatar başlık (headshot) URL'lerini toplu çeker.
   * - Roblox hesabına giriş veya .ROBLOSECURITY çerezi KULLANMAZ.
   * - Sonuçları 6 saat bellek önbelleğinde tutar.
   * - Her istek 5 sn zaman aşımlı, en çok 2 eşzamanlı ve 429'da geri çekilmelidir.
   * - Yalnızca https://*.rbxcdn.com URL'lerini kabul eder; başarısız/geçersiz olanlar için null döner (asla hata fırlatmaz).
   * - Konsola kullanıcı kimliği veya kullanıcı adı yazmaz.
   *
   * @param {Array<string|number>} robloxIds
   * @param {object} [options] - Test veya çağrı özelleştirmesi ({ fetchFn, nowFn, timeoutMs })
   * @returns {Promise<Map<string, string|null>>}
   */
  async getAvatarHeadshots(robloxIds, options = {}) {
    const result = new Map();
    if (!Array.isArray(robloxIds) || robloxIds.length === 0) {
      return result;
    }

    const nowFn = typeof options.nowFn === 'function' ? options.nowFn : this._nowFn;
    const fetchFn =
      typeof options.fetchFn === 'function'
        ? options.fetchFn
        : this._fetchFn || global.fetch;
    const timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : AVATAR_TIMEOUT_MS;
    const now = nowFn();

    // 1. Geçerli rakamsal Roblox ID'lerini tekilleştir ve önce 6 saatlik önbellekten karşıla
    const missingIds = [];
    const seen = new Set();

    for (const rawId of robloxIds) {
      const cleanId = String(rawId ?? '').trim();
      if (!/^\d{1,20}$/.test(cleanId)) continue;
      if (seen.has(cleanId)) continue;
      seen.add(cleanId);

      const cached = this._avatarCache.get(cleanId);
      if (cached && cached.expiresAt > now && isValidRbxCdnUrl(cached.url)) {
        result.set(cleanId, cached.url);
      } else {
        if (cached && cached.expiresAt <= now) {
          this._avatarCache.delete(cleanId);
        }
        result.set(cleanId, null);
        missingIds.push(cleanId);
      }
    }

    if (missingIds.length === 0 || typeof fetchFn !== 'function') {
      return result;
    }

    // 2. 429 geri çekilme penceresi aktifse yeni ağ çağrısı atmadan null dön
    if (now < this._avatarBackoffUntil) {
      return result;
    }

    // 3. Eksik ID'leri en çok 100'lük parçalara böl ve eşzamanlı max 2 sınırıyla çek
    const chunks = [];
    for (let i = 0; i < missingIds.length; i += AVATAR_BATCH_MAX) {
      chunks.push(missingIds.slice(i, i + AVATAR_BATCH_MAX));
    }

    const fetchChunk = async (chunkIds) => {
      return this._enqueueAvatarTask(async () => {
        const currentNow = nowFn();
        if (currentNow < this._avatarBackoffUntil) {
          return;
        }

        const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(
          chunkIds.join(',')
        )}&size=150x150&format=Png&isCircular=false`;

        try {
          const response = await fetchFn(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (!response) return;

          // 429 hız sınırında basit geri çekilme (Retry-After veya üstel artış)
          if (response.status === 429) {
            this._avatarConsecutive429 += 1;
            let delayMs = Math.min(
              AVATAR_BACKOFF_MAX_MS,
              AVATAR_BACKOFF_BASE_MS * Math.pow(2, this._avatarConsecutive429 - 1)
            );
            const retryAfterHeader = response.headers?.get?.('retry-after');
            const retrySec = Number(retryAfterHeader);
            if (Number.isFinite(retrySec) && retrySec > 0) {
              delayMs = Math.min(AVATAR_BACKOFF_MAX_MS, Math.max(1000, Math.floor(retrySec * 1000)));
            }
            this._avatarBackoffUntil = nowFn() + delayMs;
            return;
          }

          if (!response.ok) {
            return;
          }

          // Başarılı yanıtta 429 geri çekilmesini sıfırla
          this._avatarConsecutive429 = 0;
          this._avatarBackoffUntil = 0;

          const body = await response.json().catch(() => null);
          const entries = Array.isArray(body?.data) ? body.data : [];
          const writeNow = nowFn();

          for (const entry of entries) {
            if (!entry || entry.targetId === undefined || entry.targetId === null) continue;
            const targetId = String(entry.targetId).trim();
            if (!result.has(targetId)) continue;

            const state = typeof entry.state === 'string' ? entry.state : '';
            const imageUrl = typeof entry.imageUrl === 'string' ? entry.imageUrl.trim() : '';

            if (state === 'Completed' && isValidRbxCdnUrl(imageUrl)) {
              result.set(targetId, imageUrl);
              this._setCachedAvatarUrl(targetId, imageUrl, writeNow);
            } else {
              result.set(targetId, null);
            }
          }
        } catch {
          // Zaman aşımı veya ağ hatasında asla hata fırlatma ve konsola kullanıcı kimliği yazma
        }
      });
    };

    await Promise.all(chunks.map((chunk) => fetchChunk(chunk)));
    return result;
  }
}

const robloxServiceInstance = new RobloxService();

module.exports = robloxServiceInstance;
module.exports.RobloxService = RobloxService;
module.exports.isValidRbxCdnUrl = isValidRbxCdnUrl;
module.exports.sanitizeAboutText = sanitizeAboutText;
module.exports.computeAccountAgeDays = computeAccountAgeDays;
module.exports.NEW_ACCOUNT_DAYS_THRESHOLD = NEW_ACCOUNT_DAYS_THRESHOLD;
module.exports.AVATAR_CACHE_TTL_MS = AVATAR_CACHE_TTL_MS;
module.exports.AVATAR_BATCH_MAX = AVATAR_BATCH_MAX;
module.exports.AVATAR_TIMEOUT_MS = AVATAR_TIMEOUT_MS;
module.exports.AVATAR_MAX_CONCURRENT = AVATAR_MAX_CONCURRENT;
