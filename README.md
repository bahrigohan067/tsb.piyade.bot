# Piyade | Çok Oyunlu Topluluk Discord Botu 🛡️🎮

Bu bot, **Piyade** oyuncu topluluğu için geliştirilmiş; **Roblox**, **CS2**, **Zula** ve **Minecraft** oyunlarını destekleyen, çift dilli (**Türkçe & İngilizce**) ve güvenli REST API bağlantılı Discord yönetim botudur.

---

## 🚀 Başlıca Özellikler

### 1. 🎮 Oyun Bazlı Çoklu Kayıt Sistemi (TR / EN)
* **Kayıt Paneli (`/kayit-paneli` ve açılışta otomatik güncelleme):**
  - İki dilli (`TR` + `EN`) tek panel üzerinden **`✅ Kayıt Ol (Türkçe)`** (`btn_kayit_ol`) ve **`🇬🇧 Register (English)`** (`btn_kayit_ol_en`) butonlarıyla çalışır.
  - Bot yeniden başlatıldığında mevcut paneli buton `customId`'siyle tanıyıp günceller; ikinci bir panel açmaz.
* **Adım Adım Kayıt Akışı (Durumsuz `customId` Bitmask Tasarımı & Akış İçi Dil Değiştirme):**
  1. **Oyun Seçimi:** Üye oynadığı oyunları (`🧱 Roblox`, `🔫 CS2`, `🪖 Zula`, `⛏️ Minecraft`) butonlarla seçer (birden fazla seçebilir, her oyuna en fazla bir kez basılır; `🔄 Sıfırla` ile sıfırlanabilir, `✅ Devam` ile ilerlenir).
  2. **Cinsiyet Seçimi:** Açılır menüden `👦 Erkek` / `👧 Kız` seçilir.
  3. **Anket Modalı:** Ad / Takma ad ve yalnızca seçilen oyunların kullanıcı adları istenir. Hata durumunda `🔁 Tekrar dene` butonu girilen değerleri **10 dakika** boyunca hatırlayarak formu yeniden doldurur.
  4. **Akış İçi Dil Değiştirme:** Her adımda ve hata ekranında `🇹🇷 Türkçe` / `🇬🇧 English` (`reg_lang:...`) butonu yer alır. Bu buton veya `btn_kayit_ol_en` veritabanına kalıcı yazmaz; yalnızca o anki kayıt oturumunun dilini değiştirir.
  4. **Güvenlik ve Roblox Doğrulaması:**
     - Tüm alanlarda küfür filtresi, mention/URL/davet engeli ve anlamsız metin kontrolü uygulanır. Kullanıcı başına **10 dakikada en fazla 5** form denemesine izin verilir.
     - Roblox seçildiyse hesap API ile doğrulanır (`NOT_FOUND` veya `BANNED` ise başvuru reddedilir, yetkili kanalına gürültü yapılmaz; geçici API hatasında nazikçe tekrar denenmesi istenir).
     - Yetkili kartına Roblox profil detayları (yaş, `<30 gün` yeni hesap bayrağı, arkadaş/takipçi/takip edilen, rozet, avatar thumbnail ve profil butonu) ile atanacak rollerin durumu (`⚠️` eksik rol uyarısı dahil) eklenir.
  5. **Onay & Red:**
     - Yetkili **`✅ ONAYLA`** butonuna bastığında **Hesabı Onaylı**, **Cengaver**, cinsiyet rolü ve seçilen **oyun rolleri** verilir; Kayıtsız rolü alınır.
     - Takma ad Roblox seçildiyse `<Ad> | <Roblox>`, seçilmediyse `<Ad>` biçiminde 32 karaktere uyumlu güncellenir.
     - Kullanıcıya onaylandığını, rollerini ve `/profilim` ipucunu içeren TR/EN DM gönderilir, özel başvuru odası temizlenir.
