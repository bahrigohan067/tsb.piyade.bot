# Piyade Team | TSB | Kayıt & VS (Kapışma) Botu 🛡️⚔️

Bu bot, **Piyade Team | TSB** Discord sunucusu için geliştirilmiş, Roblox API doğrulamalı kayıt sistemi ve tam teşekküllü **VS (Kapışma) Talep & Top 10 Sıralama Sistemi** içeren gelişmiş bir sunucu yönetim botudur.

---

## 🚀 Başlıca Özellikler

### 1. 🛡️ Roblox Doğrulamalı ve Çift Akışlı Kayıt Sistemi (Piyade & Başka Klan)
* **Gelişmiş Kayıt Paneli (`/kayit-paneli`):**
  - Mavi temalı Discord Embed formatında ve **`✅ Kayıt Ol`** / **`🇬🇧 Register`** butonlarıyla kurulur.
* **Ön Kontroller:**
  - `isRegisteredMember(member)` kontrolü ile hem `<@&1559604702143062016>` (Piyade Üye) hem de `<@&1570460155437518960>` (Other Clan) rolüne sahip olanların mükerrer kaydı engellenir.
  - Aktif başvurusu olanlar devam eden odalarına yönlendirilir.
* **Kayıt Türü Seçimi (Piyade vs Başka Klan):**
  - Butona tıklandığında kullanıcıya iki seçenek sunulur:
    1. **`🛡️ Piyade Klanına Katılmak İstiyorum`** (`btn_reg_type_own`): Standart 3 alanlı kayıt formu açılır.
    2. **`🏳️ Bir Klanım Bulunmakta`** (`btn_reg_type_other`): 4 alanlı kayıt formu açılır (ek olarak Klan Adı sorulur).
* **Kayıt Formu (`KayitModal`):**
  - Cinsiyet seçimi açılır menüsü (👨 Erkek / 👩 Kız).
  - Gerçek Adı (Ad Soyad) ve Roblox Bilgisi (Kullanıcı Adı, ID veya Profil Linki).
  - Başka klandan gelenler için ek alan: **Klanınızın Adı** (2 - 32 karakter).
* **Toleranslı Klan Eşleştirme Motoru (`clanMatcher`):**
  - Özel klan motoru; harf hataları, etiketler (`[TAG]`), boşluk ve büyük/küçük harf farklarına toleranslı olarak mevcut rolleri eşleştirir.
  - Eşleşen rol yoksa yetkili onayında otomatik olarak `<@&1570460155437518960>` hiyerarşisi altında yeni klan rolü oluşturur (Sunucu 245 rol güvenlik sınırını aşamaz).
* **Rol Tanımlama ve Ayrım:**
  - Formdaki cinsiyet okunarak kayıt onaylandığında:
    - Erkek ise: `<@&1559637360558350356>` Erkek rolü tanımlanır.
    - Kız ise: `<@&1559637300042797096>` Kız rolü tanımlanır.
    - `<@&1559604540997636147>` Kayıtsız rolü üzerinden geri alınır.
    - **Piyade Klanı Üyesi İse:** `<@&1559604645821812896>` (Hesabı Onaylı) ve `<@&1559604702143062016>` (Piyade Üye) rolleri tanımlanır.
    - **Başka Klan Üyesi İse:** `<@&1559604645821812896>` (Hesabı Onaylı) ve `<@&1570460155437518960>` (Other Clan) rolü ile birlikte eşleşen/oluşturulan **Özel Klan Rolü** tanımlanır (Piyade Üye rolü ASLA verilmez).
* **Yetkili Onay Kartı & Müdahale:**
  - Yetkiliye giden başvuru kartında klan eşleşme durumu (Mevcut / Önerilen / Yeni Rol) skoruyla gösterilir.
  - Yetkililer **`✏️ Klanı Değiştir`** (`btn_clan_edit_<userId>`) butonuyla klan rolü kararını modal üzerinden diledikleri gibi güncelleyebilirler.
* **Takma Ad (Nickname) Formatı:**
  - Onaylanan üyenin sunucu içi takma adı otomatik olarak:
    `{Formda yazdığı gerçek adı} | {Roblox Oyuncu Nicki}`
    olarak ayarlanır.
* **Özel Oda Temizliği:**
  - Kayıt onaylandığında açılan özel alt başlık (Thread) otomatik olarak **silinir**.
