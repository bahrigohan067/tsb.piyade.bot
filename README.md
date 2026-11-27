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
Bot, yalnızca Discord'un yerleşik etkinlik (*Playing / Şunu oynuyor*) verisini okuyarak çalışır (herhangi bir Roblox API'si veya hesap girişi kullanılmaz; kişisel geçmiş/zaman çizelgesi saklanmaz, yalnızca sunucu geneli oyun toplamları tutulur).

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
  - **Aktiflik Rolleri (`ROLE_REQUIRES_VOICE`, `ROLE_REMOVE_ON_VOICE_LEAVE`):**
    - Etkinlik kesintisiz **15 saniye (`CONFIRM_SEC`)** sürdüğünde oyun oturumu onaylanır. Varsayılan olarak **`ROLE_REQUIRES_VOICE = true`** olduğundan, otomatik **Oyun Aktiflik Rolü** (Roblox / Zula / Minecraft / CS2) yalnızca üye **bir ses kanalındayken** oyun oynuyorsa verilir. Üye ses dışında oyun açtıysa rol hemen verilmez (`ROLE_WAITING_FOR_VOICE`); sonradan herhangi bir ses kanalına girdiğinde (3 sn debounce veya 30 sn sweep ile) rolü otomatik verilir. (`ROLE_REQUIRES_VOICE = false` yapılırsa eski sesten bağımsız davranışa dönülebilir.)
    - Oyun bırakılıp **`STOP_GRACE_SEC = 5` saniye** kesintisiz geçince rol yüksek öncelikle HEMEN geri alınır (süre her zaman etkinliğin **son görüldüğü** ana kadar sayılır; Roblox içi oyun değişiminde rol gereksiz alınıp verilmez). **`ROLE_REMOVE_ON_VOICE_LEAVE`** varsayılan olarak **`false`** gelir (üye sesten çıksa da oyun sürüyorsa rolü kalır); `true` yapılırsa sesten tamamen çıkıldığında otomatik aktiflik rolü de alınır (manuel `/oyun` rolleri hariç).
  - **Otomatik Ses Aktarımı (`evaluateTransfer`) ve Geri Sayım Kuralı:** Üye herhangi bir ses kanalına girdiğinde veya kanal değiştirdiğinde **3 saniye (`VOICE_DEBOUNCE_SEC`)** sonra canlı Discord etkinliği okunur. O anda onaylı bir oyunu varsa (AFK, Sahne ve `NO_MOVE_CHANNEL_IDS` hariç) komut kanalına üyenin dilinde (TR/EN) **10 saniyelik canlı geri sayım** (`<t:unix:R>`) ve **`❌ Aktarmayı İptal Et`** butonu gönderilir; oyunda değilse hiçbir geri sayım veya aktarma yapılmaz (`NOT_PLAYING`). İptal edilmezse üye oyunun ses kanalına aktarılır (Minecraft gibi çoklu kanallarda önce aynı oyundaki oyuncuların olduğu boş kanal seçilir; Roblox oyunu tanınmıyorsa veya `"Roblox Player"` görünüyorsa `OTHER GAMES` kanalına aktarılır) ve geri sayım mesajı silinir. Ayrıca her **30 saniyede bir (`SWEEP_SEC`)** yedek tarama çalışır.
  - **Sesten Düşünce Yeniden Aktarma (`REARM_*`):**
    - Üye oyun ses kanalına aktarıldıktan sonra (`moved` veya zaten hedefte `inTarget`) ses kanalından **tamamen düşerse** (bağlantı kopması, yanlışlıkla atılma vb. — `kanal -> yok`) ve aynı oyun oturumu hâlâ sürüyorsa, **`REARM_AFTER_DISCONNECT = true`** iken üyenin aktarma hakkı yeniden hazırlanır (`REARMED_AFTER_DISCONNECT`). Üye tekrar bir ses kanalına girdiğinde 3 sn sonra yeniden geri sayım başlatılıp oyunun kanalına aktarılır.
    - **İptal kalıcıdır:** Kullanıcı geri sayım mesajında **`❌ Aktarmayı İptal Et`** butonuna bastıysa (`cancelled`) o oyun oturumu boyunca sesten düşüp girse de tekrar aktarma yapılmaz.
    - **Elle kanal değiştirme:** Sesten düşmeden kanaldan kanala elle geçiş yeniden silahlandırmaz (`TOKEN_SPENT`).
    - **Sınırlar ve spam koruması:** Aynı oyun oturumunda en fazla **`REARM_MAX_PER_SESSION = 3`** kez yeniden aktarma hakkı verilir (aşılırsa `REARM_LIMIT_REACHED`); aynı üye için iki yeniden aktarma geri sayımı arasında en az **`REARM_MIN_GAP_SEC = 30`** saniye beklenir (`REARM_RATE_LIMITED`, süre dolunca üye hâlâ sesteyse otomatik tekrar değerlendirilir). Yeni oyun oturumunda sayaçlar sıfırlanır.
    - *Not (Yetkili atması):* Discord ses olayları bir kullanıcının sesten kendisinin mi çıktığını, bağlantısının mı koptuğunu yoksa bir yetkili tarafından mı atıldığını ayırt etmez; bot bu nedenle herhangi bir tam düşüşten sonra tekrar sese girişi aynı yeniden aktarma kuralıyla değerlendirir.
  - **Oyun Bitişi ve Salon 1'e Sessiz Dönüş (`RETURN_CHANNEL_ID`):** Üye oyunu kapattığında (`STOP_GRACE_SEC = 5` sn sonra) oturumu sonlandırılır, aile rolü hemen alınır ve üye şu an **yönetilen bir oyun ses kanalındaysa** (`GAMES` kanalları + `OTHER GAMES` kanalı) geri sayım/mesaj/DM olmadan sessizce **Salon 1** ses kanalına (`RETURN_CHANNEL_ID = 1559927197056241816`) aktarılır.
    - *Dönüş koşulları:* Üye çevrimiçi/boşta/rahatsız etmeyin durumunda ve aktif başka bir oyunu yoksa, `RETURN_ENABLED = true` ise, üyenin `Etkinlik Takibi`, `Otomatik Ses Aktarma` ve `Oyun Bitince Salon 1'e Dön` tercihleri açıksa, üye o an yönetilen bir oyun ses kanalındaysa ve Salon 1 kanalı müsaitse taşınır. Üye oyun dışı bir odadaysa (Genel, özel oda vb.) veya seste değilse taşınmaz; oyundan oyuna geçerken Salon 1'e dönülmez.
    - *`STOP_GRACE_SEC` ayarı:* Varsayılan `5` saniyedir (`activity.config.js` > `TIMINGS.STOP_GRACE_SEC`). Discord etkinlik verisinde kısa kopmalar nedeniyle yanlış alarm yaşanıyorsa bu sabit **`10`–`15`** saniyeye çıkarılabilir.
    - *Görünmez / Çevrimdışı (`offline`) durumun etkisi:* Üye Discord'da **Görünmez** moduna geçerse veya presence verisi okunamazsa bot oyunun gerçekten kapanıp kapanmadığından emin olamayacağı için oturumu sonlandırıp aktiflik rolünü alır **ancak Salon 1'e taşımaz** (`RETURN_SKIPPED_NO_PRESENCE`).
    - *Kaçan olaylara karşı güvenlik:* 30 sn'lik yedek tarama onaylı oturumlarda kaçan oyun kapanışlarını yakalar; 5 dakikada bir çalışan hafif rol temizliği ise yalnızca 4 aktiflik rolünün sahiplerini (`role.members`) kontrol ederek pasif rolleri alır (presence yoksa/offline ise role dokunmaz ve Salon 1'e taşıma yapmaz).
  - **Mobil Oyuncular İçin `/oyun` (`/game`) Komutu:** Discord, telefon/tablet üzerinden oynanan oyunları otomatik olarak algılayamadığı için mobil oyuncular `/oyun` (İngilizce istemcide `/game`) yazarak tek satırdaki 4 oyun butonundan (`🧱 Roblox`, `🪖 Zula`, `⛏️ Minecraft`, `🎯 CS2`) oynadıkları oyunun **Oyun Aktiflik Rolü**'nü anında alabilir (yanıt yalnızca kullanıcıya görünür / ephemeral).
    - *Tekrar basınca geri alma:* Aktif olan (yeşil `✅`) oyun butonuna tekrar basıldığında manuel işaret kaldırılır ve canlı bir PC oturumu yoksa rol hemen geri alınır (canlı otomatik oturum sürüyorsa rol oyunu kapatınca alınır).
    - *Neden ses aktarımı ve süre sayımı yapmaz?* `/oyun` yalnızca manuel rol vermek içindir; üyenin gerçekten oyunda olup olmadığı veya ne kadar oynadığı doğrulanamadığından ses kanalına **aktarma yapmaz**, geri sayım/Salon 1 dönüşü tetiklemez, tracker oturumu açmaz ve `activityStats` süresine eklemez.
    - *Otomatik sistemle ilişkisi:* `/oyun` ile alınmış manuel roller, otomatik sistemin oyun bitişi rol almasından, 5 dakikalık/açılış temizliğinden ve etkinlik takibini kapatma işleminden **hariç tutulur** (takibi kapalı üyeler de `/oyun` komutunu kullanabilir; oyun bitişinde Salon 1'e dönüş kuralı manuel işaretten bağımsız çalışır).
    - *Gece 00:00 temizliği ve `MANUAL_CLEAR_ALL_ACTIVITY_ROLES`:* Manuel işaretler `Europe/Istanbul` takvim gününe göre (`Intl.DateTimeFormat`) saklanır ve her gün **00:00'da** (Türkiye saati) sessizce (mesaj/etiket olmadan) temizlenerek roller geri alınır (o an o aileden canlı otomatik oturumu olanların rolüne dokunulmaz, sadece manuel işaret silinir). `activity.config.js` içindeki `MANUAL_CLEAR_ALL_ACTIVITY_ROLES` ayarı varsayılan olarak `false` (kapalı) gelir; `true` yapılırsa 00:00'da 4 aktiflik rolünün önbelleğindeki canlı oturumsuz tüm üyelerin rolleri de alınır.
  - **Aylık Süre & Sıfırlama:** Oynama süreleri dakika/saniye olarak yalnızca **o ayın toplamı** şeklinde biriktirilir (`CHECKPOINT_SEC = 60` sn toplu atomik kayıt + oyun bırakıldığında anlık kayıt + `SIGTERM`/`SIGINT` kapanış kaydı). **Europe/Istanbul** saatine göre her ayın 1'inde önceki aya ait tüm süreler tamamen temizlenir ve komut kanalına iki dilli duyuru atılır.
  - **`/aktivitem` (`/activity`) ve Kullanıcı Kapatma:** Herkese açık aylık aktivite kartını gösterir (30 sn cooldown). Kartın altındaki **`⚙️ Ayarlarım`** butonu basan üyenin kendi özel (ephemeral) ayar panelini açar: üye isterse **Etkinlik Takibi**, **Otomatik Ses Aktarma** veya **🔙 Oyun Bitince Salon 1'e Dön** özelliğini tek tuşla kapatıp açabilir (`Etkinlik Takibi` veya `Otomatik Ses Aktarma` kapalıyken Salon 1'e dönüş düğmesi de devre dışı olur). Takip kapatıldığında üyenin otomatik aktiflik rolleri hemen alınır (manuel `/oyun` rolleri hariç), bekleyen aktarma iptal edilir, karar izi ve o ayki süreleri anında silinir.