* **Kayıt Yönetim Komutları:**
  - `/profilim` (İngilizce istemcide `/profile`): Kayıtlı üyelerin oyunlarını ve kopyalanabilir kullanıcı adlarını herkese açık kartta göstermesini sağlar (30 sn bekleme süresi, `allowedMentions` korumalı, gizli kişisel bilgi içermez).
  - `/kayit-bilgi`: Yetkililer için üyenin tüm kayıt ve oyun bilgilerini sorgular.
  - `/kayit-sifirla`: Belirtilen üyenin kaydını ve tüm rollerini sıfırlar, Kayıtsız rolü verir.

---

### 2. ⚙️ Yeni Oyun Ekleme / Düzenleme (`games.config.js`)
Oyun listesi proje kökündeki [`games.config.js`](games.config.js) dosyasından merkezi olarak yönetilir (kayıt, `/profilim` ve API aynı dosyayı okur):
* Sıralama ve bitmask sırası `GAMES` dizisindeki sırayla belirlenir (`1, 2, 4, 8`).
* Her oyun için `id`, `emoji`, `name {tr, en}`, `buttonLabel {tr, en}`, `usernameLabel {tr, en}`, `usernamePlaceholder {tr, en}`, `validate {min, max, regex?}`, `roleId`, `verifier` (`'roblox'` | `null`) ve `enabled` alanları bulunur.
* Rol ID'leri ortam değişkenleriyle (`GAME_ROLE_ROBLOX`, `GAME_ROLE_CS2`, `GAME_ROLE_ZULA`, `GAME_ROLE_MINECRAFT`) ezilebilir.
* **Not:** Discord modal penceresi en fazla **5 alan** desteklediğinden (1 Ad + 4 Oyun), aynı anda en çok **4 aktif oyun** desteklenir; 4'ten fazla aktif oyun tanımlanırsa bot açılışında konsola uyarı yazılır.

---

### 3. ⚖️ Disiplin & Uyarı Sistemi (M1–M13, D1–D3, Y1–Y5)
* **Yetkili Paneli (`/uyari-panel`):** Developer ve yönetim yetkililerine özel sözlü/resmi uyarı paneli, kanıt yükleme ve log kanalında **`🇬🇧 English`** çeviri butonu.
* **Kademeler & Karantina:** Katılımcı kuralları (`M1`–`M13`), Ses kuralları (`D1`–`D3`), Yetkili kuralları (`Y1`–`Y5`), 15+ puanda 1 hafta `@Askıda` karantinası ve 30 günlük otomatik af döngüsü.
* **Uyarı İptali (`/uyari-iptal`):** Verilen uyarıyı ID ile iptal edip puan ve rolleri geri alır.

---

### 4. 🌐 İki Dilli (TR / EN) Dil Yönetimi & Otomatik İyileştirme
Bot yanıtları `resolveLang(context, sessionLang)` üzerinden tamamen yan etkisiz olarak çözülür (veritabanına yazmaz, `🇬🇧 English` rolünü kaynak almaz):
1. Oturum / `customId` / başvuru dili (`sessionLang`)
2. Kullanıcının **`/dil`** komutuyla bilerek seçtiği kalıcı tercih (`source: "manual"`)
3. Discord istemci dili (`interaction.locale`: `tr*` → `tr`, diğer diller → `en`)
4. Önceki etkileşimlerden hatırlanan istemci dili ipucu (`localeHints`)
5. Eski sürüm veritabanı kaydı (`source: "legacy"`)
6. Varsayılan `'tr'`

* **`/dil` (`/language`):** Üyenin tercihini (`tr`, `en`, `auto`) kaydeder ve en iyi çabayla `🇬🇧 English` rolünü senkronize eder (10 sn bekleme süresi).
* **`/dil-sifirla`:** Yetkililerin hedef kullanıcının kayıtlı dil tercihini ve `🇬🇧 English` rolünü sıfırlayıp denetim kanalına log düşmesini sağlar.
* **Sessiz Legacy İyileştirme:** Eski sürümlerden kalma `source: "legacy"` kayıtlı bir üye Türkçe Discord istemcisiyle (`locale: "tr*"`) etkileşime geçtiğinde kaydı sessizce `'tr'` yapılır ve varsa `🇬🇧 English` rolü kaldırılır (`source: "manual"` tercihlere dokunulmaz).

---