* **Otomatik Kayıtsız Rolü:**
  - Sunucuya yeni katılan her kullanıcıya anında `<@&1559604540997636147>` rolü tanımlanır.

---

### 2. ⚔️ VS (Kapışma) Talep ve Sonuç Sistemi
* **Panel Kurulumu (`/vs_talep_panel_kur`):**
  - `[vs talep]` (`1559317566617554975`) kanalına kuralları ve **"⚔️ VS Talep Oluştur"** butonunu içeren şık paneli kurar.
* **Başvuru & Rakip Seçimi:**
  - Oyuncu butona tıklar, açılan menüden rakibini seçer.
  - Kendisiyle veya bir bot ile kapışamaz.
  - Açık VS talebi olan ikinci bir talep açamaz.
* **Özel VS Kanalı:**
  - Panel kategorisinde gizli `vs-{talep_acan}-vs-{magdur}` kanalı oluşturulur.
  - Sadece **Meydan Okuyan**, **Rakip** ve `<@&1559892661547307038>` (**Kapışma Talep Yetkilisi**) odayı görebilir ve yazabilir.
  - Odaya karar butonu içeren bilgilendirme mesajı atılır ve sabitlenir (`pin`):
    1. 🟢 `[Açan İsmi] Kazandı`
    2. 🔵 `[Rakip İsmi] Kazandı`
    3. 🔴 `Talep İptal Edildi`
* **48 Saat (2 Gün) Süre ve Otomatik Kontrol:**
  - Arka planda çalışan kontrol döngüsü (`vs_deadline_check`) her **30 dakikada bir** kanalları denetler.
  - **Son 5 Saat Uyarısı:** 43. saatte odaya uyarı mesajı atılır.
  - **Zaman Aşımı:** 48 saat içinde sonuçlandırılmayan odalar odaya bilgi verilip 5 saniye sonra otomatik silinir.
* **Karar & Sonuçlandırma:**
  - Karar butonlarına yalnızca `<@&1559892661547307038>` Kapışma Talep Yetkilileri basabilir.
  - **İptal Durumu:** Oda kalıcı olarak silinir.
  - **Kazanan Durumu:**
    1. Kazananın kill sayısı +1 artırılır.
    2. `[vs sonuç]` (`1559317757294546975`) kanalına özel emojilerle donatılmış yeşil sonuç kartı düşer.
    3. `[top 10]` (`1559318329775104020`) kanalındaki sıralama tablosu anında güncellenir.
    4. VS odası 5 saniye sonra kalıcı olarak silinir.

---

### 3. 🏆 Top 10 Sıralama Sistemi
* `[top 10]` (`1559318329775104020`) kanalında sürekli güncellenen sarı-turuncu temalı sıralama tablosu:
  - En çok kill alan oyuncular en üstte (1-10) listelenir.
  - 10 kişiden az varsa mevcut kişi sayısına göre sıralanır.
  - Listenin en sonundaki oyuncunun yanında `<a:778420loopingirongolem:1559910628141957171>` emojisi yer alır.
* İstenirse `/top10_guncelle` komutu ile tablo anında manuel olarak da yenilenebilir.

---

### 4. 🚨 Acil Takviye & Yardım Çağrısı Sistemi
* **Panel Kurulumu (`/yardim_paneli_kur`):**
  - `https://discord.com/channels/1559313292651008040/1559323174594945104` kanalına **Kırmızı** temalı acil yardım paneli kurulur.
* **Canlı Discord Aktiflik Göstergesi:**
  - Bot anlık olarak `<@&1559604702143062016>` rolüne sahip tüm kullanıcıların Discord aktifliklerini kontrol eder.
  - Paneli **30 saniyede bir** güncelleyerek: Çevrim içi (🟢), Boşta (🌙), Rahatsız Etmeyin (⛔), Çevrim dışı (⚫) sayılarını ve anlık aktif üyeleri gösterir.
* **Acil Yardım Çağrısı:**
  - TSB oyununda 1v3 / teamer baskısına uğrayan veya yardıma ihtiyacı olan üye **`🚨 ACİL YARDIM ÇAĞIR`** butonuna basar.
  - Bildirim kanalına (`https://discord.com/channels/1559313292651008040/1559928245598560336`) en başta `<@&1559604702143062016>` rolü etiketlenerek acil durum alarm kartı düşer.
* **5 Dakika Bekleme Süresi (Cooldown):**
  - Butona basan üye **5 dakika** boyunca tekrar butona basamaz.

