# Piyade | Çok Oyunculu Topluluk Discord Botu 🛡️🎮

Bu bot, **Piyade** oyuncu topluluğu için geliştirilmiş, Roblox, Zula, TLauncher (Minecraft) ve CS2 oyunlarını kapsayan, çift dilli (Türkçe & İngilizce), güvenli REST API destekli gelişmiş bir Discord yönetim botudur.

---

## 🚀 Başlıca Özellikler

### 1. 🛡️ Doğrulamalı Kayıt Sistemi (TR / EN)
* **Kayıt Paneli (`/kayit-paneli`):**
  - Mavi temalı Discord Embed formatında, **`✅ Kayıt Ol`** ve **`🇬🇧 Register (English)`** butonlarıyla kurulur.
* **Akış ve Adımlar:**
  - Kullanıcı kayıt butonuna tıkladığında Cinsiyet (Erkek / Kız) seçimi yapar.
  - Açılan modal forma Gerçek Adını ve Roblox bilgisini (Kullanıcı adı, ID veya Profil Linki) girer.
  - Bot hesabı otomatik doğrular, multi-hesap ve ban kontrolü yapar, adaya özel bir alt başlık (Thread) açar.
  - Yetkili onay kanalına başvuru kartı gönderilir.
* **Yetkili Onayı:**
  - Yetkili **`✅ ONAYLA`** butonuna bastığında onaylı üye rolleri ve cinsiyet rolü atanır, Kayıtsız rolü geri alınır, takma adı `{Gerçek Adı} | {Roblox}` olarak güncellenir ve başvuru thread'i otomatik temizlenir.
  - Yetkili **`✖️ REDDET`** butonuna bastığında gerekçe girilir, kullanıcıya DM iletilir ve thread 5 dakika sonra silinir.
* **Kayıt Yönetim Komutları:**
  - `/kayit-bilgi`: Kullanıcının kayıt ve Roblox detaylarını sorgular.
  - `/kayit-sifirla`: Belirtilen kişinin kaydını sıfırlar, Roblox hesabını bot hafızasından siler, tüm rollerini alıp Kayıtsız rolü verir.

---

### 2. ⚖️ Disiplin & Uyarı Sistemi (M1–M13, D1–D3, Y1–Y5)
* **Yetkili Paneli (`/uyari-panel`):**
  - Developer ve Yönetmenlik yetkililerine özel butonlu panel (`Sözlü Uyarı` ve `Resmi Uyarı`).
  - İki dilli ceza kartları ve log kanalında **`🇬🇧 English`** çeviri butonu.
* **Kural Cetveli:**
  - Katılımcı Kuralları: `M1` – `M13` (Puan, Timeout, Kalıcı Ban, Yasaklı rolü)
  - Ses Kanalı Kuralları: `D1` – `D3` (+2 / +3 Puan)
  - Yetkili İhlalleri: `Y1` – `Y5` (+1 Yetkili Uyarı / Yetkilerin Alınması)
* **Kademeler & Karantina:**
  - `Uyarı 1` (2 Puan) → `Uyarı 2` (4 Puan) → `Uyarı 3` (6 Puan + 1 Gün Timeout) → `Uyarı 4` (8 Puan + 2 Gün Timeout) → `Uyarı 5` (10 Puan + 3 Gün Timeout).
  - 15+ Puan Eşiğinde 1 hafta `@Askıda` karantinası.
  - 30 günde bir otomatik ceza puanı affı döngüsü.
* **Uyarı İptali (`/uyari-iptal`):**
  - Hatalı veya affedilen uyarılar ID'si ile iptal edilir, puan ve roller otomatik geri alınır.

---

### 3. 🎨 Kişiselleştirilebilir İsim Rengi Paneli
* **Panel Kurulumu (`/renk_paneli_kur`):**
  - Üyelerin tek tıkla isim renklerini özelleştirmesini sağlar.
  - 6 Canlı Renk: Siyah, Kırmızı, Sarı, Mavi, Yeşil, Pembe.
  - Tek renk kuralı, tıklandığında rengi çıkarma ve 10 saniye bekleme süresi (cooldown) koruması.
  - **`🇬🇧 English`** rehber butonu ile iki dilli destek.

---

### 4. 🔄 Geliştirici Veri Sıfırlama Sistemi (`/veri-sifirla`)
* **Developer Özel Komutu:** Yalnızca Sunucu Sahibi ve Developer rolüne sahip yetkililer çalıştırabilir.
* **Kapsam Seçenekleri:**
  - `Uyarılar` (`warn`): Tüm ceza puanları, sicil geçmişi, askıda karantinaları ve sunucudaki uyarı rollerini temizler.
  - `Kayıtlar` (`reg`): Tüm üye kayıtlarını, aktif/reddedilen başvuruları ve başvuru odalarını temizler.
  - `Hepsi` (`all`): Uyarı ve kayıt verilerinin tamamını güvenli biçimde sıfırlar.
* **Çok Katmanlı Güvenlik:**
  - 1. Adım: Önizleme kartı ile mevcut kayıt adetlerini gösterir.
  - 2. Adım: Büyük harfle **`SIFIRLA`** yazılması zorunlu olan Modal onay penceresi.
  - 3. Adım: İşlem öncesinde `database.backup-reset-<tarih>.json` güvenlik yedeği otomatik alınır (son 5 yedek tutulur). Yedek alınamazsa işlem durdurulur.
  - 4. Adım: Sonuç özeti kullanıcıya gösterilir ve `#uyari-log` kanalına güvenlik denetim kartı gönderilir.

---