### 5. 🕹️ Oyun Etkinliği Sistemi (Rol, Ses Aktarımı & `/aktivitem`)
Bot, yalnızca Discord'un yerleşik etkinlik (*Playing / Şunu oynuyor*) verisini okuyarak çalışır (herhangi bir Roblox API'si veya hesap girişi kullanılmaz; oyun geçmişi/zaman çizelgesi **ASLA** saklanmaz).

* **Kurulum (Discord Developer Portal & Bot İzinleri):**
  - **Privileged Gateway Intents:** Developer Portal > Bot sekmesinden **Presence Intent**, **Server Members Intent** ve **Message Content Intent** açık olmalıdır. *(Presence Intent kapalıysa bot çökmez; tek satır uyarı vererek oyun etkinliği sistemini devre dışı bırakıp diğer özelliklerle çalışmaya devam eder.)*
  - **Bot İzinleri ve Rol Hiyerarşisi:**
    - **Rolleri Yönet (`Manage Roles`):** Botun en üst rolü, 4 oyun aktiflik rolünün (Roblox, Zula, Minecraft, CS2) **ÜSTÜNDE** olmalıdır.
    - **Üyeleri Taşı (`Move Members`)** ve hedef oyun ses kanallarında **Kanalı Görüntüle (`View Channel`) + Bağlan (`Connect`)**.
    - Komut kanalında (`1559316204030533722`) **Mesaj Gönder**, **Üyeleri Etiketle** ve **Embed Bağlantıları**.
* **`activity.config.js` Nasıl Düzenlenir?**
  - Proje kökündeki [`activity.config.js`](activity.config.js) kayıt sisteminin `games.config.js` dosyasından **ayrıdır**.
  - Yeni oyun eklemek için `GAMES` dizisine `{ id, family, name, emoji, placeId, voiceChannelIds, matchers }` biçiminde tek bir kayıt eklemek yeterlidir. Bot açılışta eksik rol/kanal ve bozuk kayıtları otomatik denetler.
* **Sistem Nasıl Çalışır?**
  - **Aktiflik Rolleri:** Etkinlik kesintisiz **15 saniye** sürünce üyenin oyun ailesine göre (Roblox / Zula / Minecraft / CS2) aktiflik rolü verilir. Oyun bırakılıp **60 saniye** geçince rol geri alınır (kısa kopmalarda rol yanıp sönmez; Roblox içi oyun değişiminde rol gereksiz alınıp verilmez).
  - **Otomatik Ses Aktarımı (`evaluateTransfer`):** Onaylı oturumda üye bir ses kanalındaysa (AFK, Sahne ve `NO_MOVE_CHANNEL_IDS` hariç), her oyun oturumunda en fazla **1 kez** komut kanalına üyenin dilinde (TR/EN) **10 saniyelik canlı geri sayım** (`<t:unix:R>`) ve **`❌ Aktarmayı İptal Et`** butonu gönderilir. İptal edilmezse üye oyunun ses kanalına aktarılır (Minecraft gibi çoklu kanallarda önce aynı oyundaki oyuncuların olduğu boş kanal seçilir; Roblox oyunu tanınmıyorsa veya `"Roblox Player"` görünüyorsa `OTHER GAMES` kanalına aktarılır) ve geri sayım mesajı silinir. Oyun ses dışındayken başladıysa, üye sonradan herhangi bir ses kanalına girdiğinde veya kanal değiştirdiğinde **3 saniye (`VOICE_DEBOUNCE_SEC`)** sonra canlı presence okunarak aktarma başlatılır. Ayrıca her **30 saniyede bir (`SWEEP_SEC`)** yalnızca sesteki üyeler için yedek tarama çalışır.
  - **Aylık Süre & Sıfırlama:** Oynama süreleri dakika/saniye olarak yalnızca **o ayın toplamı** şeklinde biriktirilir (`CHECKPOINT_SEC = 60` sn toplu atomik kayıt + oyun bırakıldığında anlık kayıt + `SIGTERM`/`SIGINT` kapanış kaydı). **Europe/Istanbul** saatine göre her ayın 1'inde önceki aya ait tüm süreler tamamen temizlenir ve komut kanalına iki dilli duyuru atılır.
  - **`/aktivitem` (`/activity`) ve Kullanıcı Kapatma:** Herkese açık aylık aktivite kartını gösterir (30 sn cooldown). Kartın altındaki **`⚙️ Ayarlarım`** butonu basan üyenin kendi özel (ephemeral) ayar panelini açar: üye isterse **Otomatik Ses Aktarma**'yı veya **Etkinlik Takibi**'ni tamamen kapatabilir. Takip kapatıldığında üyenin aktiflik rolleri hemen alınır, bekleyen aktarma iptal edilir, karar izi ve o ayki süreleri anında silinir.