---

### 5. 🤝⚔️ Dost ve Düşman Klanlar Paneli
* **Canlı Liste Paneli (`/klan-paneli-kur`):**
  - `[klan paneli]` (`1570462108691210432`) kanalına tek bir mesaj altında iki şık Discord Embed kartı kurar:
    1. ⚪ **Dost Klanlar** (`0xF2F3F5` - Beyaz tema)
    2. ⚫ **Düşman Klanlar** (`0x0D0D0D` - Siyah tema)
  - Bot her başladığında veya `/klan-ekle`, `/klan-duzenle`, `/klan-sil` komutları çalıştırıldığında bu paneldeki mesajı otomatik olarak günceller (yeni mesaj atıp kanalı kirletmez).
* **Slash Komutları ile Kolay Yönetim:**
  - `/klan-ekle`: Yeni dost veya düşman klan kaydı oluşturur.
  - `/klan-duzenle`: Mevcut bir klanın adını veya dost/düşman türünü günceller (otomatik tamamlama destekli).
  - `/klan-sil`: Klan kaydını sistemden kaldırır (otomatik tamamlama destekli).
  - `/klan-liste`: Tüm klanları yetkiliye anlık liste olarak döker.

---

## 🛠️ Slash Komutları Listesi

| Komut | Yetki | Açıklama |
|---|---|---|
| `/kayit-paneli` | Yönetici | Çift akışlı (Piyade & Başka Klan) kayıt panelini kurar. |
| `/kayit-bilgi` | Yetkili | Bir üyenin veya Roblox ID'sinin kayıt detaylarını (Kayıt türü ve klan rolü dahil) sorgular. |
| `/kayit-sifirla` | Kayıt Yetkilisi & Yönetim | Seçilen kişinin kaydını ve Roblox bilgisini siler, tüm rollerini alıp Kayıtsız rolü verir. |
| `/klan-paneli-kur` | Yönetici | Dost ve Düşman klanlar panelini ilgili kanala kurar / yeniler. |
| `/klan-ekle` | Yönetici | Sisteme yeni bir dost veya düşman klan ekler. |
| `/klan-duzenle` | Yönetici | Kayıtlı bir klanın adını veya türünü (Dost/Düşman) günceller. |
| `/klan-sil` | Yönetici | Kayıtlı bir klanı sistemden siler. |
| `/klan-liste` | Yetkili | Dost ve düşman klanların listesini gösterir. |
| `/vs_talep_panel_kur` | Yönetici | VS Talep panelini ilgili kanala kurar. |
| `/top10_guncelle` | Yönetici | Top 10 sıralama tablosunu anında yeniler. |
| `/yardim_paneli_kur` | Yönetici | Acil Yardım ve Takviye Çağrısı panelini kurar. |
| `/uyari-panel` | Developer & Yönetmenlik | Disiplin & Uyarı Verme Panelini kurar. |
| `/uyari-iptal` | Developer & Yönetmenlik | Verilen bir uyarıyı ID'si ile iptal eder. |
| `/form-iptal` | Yönetmenlik | Tryout seviye anketini iptal eder ve rolleri geri döndürür. |
| `/renk_paneli_kur` | Yönetici | İsim rengi seçim panelini kurar. |
| `!temizle [sayı]` / `/temizle` | Mesajları Yönet | Belirtilen miktarda mesajı kanaldan siler (1 - 300). |
| `/rols` | Kurucu & Developer | Sunucudaki rolleri ve ID'lerini hiyerarşi sırasıyla listeler. |

---

## 🌐 Dahili Güvenli REST API Dokümantasyonu

Bot aynı Node.js sürecinde Express ile çalışarak harici web sitelerine ve yönetim panellerine güvenli REST API hizmeti sunar.