* **🔧 Sorun Giderme (Aktarma veya Süre Neden Çalışmadı?):**
  - **`🧪 Neden aktarılmadım? / Why wasn't I moved?` düğmesi (`/aktivitem` > `⚙️ Ayarlarım`):** Her üye kendi son aktarma veya Salon 1'e dönüş kararını (**Son Karar**, son 30 dakika için bellekte tutulur, diske yazılmaz) buradan görebilir. Tetikleyiciyi (`Oyun başladı`, `Oyun sona erdi`, `Ses kanalına girdi`, `Ses kanalı değiştirdi`, `Yedek tarama`), sebep kodunu (`NOT_IN_VOICE`, `WAITING_CONFIRM`, `TOKEN_SPENT`, `RETURN_MOVED`, `RETURN_SKIPPED_NOT_GAME_CHANNEL`, `RETURN_SKIPPED_NO_PRESENCE`, `RETURN_SKIPPED_OPTED_OUT` vb.) ve sade çözüm önerisini gösterir.
  - **`🔍 Botun Gördüğü Etkinlik` düğmesi (`/aktivitem` > `⚙️ Ayarlarım`):** Botun o an üye için Discord'dan aldığı ham `Playing` alanlarını (`name`, `applicationId`, `details`, `state`, `assets.largeText`) ve eşleşme sonucunu gösterir.
  - **`🛠️ Sistem Durumu / System Status` düğmesi (Sadece Developer):** Yalnızca **Developer** rolüne (`config.ROLES.DEVELOPER`) sahip üyelere görünür ve açılır (Yönetmenlik, Yönetici izni veya sunucu sahibi olmak yeterli değildir). Botun **Presence Intent** alıp almadığını, **Rolleri Yönet / Üyeleri Taşı** izinlerini, bot rolünün 4 aktiflik rolünün üstünde olup olmadığını, komut kanalı, oyun ses kanalları, **Salon 1 dönüş kanalı (`RETURN_CHANNEL_ID`)**, **mobil `/oyun` aktif manuel işaret sayısı, son/sonraki 00:00 temizliği, `MANUAL_CLEAR_ALL_ACTIVITY_ROLES` durumu** ve kimliksiz zincir sayaçlarını kırık halka uyarılarıyla (`⚠️`) birlikte listeler.
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
  - Kişisel geçmiş saklanmaz; yalnızca sunucu geneli oyun toplamları tutulur.

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
| `/oyun` (`/game`) | Herkes | Mobil oyuncular için 4 butonla anlık oyun aktiflik rolü verir/alır (ephemeral, ses aktarmaz, her gün 00:00 TR saatinde alınır). |
| `/dil` (`/language`) | Herkes | Kalıcı bot dilini (`Türkçe`, `English`, `Otomatik`) seçer (10 sn cooldown). |
| `/dil-sifirla` | Developer & Yönetim | Hedef kullanıcının kayıtlı dil tercihini ve English rolünü sıfırlar. |
| `/kayit-paneli` | Yönetici | TR/EN kayıt panelini günceller (yoksa yeni oluşturur). |
| `/kayit-bilgi` | Kayıt Yetkilisi & Yönetim | Üyenin kayıt, oyun ve Roblox detaylarını sorgular. |
| `/kayit-sifirla` | Developer & Community Official | Belirtilen üyenin kaydını ve rollerini sıfırlar, Kayıtsız rolü verir. |
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
* **Aktör Türleri (`X-Actor-Type` + `X-Actor-Id`, tüm uçlarda `Authorization: Bearer <API_SECRET>` zorunlu):**
  - `discord` *(varsayılan)*: Mevcut Discord üyesi aktör davranışı.
  - `site-guest`: `X-Actor-Id` değeri `"g_" + 32 hex` (site tarafından tek yönlü özetlenmiş misafir kimliği) olmalıdır. Yalnızca `GET /api/games` ve `GET /api/roblox/lookup` (aktör başına **10/dk**) uçlarına erişir; diğer her uçta `403 ACTOR_NOT_ALLOWED` döner.
  - `site-service`: `X-Actor-Id: site` olmalıdır (dakikada **120** istek). Yalnızca `GET /api/games`, `GET /api/roblox/lookup`, `POST /api/roblox/avatars`, `PUT/DELETE /api/roblox/site-claims/:robloxId`, `GET /api/directory` ve `POST /api/directory/lookup` uçlarına erişir; diğer her uçta `403 ACTOR_NOT_ALLOWED` döner.