* **🔧 Sorun Giderme (Aktarma veya Süre Neden Çalışmadı?):**
  - **`🧪 Neden aktarılmadım? / Why wasn't I moved?` düğmesi (`/aktivitem` > `⚙️ Ayarlarım`):** Her üye kendi son aktarma değerlendirmesini (son 30 dakika için bellekte tutulur, diske yazılmaz) buradan görebilir. Tetikleyiciyi (`Oyun başladı`, `Ses kanalına girdi`, `Ses kanalı değiştirdi`, `Yedek tarama`), sebep kodunu (`NOT_IN_VOICE`, `WAITING_CONFIRM`, `TOKEN_SPENT`, `NO_PRESENCE_DATA`, `COMMAND_CHANNEL_UNAVAILABLE`, `NO_MOVE_PERMISSION`, `TARGET_FULL` vb.) ve sade çözüm önerisini gösterir.
  - **`🔍 Botun Gördüğü Etkinlik` düğmesi (`/aktivitem` > `⚙️ Ayarlarım`):** Botun o an üye için Discord'dan aldığı ham `Playing` alanlarını (`name`, `applicationId`, `details`, `state`, `assets.largeText`) ve eşleşme sonucunu gösterir.
  - **`🛠️ Sistem Durumu / System Status` düğmesi (Yalnızca Developer ve Yönetmenlik):** Yetkililere özeldir. Botun **Presence Intent** alıp almadığını (`✅ Bot presence alıyor` / `❌ Bot presence OLMADAN çalışıyor`), **Rolleri Yönet / Üyeleri Taşı** izinlerini, bot rolünün 4 aktiflik rolünün üstünde olup olmadığını, komut kanalı ve oyun ses kanallarının erişilebilirliğini, aktif oturum sayısını ve açılıştan beri biriken **kimliksiz zincir sayaçlarını** (`presence -> playing -> eşleşen/roblox -> onaylı oturum -> rol -> süre checkpoint -> DB kayıt -> MOVED`) kırık halka uyarılarıyla (`⚠️`) birlikte listeler.
  - **Sık Karşılaşılan Nedenler:**
    1. **Discord Etkinlik Gizliliği:** Kullanıcının kendi Discord ayarlarında **Ayarlar > Etkinlik Gizliliği (Activity Privacy)** kapalıysa Discord bota hiçbir oyun verisi göndermez (`NO_PRESENCE_DATA` / `NOT_PLAYING`).
    2. **Presence Intent:** Developer Portal > Bot sekmesinde **PRESENCE INTENT** kapalıysa bot yedek modda (`GuildPresences` olmadan) açılır ve özellik devre dışı kalır (`🛠️ Sistem Durumu` içinde açıkça görünür).
    3. **Bot İzinleri ve Rol Sırası:** Botun en üst rolü 4 aktiflik rolünün altında kalırsa rol veremez (`50013`); **Üyeleri Taşı (`Move Members`)** veya hedef ses kanalında **Görüntüle + Bağlan** izni yoksa ses aktarımı yapamaz (`NO_MOVE_PERMISSION`).
    4. **Komut Kanalı İzni:** Bot komut kanalına (`1559316204030533722`) mesaj gönderemiyorsa kullanıcıya iptal şansı veremediği için güvenlik gereği ses aktarımı yapmaz (`COMMAND_CHANNEL_UNAVAILABLE`).
    5. **Canlı Presence Yedek Okuma:** `member.presence` önbellekte boş geldiğinde bot önce `guild.members.fetch({ user: [id], withPresences: true })` ile canlı veriyi çekmeyi dener, ardından kendi oturum belleğine bakar.
