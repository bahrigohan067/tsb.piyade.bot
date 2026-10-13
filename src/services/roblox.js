/**
 * Roblox API Servisi
 * Roblox profil bilgilerini doğrulamak, kullanıcı ID/adı çekmek ve avatar resmini almak için kullanılır.
 */

class RobloxService {
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

    const input = rawInput.trim();

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
      return await this.fetchUserByUsername(cleanUsername);
    } catch (err) {
      console.error('[ROBLOX SERVICE] Sorgu sırasında beklenmedik hata:', err);
      return {
        success: false,
        error: 'API_ERROR',
        message: 'Roblox API servisine bağlanırken bir sorun oluştu. Lütfen daha sonra tekrar deneyiniz.',
      };
    }
  }

  /**
   * Roblox ID'si ile kullanıcı bilgilerini çeker.
   */
  async fetchUserById(userId) {
    try {
      const response = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (response.status === 404 || response.status === 400) {
        return {
          success: false,
          error: 'NOT_FOUND',
          message: 'Girilen Roblox ID\'sine ait bir hesap bulunamadı.',
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
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: false,
        }),
        signal: AbortSignal.timeout(8000),
      });

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
          message: 'Bu kullanıcı adına sahip bir Roblox hesabı bulunamadı. Lütfen görünen adınızı (Display Name) değil, asıl **@kullanıcı** adınızı girdiğinizden emin olun.',
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
   * Kullanıcı banlı mı kontrol eder ve avatar resmini çeker.
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

    // 2. Avatar Thumbnail çekme
    const avatarUrl = await this.fetchAvatarUrl(userData.id);

    return {
      success: true,
      user: {
        id: userData.id,
        name: userData.name,
        displayName: userData.displayName || userData.name,
        profileUrl: `https://www.roblox.com/users/${userData.id}/profile`,
        avatarUrl: avatarUrl,
        createdAt: userData.created,
      },
    };
  }

  /**
   * Roblox Avatar kafa/gövde resmini çeker.
   */
  async fetchAvatarUrl(userId) {
    try {
      const response = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000),
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
    return 'https://tr.rbxcdn.com/30DAY-Avatar-Headshot-Default/150/150/AvatarHeadshot/Png/noFilter';
  }
}

module.exports = new RobloxService();
