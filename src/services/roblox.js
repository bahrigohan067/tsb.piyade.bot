/**
 * Roblox API Servisi
 * Roblox profil bilgilerini doğrulamak, kullanıcı ID/adı/detay çekmek ve avatar resmini almak için kullanılır.
 * Eşzamanlı yoğunlukta istekleri sıraya alan basit bir kuyruk (rate-limit/queue) ve 5 sn zaman aşımı içerir.
 */

const { sanitizeTextInput, neutralizeMentions } = require('../utils/inputSanitizer');

const NEW_ACCOUNT_DAYS_THRESHOLD = 30;
const DETAIL_TIMEOUT_MS = 5000;
const RESOLVE_TIMEOUT_MS = 5000;
const DEFAULT_AVATAR_URL =
  'https://tr.rbxcdn.com/30DAY-Avatar-Headshot-Default/150/150/AvatarHeadshot/Png/noFilter';

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
  constructor() {
    this._queue = [];
    this._activeCount = 0;
    this._maxConcurrent = 3;
    this._minDispatchGapMs = 60;
    this._lastDispatchAt = 0;
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
}

const robloxServiceInstance = new RobloxService();

module.exports = robloxServiceInstance;
module.exports.RobloxService = RobloxService;
module.exports.sanitizeAboutText = sanitizeAboutText;
module.exports.computeAccountAgeDays = computeAccountAgeDays;
module.exports.NEW_ACCOUNT_DAYS_THRESHOLD = NEW_ACCOUNT_DAYS_THRESHOLD;