* **⚠️ Sınırlamalar:**
  - Discord, Roblox oyunlarının adını yalnızca oyun geliştiricisi Discord entegrasyonu yaptıysa gösterir; aksi halde yalnızca **"Roblox"** veya **"Roblox Player"** görünür ve oyuncu **`OTHER GAMES`** ses kanalına aktarılır.
  - Telefonda (mobil) oynanan oyunlar Discord tarafından etkinlik olarak paylaşılmadığı için algılanmaz.
  - Zula, Minecraft (TLauncher dahil) ve CS2'nin tanınması Discord masaüstü uygulamasının oyunu algılamasına bağlıdır; **`/aktivitem` > ⚙️ Ayarlarım > 🔍 Botun Gördüğü Etkinlik** ile anlık teşhis yapılabilir.
  - Kullanıcı bir ses kanalında değilse ses aktarımı yapılamaz.
  - Hiçbir oyun geçmişi, saatlik kayıt veya kalıcı karar izi saklanmaz.

---

### 6. 🎨 İsim Rengi Paneli & Moderasyon
* `/renk_paneli_kur`: 6 renk seçimi, tek renk kuralı, 10 sn cooldown ve İngilizce rehber.
* Küfür filtresi (yerel + Gemini yapay zeka), sadece medya kanalı koruması, `!lock` / `!unlock`, `/temizle` / `!temizle`, `/veri-sifirla`, `/rols`.

---

## 🛠️ Slash Komutları Özeti

| Komut | Yetki | Açıklama |
|---|---|---|
| `/profilim` (`/profile`) | Herkes (Kayıtlı) | Oynadığı oyunları ve kullanıcı adlarını herkese açık gösterir (30 sn cooldown). |
| `/aktivitem` (`/activity`) | Herkes | Bu ay oynadığı oyunları ve sürelerini herkese açık gösterir; `⚙️ Ayarlarım` ve teşhis sunar (30 sn cooldown). |
| `/dil` (`/language`) | Herkes | Kalıcı bot dilini (`Türkçe`, `English`, `Otomatik`) seçer (10 sn cooldown). |
| `/dil-sifirla` | Developer & Yönetim | Hedef kullanıcının kayıtlı dil tercihini ve English rolünü sıfırlar. |
| `/kayit-paneli` | Yönetici | TR/EN kayıt panelini günceller (yoksa yeni oluşturur). |
| `/kayit-bilgi` | Kayıt Yetkilisi & Yönetim | Üyenin kayıt, oyun ve Roblox detaylarını sorgular. |
| `/kayit-sifirla` | Kayıt Yetkilisi & Yönetim | Belirtilen üyenin kaydını ve rollerini sıfırlar, Kayıtsız rolü verir. |
| `/veri-sifirla` | Developer & Sunucu Sahibi | Güvenli yedek alarak Uyarılar, Kayıtlar veya Hepsi için verileri sıfırlar. |
| `/uyari-panel` | Developer & Yönetim | Disiplin & Uyarı Verme Panelini kurar. |
| `/uyari-iptal` | Developer & Yönetim | Verilen bir uyarıyı ID'si ile iptal eder. |
| `/renk_paneli_kur` | Yönetici | İsim rengi seçim panelini kurar. |
| `/temizle` / `!temizle` | Mesajları Yönet | Belirtilen miktarda mesajı kanaldan siler (1 - 300). |
| `/rols` | Kurucu & Developer | Sunucudaki rolleri ve ID'lerini hiyerarşi sırasıyla listeler. |

---

## 🌐 Dahili Güvenli REST API Dokümantasyonu

Bot aynı Node.js sürecinde Express ile REST API sunar. `/api/health` dışındaki tüm uç noktalar `Authorization: Bearer <API_SECRET>` gerektirir.