* **`GET /api/games`**: Web kayıt formu için etkin oyunları (`id`, `emoji`, `name`, `buttonLabel`, `usernameLabel`, `usernamePlaceholder`, `validate`, `verifier`) döndürür (`roleId` döndürülmez). `discord`, `site-guest` ve `site-service` erişebilir.
* **`GET /api/roblox/lookup?query=...(&ignoreOwnerRef=m_xxx)`**: Aktör doğrulamalı (`discord`/`site-guest`: 10/dk, `site-service`: 120/dk) canlı Roblox profil ön izleme ve çakışma kontrolü sunar (`status`: `FOUND` | `NOT_FOUND` | `BANNED` | `TEMPORARY_ERROR`). `alreadyRegistered` hem Discord kayıtlarını hem `siteRobloxClaims` sahiplenmelerini kapsar; `ignoreOwnerRef` yalnızca `site-service` aktöründe geçerlidir (başka üyenin kimliği asla sızdırılmaz).
* **`POST /api/roblox/avatars`**: Yalnızca `site-service`. Gövde `{ ids: [en çok 100 robloxId] }` → `{ [id]: url | null }` (6 saat bellek önbellekli, yalnızca `https://*.rbxcdn.com` doğrulanmış küçük resim URL'leri).
* **`PUT /api/roblox/site-claims/:robloxId`** & **`DELETE /api/roblox/site-claims/:robloxId`**: Yalnızca `site-service`. Site Google üyeleri için "1 Roblox = 1 üye" sahiplenme kaydı (`siteRobloxClaims: { [robloxId]: { ownerRef, at } }`, atomik disk kaydı). `PUT` `{ ownerRef: "m_..." }` Discord kaydı veya başka `ownerRef` ile çakışırsa `409 ROBLOX_ALREADY_REGISTERED` döner (kimin olduğu sızmaz), aynı `ownerRef` için idempotent çalışır. `DELETE` `{ ownerRef }` eşleşirse siler, değilse `403 CLAIM_OWNER_MISMATCH` döner. Discord kayıt akışları (modal ve `POST /api/register`) da `siteRobloxClaims`'teki Roblox hesaplarını reddeder.
* **`POST /api/register`**:
  - **Yeni Gövde:** `{ discordId?, name, gender: "male" | "female", games: [{ id, username }], lang: "tr" | "en" }` (Not: `lang` yalnızca bu başvuru için kullanılır, kalıcı dil tercihini değiştirmez).
  - **Geriye Dönük Uyum:** Eski `{ realName, robloxInput, gender }` gövdesi de desteklenir.
  - **Hata Kodları (`{ error, code, details? }`):** `NO_GAME_SELECTED`, `NAME_INVALID`, `GAME_USERNAME_INVALID` (`details.game`), `ROBLOX_NOT_FOUND`, `ROBLOX_BANNED`, `ROBLOX_LOOKUP_FAILED` (503 geçici hata), `ROBLOX_ALREADY_REGISTERED`, `ALREADY_REGISTERED`, `RATE_LIMITED`.
* **`GET /api/register/status/:id`**, **`GET /api/member/:id/profile`**, **`GET /api/admin/members`**, **`GET /api/admin/members/:id`**:
  - Yanıtlardaki `registration` (ve `pending` durumunda `application`) nesnesi artık `displayName` ve `games: [{ id, username, verified, robloxId?, robloxProfileUrl? }]` alanlarını da içerir (eski kayıtlar okuma sırasında otomatik uyarlanır).
* **`GET /api/member/:id/activity?lang=tr|en`**: Üyenin bu ayki kişisel oyun etkinliği özetini (`/aktivitem` ile birebir aynı mantıkla; canlı oturum ve Roblox aile gruplaması dahil) döndürür.
* **`GET /api/stats/top-games?scope=month|all&limit=8&lang=tr|en&group=family`**: Sunucuda en çok oynanan oyun ailelerinin anonim sıralamasını (`families` + geriye dönük `games`, `computedAt`) döndürür (hiçbir kullanıcı ID'si içermez, 60 sn önbellekli).
* **`GET /api/stats/summary`**: Sunucudaki `activeThisMonth` ("Bu ay aktif"), `playingNow` ("Şu an oyunda"), `uncertainCount`, `computedAt`, `families` ile birlikte eski site uyumlu `activeRegisteredCount`, `totalMemberCount`, `onlineCount`, `playingCount`, `updatedAt` alanlarını anonim olarak döndürür (60 sn önbellekli).
* **`GET /api/directory?query=&limit=&cursor=&excludeSelf=1`**: Site üzerindeki "Sohbet" özelliği için kayıtlı, sunucuda bulunan ve bot olmayan üyelerin rehberini döndürür (`Authorization: Bearer` + `X-Actor-Id` zorunlu, aktör başına **60/dk** hız sınırı, 30 sn bellek önbelleği).
  - **Dönen 7 Alan (fazladan kişisel veri yok):** `id`, `displayName`, `discordAvatarUrl` (128 px PNG), `robloxId`, `robloxUsername`, `robloxAvatarUrl` (6 saat önbellekli, yalnızca `https://*.rbxcdn.com` doğrulanmış, yoksa `null`), `hasRoblox`.
  - **Arama ve Sayfalama:** `query` (en çok 40 karakter, Türkçe/İngilizce harf duyarsız `displayName` + `robloxUsername`), `limit` (varsayılan `30`, en çok `50`), alfabetik sıra, kararlı keyset `cursor` (`{ items, nextCursor, hasMore, total }`), `excludeSelf=1` aktörü çıkarır.
* **`POST /api/directory/lookup`**: Gövde `{ ids: [en çok 100 Discord ID], includeGames?: boolean }`. Aynı 7 alanla yalnızca verilen ID'ler içindeki kayıtlı ve sunucuda mevcut insan üyeleri **istek sırasıyla** döndürür (kayıtsız/bot/ayrılanlar atlanır; geçersiz/uzun girdide `400 { error, code }`). `includeGames: true` yalnızca `site-service` aktöründe her öğeye `games: [{ id, username }]` ekler (eski kayıtlarda `robloxUsername` okuma sırasında dönüştürülür); diğer aktörlerde bu alan asla dönmez.
* Diğer uç noktalar: `GET /api/member/:id/roles`, `POST /api/feedback`, `POST /api/admin/warn`, `POST /api/admin/warn/:id/evidence`.

---

## 📊 İstatistik Katmanı, Süre Güvenceleri ve Roblox Gruplama

### 1. "Bu ay aktif" ve "Şu an oyunda" Tanımları (`activity.config.js`)
Tek bir belirsiz sayı yerine iki ayrı, kimliksiz ölçü hesaplanır:
- **`activeThisMonth` ("Bu ay aktif" / "Active this month")**: Kayıtlı olan **VE** sunucuda hâlâ bulunan **VE** bot olmayan **VE** etkinlik takibi açık (`tracking: true`) **VE** bu ay en az `MIN_ACTIVE_MINUTES` (varsayılan `1` dk) kayıtlı süresi olan **benzersiz** üye sayısı. Bir üye kaç oyun oynarsa oynasın yalnızca **1 kez** sayılır; `/oyun` manuel rolleri sayıma girmez.
- **`playingNow` ("Şu an oyunda" / "Playing now")**: Kayıtlı, sunucuda, bot olmayan, takibi açık ve o an onaylı (`CONFIRM_SEC` geçmiş) canlı oyun oturumu **canlı Discord presence ile doğrulanan** benzersiz üye sayısı. Önbellekten kalma ama artık oyun göstermeyen bayat oturumlar sayılmaz.
- **`uncertainCount` (Belirsiz)**: Üye sunucu önbelleğinde değilse toplu `guild.members.fetch({ limit })` çağrısı **asla** yapılmaz; tur başına en çok `SAYIM_MEMBER_LOOKUP_CAP` (25) kişi, 1 saatlik önbellek ve kullanıcı başına 10 dk bekleme ile tek tek doğrulanır. Doğrulanamayanlar veya canlı presence bilgisi eksik oturumlar `uncertainCount` içinde ayrı tutulur. Sunucudan ayrılan üyenin kendi `activityStats` kaydı `guildMemberRemove` anında temizlenir.

### 2. Süre Hesabı Güvenceleri
- **Delta Esaslı Toplama (`lastCheckpointAt`)**: Her 60 sn checkpoint yalnızca son checkpoint'ten beri geçen farkı (`şimdi - lastCheckpointAt`) ekler; oturum başlangıcı kümülatif olarak tekrar toplanmaz.
- **Boşluk Sınırı (`MAX_DELTA_SEC = CHECKPOINT_SEC × 2 = 120 sn`)**: Bot kapandıysa, olay döngüsü takıldıysa veya saat sıçradıysa 120 sn üstü boşluk sayılmaz; yalnızca `120 sn` eklenir ve kimliksiz `boşlukKırpıldı` sayacı artar. Bot açılışında önbellekten yüklenen oturumların saati açılış anından başlar.
- **Discord `timestamps.start` Kuralı**: Discord'un etkinlik başlangıç zamanı süreye **asla** eklenmez; yalnızca onay (`CONFIRM_SEC`) kontrolünde kullanılır.
- **Tek Saat ve Ay Sınırı (B3 Değişmez Kuralı)**: Bir üye aynı saniyede yalnızca tek bir oyuna süre yazabilir; aylık toplamı ayın başından (`Europe/Istanbul`) o ana geçen gerçek süreyi aşamaz. İhlal girişimleri kırpılır ve `çiftSayımEngellendi` sayacı artar.
- **`STOP_GRACE_SEC` ve Ay Dönümü**: Oyun bırakıldıktan sonraki 5 sn bekleme süresi sayılmaz. Ay dönümünde (`00:00:00 Europe/Istanbul`) yarım kalan oturum tam sınırda bölünerek eski kısım eski aya (`activityAllTime`), yeni kısım yeni aya yazılır (kayıp ve çift yazım olmaz).
- **Mevcut Veriyi Koruma (`REPAIR_OVERSIZED_TOTALS_ON_START: false`)**: Varsayılan kapalıdır; mevcut veritabanı kayıtları onaysız değiştirilmez. Onaylanıp `true` yapılırsa açılışta yalnızca ay süresini aşan toplamlar tek seferlik orantılı kırpılır ve konsola kimliksiz özet yazılır.
- **Süre Biçimleyici (`formatDuration`)**: Bot ve sitede aynı kural geçerlidir (`0 dk`, `1 dk'dan az`, `1 sa`, `1 sa 59 dk`, `41 sa 47 dk`; `NaN`/`Infinity`/`undefined` üretmez).

### 3. Roblox Aile Gruplama ve `SHOW_FAMILY_BREAKDOWN`
- Aile eşlemesi yalnızca bottaki `activity.config.js` (`FAMILIES` + `GAMES` + `ROBLOX_UNKNOWN`) üzerinden `familyOfGame` ve `groupStatsByFamily` ile **okuma anında** yapılır; site kendi oyun listesini tutmaz.
- Veritabanındaki `activityStats` anahtarları (`roblox_unknown`, `tsb`, `bonk`, `apeirophobia`, `scp`, `jailbreak`, `erlc`, `minecraft`, `cs2`, `zula`) **değiştirilmez** (migrasyon yok).
- Tüm Roblox anahtarları tek **`🧱 Roblox`** satırında toplanır (`"Roblox (diğer)"` etiketi kaldırılmıştır); Minecraft (`⛏️`), CS2 (`🎯`) ve Zula (`🪖`) kendi satırlarında kalır.
- `/aktivitem`, `/api/member/:id/activity`, `/api/stats/top-games` ve `/api/stats/summary` aynı fonksiyonu kullanır.
- İsteğe bağlı `SHOW_FAMILY_BREAKDOWN` (varsayılan `false`): `true` yapılırsa Roblox satırının altında en çok 5 alt oyun ve `+N diğer` özeti gösterilir.

### 4. Bot-Site Sözleşmesi ve Deploy Sırası
- **Deploy Sırası: ÖNCE BOT, SONRA SİTE.**
- Geriye dönük uyumluluk iki yönlüdür:
  - Yeni bot, yeni alanların (`activeThisMonth`, `playingNow`, `uncertainCount`, `computedAt`, `families`) yanında tüm eski alanları (`activeRegisteredCount`, `playingCount`, `games`, `updatedAt`) döndürmeye devam ettiği için **eski site yeni botla** sorunsuz çalışır.
  - Yeni site, yeni alanlar yoksa sessizce eski alanlara düştüğü için **yeni site eski botla** da çökmeden çalışır.
- Herkese açık istatistik uçları (`summary`, `top-games`) asla kullanıcı ID'si veya kullanıcı adı içermez; Bearer `API_SECRET` ve hız sınırı korunur.

### 5. Sorun Giderme (Sayı veya Süre Tuhaf Görünüyorsa)
1. **Developer olarak `/aktivitem` -> `🛠️ Sistem Durumu` açın**:
   - `Aktif Sayım`: `activeThisMonth`, `playingNow`, `belirsiz (uncertainCount)` ve son hesaplanma zamanına bakın. `belirsiz` yüksekse Discord REST hız sınırı veya Presence Intent kapalı olabilir.
   - `Süre Sağlığı`: `boşluk kırpıldı`, `çift sayım engellendi` veya `ay süresini aşan üye` sıfır değilse `⚠️` görünür.
   - `Aile Gruplama`: Eşlenemeyen oyun anahtarı varsa kimliksiz adıyla listelenir.
2. **Saatlik konsol özetine bakın**: `[OYUN ETKİNLİĞİ] son 1 saat: activeThisMonth=... playingNow=... boşlukKırpıldı=... çiftSayımEngellendi=...` satırında artış olup olmadığını kontrol edin.
3. **Sıralamadaki saatler neden yüksek görünebilir?**: Sıralamadaki değer kişi başı ortalama değil, **tüm aktif oyuncuların bu ayki toplam süresidir** (ör. 10 kişi × 4 saat = 40 saat). Ayrıca oyunu açık bırakıp AFK kalan üyeler Discord `Playing` bilgisini göndermeye devam ettiği için süreleri doğal olarak artar.
4. **Çift bot örneği kontrolü**: Railway'de aynı token ile birden fazla replica çalışmadığından emin olun (tek süreç içinde `presenceUpdate` / `voiceStateUpdate` dinleyici sayısı `1` olarak korunur).

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