### 5. 💬 Web Sitesi Geri Bildirim Sistemi (`POST /api/feedback`)
* Web sitesinden gelen kullanıcı geri bildirimlerini alır ve Discord bildirim kanalına iletir.
* Güvenlik: `X-Actor-Id` doğrulaması, 10 dakikada max 3 ve 24 saatte max 10 hız sınırı, mükerrer mesaj engeli (`409 DUPLICATE`), görünmez karakter temizliği ve `@everyone` / `@here` sızma koruması.

---

## 🛠️ Slash Komutları Özeti

| Komut | Yetki | Açıklama |
|---|---|---|
| `/kayit-paneli` | Yönetici | TR/EN kayıt panelini kurar. |
| `/kayit-bilgi` | Kayıt Yetkilisi | Üyenin veya Roblox ID'sinin kayıt bilgilerini gösterir. |
| `/kayit-sifirla` | Kayıt Yetkilisi & Yönetim | Belirtilen üyenin kaydını ve rollerini sıfırlar, Kayıtsız rolü verir. |
| `/veri-sifirla` | Developer & Sunucu Sahibi | Güvenli yedek alarak Uyarılar, Kayıtlar veya Hepsi için verileri sıfırlar. |
| `/uyari-panel` | Developer & Yönetmenlik | Disiplin & Uyarı Verme Panelini kurar. |
| `/uyari-iptal` | Developer & Yönetmenlik | Verilen bir uyarıyı ID'si ile iptal eder. |
| `/renk_paneli_kur` | Yönetici | İsim rengi seçim panelini kurar. |
| `/temizle` / `!temizle` | Mesajları Yönet | Belirtilen miktarda mesajı kanaldan siler (1 - 300). |
| `/rols` | Kurucu & Developer | Sunucudaki rolleri ve ID'lerini hiyerarşi sırasıyla listeler. |

---

## 🌐 Dahili Güvenli REST API Dokümantasyonu

Bot aynı Node.js sürecinde Express ile çalışarak harici web sitelerine güvenli REST API sunar.

### 🔑 Güvenlik ve Kimlik Doğrulama
- **Tüm `/api/*` endpoint'leri** (şifresiz `/api/health` hariç) `Authorization: Bearer <API_SECRET>` başlığı gerektirir (`401 Unauthorized`).
- Kullanıcı işlemlerinde `X-Actor-Id: <Discord_User_ID>` başlığı gönderilir.
- `/api/admin/*` endpoint'leri yalnızca **Yönetmenlik** (`1559614111128490044`) veya **Developer** (`1561777507223601353`) rollerine sahip aktörler tarafından kullanılabilir.

### 📌 Endpoint Listesi

| Metot | Endpoint | Açıklama | Yetki / Başlık |
|---|---|---|---|
| `GET` | `/api/health` | Bot ve API çalışma durumu (Healthcheck) | Şifresiz |
| `GET` | `/api/member/:id/roles` | Rol listesi + hesaplanan yetki seviyesi | Bearer |
| `GET` | `/api/member/:id/profile` | Gerçek ad, Roblox bilgileri, ceza/uyarı istatistikleri | Bearer |
| `GET` | `/api/register/status/:id` | Başvuru durumu (`approved` / `pending` / `rejected` / `unregistered`) | Bearer |
| `POST` | `/api/register` | Web sitesi üzerinden kayıt başvurusu | Bearer |
| `POST` | `/api/feedback` | Web sitesi geri bildirimi | Bearer + `X-Actor-Id` |
| `GET` | `/api/admin/members?query=` | Sunucu üyeleri arama (isim, nick, ID, Roblox nick) | Bearer + `X-Actor-Id` (Yönetim) |
| `GET` | `/api/admin/members/:id` | Üye tam profili: Discord + Kayıt + Ceza & Sicil Geçmişi | Bearer + `X-Actor-Id` (Yönetim) |
| `POST` | `/api/admin/warn` | Uyarı verme (`verbal` / `official`, M/D/Y kuralları, roller, timeout, ban) | Bearer + `X-Actor-Id` (Yönetim) |
| `POST` | `/api/admin/warn/:id/evidence` | Önceden verilen uyarıya kanıt görseli ekleme | Bearer + `X-Actor-Id` (Yönetim) |

---

## ⚙️ Ortam Değişkenleri (Environment Variables)

| Değişken | Zorunlu mu? | Varsayılan | Açıklama |
|---|---|---|---|
| `TSB_TOKEN` / `DISCORD_TOKEN` | **Evet** | - | Discord Bot Tokeni |
| `GUILD_ID` | Hayır | `1559313292651008040` | Sunucu ID'si |
| `BRAND_NAME` | Hayır | `Piyade` | Topluluk marka adı |
| `API_SECRET` | **Evet (API için)** | - | REST API Bearer gizli anahtarı |
| `PORT` | Hayır | `3000` | Express REST API portu |
| `DATA_DIR` | Hayır | `./data` | Kalıcı veritabanı klasörü |
| `FEEDBACK_CHANNEL_ID` | Hayır | - | Geri bildirimlerin iletileceği Discord kanalı |
| `GEMINI_API_KEY` | Hayır | - | Google Gemini Yapay Zeka API Anahtarı |

---

## 🧪 Test ve Kod Denetimi

Her kod değişikliğinden sonra canlıda tanımsız değişken veya import eksikliği oluşmasını engellemek için:
- `npm run check:undef` : ESLint `no-undef` kuralı ile projedeki tüm JS dosyalarında tanımsız değişkenleri denetler.
- `npm test` : Node.js yerel test koşucusu (`node:test`) ile 32 birim ve entegrasyon testini çalıştırır.