### 📌 Önemli Endpoint ve Alanlar
* **`GET /api/games`**: Web kayıt formu için etkin oyunları (`id`, `emoji`, `name`, `buttonLabel`, `usernameLabel`, `usernamePlaceholder`, `validate`, `verifier`) döndürür (`roleId` döndürülmez).
* **`GET /api/roblox/lookup?query=...`**: Aktör doğrulamalı (`X-Actor-Id`, aktör başına dakikada max 10 istek) canlı Roblox profil ön izleme ve çakışma kontrolü sunar (`status`: `FOUND` | `NOT_FOUND` | `BANNED` | `TEMPORARY_ERROR`, `alreadyRegistered` boolean; başka üyenin Discord ID'si asla sızdırılmaz).
* **`POST /api/register`**:
  - **Yeni Gövde:** `{ discordId?, name, gender: "male" | "female", games: [{ id, username }], lang: "tr" | "en" }` (Not: `lang` yalnızca bu başvuru için kullanılır, kalıcı dil tercihini değiştirmez).
  - **Geriye Dönük Uyum:** Eski `{ realName, robloxInput, gender }` gövdesi de desteklenir.
  - **Hata Kodları (`{ error, code, details? }`):** `NO_GAME_SELECTED`, `NAME_INVALID`, `GAME_USERNAME_INVALID` (`details.game`), `ROBLOX_NOT_FOUND`, `ROBLOX_BANNED`, `ROBLOX_LOOKUP_FAILED` (503 geçici hata), `ROBLOX_ALREADY_REGISTERED`, `ALREADY_REGISTERED`, `RATE_LIMITED`.
* **`GET /api/register/status/:id`**, **`GET /api/member/:id/profile`**, **`GET /api/admin/members`**, **`GET /api/admin/members/:id`**:
  - Yanıtlardaki `registration` (ve `pending` durumunda `application`) nesnesi artık `displayName` ve `games: [{ id, username, verified, robloxId?, robloxProfileUrl? }]` alanlarını da içerir (eski kayıtlar okuma sırasında otomatik uyarlanır).
* Diğer uç noktalar: `GET /api/member/:id/roles`, `POST /api/feedback`, `POST /api/admin/warn`, `POST /api/admin/warn/:id/evidence`.

---

## ⚙️ Ortam Değişkenleri (Environment Variables)

| Değişken | Zorunlu mu? | Varsayılan | Açıklama |
|---|---|---|---|
| `DISCORD_TOKEN` / `TSB_TOKEN` | **Evet** | - | Discord Bot Tokeni |
| `GUILD_ID` | Hayır | `1559313292651008040` | Sunucu ID'si |
| `BRAND_NAME` | Hayır | `Piyade` | Topluluk marka adı |
| `API_SECRET` | **Evet (API için)** | - | REST API Bearer gizli anahtarı |
| `PORT` | Hayır | `3000` | Express REST API portu |
| `DATA_DIR` | Hayır | `./data` | Kalıcı veritabanı klasörü |
| `FEEDBACK_CHANNEL_ID` | Hayır | `1570061735665078392` | Web sitesi geri bildirim kanalı |
| `PROFILE_COOLDOWN_SEC` | Hayır | `30` | `/profilim` bekleme süresi (sn) |
| `PROFILE_SHOW_NAME` | Hayır | `true` | `/profilim` içinde Ad satırını gösterir (`false` ise gizler) |
| `GAME_ROLE_ROBLOX` / `CS2` / `ZULA` / `MINECRAFT` | Hayır | `games.config.js` | Oyun rolü ID geçersiz kılmaları |
| `GEMINI_API_KEY` | Hayır | - | Google Gemini Yapay Zeka API Anahtarı |

---

## 🧪 Test ve Kod Denetimi

Her değişiklikten sonra mutlaka çalıştırılmalıdır:
- `npm run check:undef` : ESLint `no-undef` kuralı ile `index.js`, `config.js`, `games.config.js`, `activity.config.js`, `src` ve `tests` altındaki tüm JS dosyalarında tanımsız değişkenleri denetler.
- `npm test` : Node.js yerel test koşucusu (`node:test`) ile tüm birim ve entegrasyon testlerini çalıştırır.