### 🔑 Güvenlik ve Kimlik Doğrulama
- **Tüm `/api/*` endpoint'leri** (açık `/api/health` hariç) `Authorization: Bearer <API_SECRET>` başlığı gerektirir. Eksik veya geçersizse `401 Unauthorized` döner.
- Kullanıcı adına işlem yapan veya yönetim işlemi gerektiren endpoint'lerde `X-Actor-Id: <Discord_User_ID>` başlığı gönderilir. Bot bu üyenin Discord rollerini bizzat doğrular.
- **Yönetim Yetkisi:** `/api/admin/*` endpoint'leri sadece **Yönetmenlik** (`1559614111128490044`) veya **Developer** (`1561777507223601353`) rollerine sahip aktörler tarafından kullanılabilir. Aksi takdirde `403 Forbidden` döner.
- **Uyarı Hiyerarşisi:**
  - Kimse kendine uyarı veremez.
  - Hedefin en yüksek rolü, işlemi yapan aktörünkine eşit veya üstteyse işlem `403` ile reddedilir.
  - Hiyerarşi: Developer > Yönetmenlik > Diğerleri.
  - **Developer İstisnası:** Developer kendisi dışında herkese uyarı verebilir.
- **Denetim Logu:** Web sitesi paneli üzerinden yapılan her idari işlem (uyarı verme, kanıt yükleme vb.) bot tarafından `#uyari-log` kanalına anında denetim kartı olarak loglanır.

### 📌 Endpoint Listesi

| Metot | Endpoint | Açıklama | Yetki / Başlık |
|---|---|---|---|
| `GET` | `/api/health` | Bot ve API çalışma durumu (Healthcheck) | Şifresiz |
| `GET` | `/api/member/:id/roles` | Rol listesi + türetilmiş seviye (`developer` / `yonetmenlik` / `member`) | Bearer |
| `GET` | `/api/member/:id/profile` | Gerçek ad, Roblox profil, Tryout seviyesi, VS puan/kill, ceza puanı | Bearer |
| `GET` | `/api/tryout/leaderboard` | 37 kademeli Tryout sıralama tablosu verisi | Bearer |
| `GET` | `/api/vs/top10` | VS Top 10 sıralama tablosu verisi | Bearer |
| `GET` | `/api/help/status` | Aktif kayıtlı üye sayısı ve çağrı bekleme (cooldown) durumu | Bearer (`X-Actor-Id` isteğe bağlı) |
| `POST` | `/api/help/call` | Acil takviye çağrısı (5 dk cooldown, Roblox profil butonu, toplu DM) | Bearer + `X-Actor-Id` |
| `POST` | `/api/register` | Web sitesi kayıt başvurusu (Piyade veya Başka Klan seçimi, klan eşleştirme, thread ve onay kartı) | Bearer |
| `POST` | `/api/feedback` | Web sitesi geri bildirimi (Doğrulama, hız sınırı, DB kayıt ve Discord kanalı) | Bearer + `X-Actor-Id` |
| `GET` | `/api/admin/members?query=` | Sunucu üyeleri arama (kullanıcı adı, nick, ID, Roblox nick, kayıt türü ve klan) | Bearer + `X-Actor-Id` (Yönetim) |
| `GET` | `/api/admin/members/:id` | Üye tam profili: Discord + Kayıt + Klan + Tryout + VS + Sicil / Uyarı geçmişi | Bearer + `X-Actor-Id` (Yönetim) |
| `POST` | `/api/admin/warn` | Uyarı verme (`verbal` / `official`, M/D/Y kuralları, roller, timeout, ban) | Bearer + `X-Actor-Id` (Yönetim) |
| `POST` | `/api/admin/warn/:id/evidence` | Önceden verilen uyarıya kanıt görseli bağlantısı ekleme | Bearer + `X-Actor-Id` (Yönetim) |

#### 📝 `POST /api/register` Detayları
- **İstek Gövdesi (JSON):**
  ```json
  {
    "userId": "123456789012345678",
    "realName": "Ahmet Yılmaz",
    "robloxInput": "RobloxNick",
    "gender": "male" | "female",
    "registrationType": "own" | "other",
    "clanName": "Dark Wolves"
  }
  ```
- `registrationType: "other"` gönderildiğinde `clanName` (2-32 karakter) zorunludur. Küfür filtresi ve mention kontrolünden geçer, benzer klan rolleri taranır ve yetkiliye eşleştirme skoruyla iletilir.

#### 💬 `POST /api/feedback` Detayları
- **Başlıklar:** `Authorization: Bearer <API_SECRET>` ve `X-Actor-Id: <Discord_User_ID>` (Gönderen kimliği yalnızca `X-Actor-Id` başlığından alınır; gönderen sunucu üyesi olmalıdır, Kayıtsız üyeler dahildir).
- **İstek Gövdesi (JSON):** `{ "message": "string (3-1000 karakter)", "page": "/sayfa", "lang": "tr" | "en" }`
- **Hız Sınırları & Korumalar:** Kullanıcı başına 10 dakikada en fazla 3, 24 saatte en fazla 10 geri bildirim (`429 RATE_LIMITED`); son 10 dakikada aynı içerik tekrarı (`409 DUPLICATE`); Discord kanalında tüm etiket/mention bildirimleri (`allowedMentions: { parse: [] }` ve `@everyone`/`@here` koruması) devre dışıdır.
- **Yanıtlar:**
  - `200`: `{ "success": true, "id": "A1B2C3", "delivered": true }` veya kanal erişilemezse `{ "success": true, "id": "A1B2C3", "delivered": false, "reason": "CHANNEL_UNAVAILABLE" }`
  - `400`: `{ "code": "TOO_SHORT" }` veya `{ "code": "TOO_LONG" }`
  - `403`: `{ "code": "NOT_IN_GUILD" }`
  - `409`: `{ "code": "DUPLICATE" }`
  - `429`: `{ "code": "RATE_LIMITED", "retryAfterSec": 120 }`

---

## ⚙️ Ortam Değişkenleri (Environment Variables)

Railway veya `.env` dosyasında tanımlanması gereken değişkenler:

| Değişken | Zorunlu mu? | Varsayılan | Açıklama |
|---|---|---|---|
| `TSB_TOKEN` / `DISCORD_TOKEN` | **Evet** | - | Discord Bot Tokeni |
| `GUILD_ID` | Hayır | `1559313292651008040` | Piyade Team Sunucu ID'si |
| `API_SECRET` | **Evet (API için)** | - | REST API Bearer kimlik doğrulama gizli anahtarı |
| `PORT` | Hayır | `3000` | Express REST API dinleme portu (Railway otomatik atar) |
| `DATA_DIR` | Hayır | `./data` | Kalıcı veritabanı klasörü (Railway Volume desteği) |
| `FEEDBACK_CHANNEL_ID` | Hayır (Kanal için önerilir) | - | Web sitesi geri bildirim embedlerinin gönderileceği Discord kanal ID'si |
| `GEMINI_API_KEY` | Hayır | - | Google Gemini Yapay Zeka API Anahtarı (Küfür filtresi) |
| `GEMINI_MODEL` | Hayır | `gemini-3.8-flash` | Gemini model sürümü |

---

## 🛡️ Discord Rol Hiyerarşisi ve Yetki Gereksinimleri

Klan kayıt ve klan rolü oluşturma sisteminin sorunsuz çalışabilmesi için Discord Sunucu Ayarları'nda dikkat edilmesi gerekenler:
1. **Bot Rolünün Hiyerarşik Konumu:** Botun sahip olduğu en yüksek rol, Sunucu Rol Ayarlarında `<@&1570460155437518960>` (**Other Clan**) rolünün ve üyelerin alacağı rollerin **üstünde** yer almalıdır. Aksi halde Discord API'si rol atama ve yeni klan rolünü doğru sıraya yerleştirme işlemine izin vermez (`Missing Permissions`).
2. **Gerekli Bot Yetkileri:**
   - **Rolleri Yönet (`Manage Roles`):** Yeni klan rolleri oluşturmak ve üyelere atamak için zorunludur.
   - **Kanalları Yönet (`Manage Channels`):** Kayıt thread'lerini (alt başlıklarını) açmak ve temizlemek için gereklidir.
   - **Mesajları Gönder & Gömülü Bağlantılar (`Send Messages` & `Embed Links`):** Dost & Düşman klan paneli (`1570462108691210432`) ve başvuru odalarında mesaj/embed göndermek için gereklidir.

---

## 🧪 Test ve Kod Denetimi (Tanımsız Değişken Taraması)

Her kod değişikliğinden sonra canlıda tanımsız import veya değişken hatası oluşmasını engellemek için şu komutları çalıştırabilirsiniz:
- `npm run check:undef` : Projedeki tüm dosyalarda eksik import ve tanımsız değişkenleri (no-undef) denetler.
- `npm test` : API smoke testleri, klan eşleştirme motoru ve kayıt akışı testlerini çalıştırır.

---

## 🚀 GitHub ve Railway Güncellemesi

Değişiklikleri GitHub'a pushlayarak Railway üzerinde otomatik güncelleyebilirsiniz:

```bash
git add .
git commit -m "feat: VS sistemi, Top 10 tablosu, takma ad ve thread silme eklendi"
git push origin main
```