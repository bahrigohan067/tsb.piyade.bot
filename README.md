# Piyade Team | TSB | Roblox Doğrulamalı Kayıt Botu 🛡️

Bu bot, **Piyade Team | TSB** Discord sunucusu için geliştirilmiş, Roblox API doğrulamalı, multi-hesap korumalı, özel kayıt odalı (Thread) ve yetkili onay sistemli gelişmiş bir kayıt botudur.

---

## 🚀 Özellikler

1. **Gelişmiş Kayıt Paneli (`/kayit-paneli`):**
   - Kayıt kanalına şık, kuralları ve adımları açıklayan başlık ve bölmelerle donatılmış panel gönderir.
   - Kullanıcı **"✅ Kayıt Ol"** butonuna tıklar.
2. **Ön Kontroller:**
   - **Zaten Üye mi?** (`1559604702143062016` rolü varsa engeller).
   - **Aktif Başvuru Kontrolü:** Halihazırda açık başvurusu varsa kullanıcının mevcut odasını gösterir.
3. **Kayıt Formu (`KayitModal`):**
   - **Cinsiyet Seçimi (Açılır Menü):** 👨 Erkek veya 👩 Kız seçimi yapılır.
   - **Gerçek Adı:** Örn: Ahmet Yılmaz
   - **Roblox Bilgisi:** Kullanıcı Adı, ID veya Profil Linki kabul edilir.
4. **Otomatik Güvenlik & API Doğrulamaları:**
   - **Roblox API Doğrulaması:** Hesap bulunamazsa `@` kullanıcı adını girmesi gerektiği DM ile iletilir.
   - **Yasaklı (Banned) Hesap Engeli:** Roblox üzerinde banlı hesapların başvurusu anında reddedilir.
   - **Multi-Hesap (Tekil Kimlik) Koruması:** Bir Roblox hesabı yalnızca 1 Discord hesabına bağlanabilir. Başka hesaba kayıtlıysa sistem başvuruyu reddeder.
5. **Özel Kayıt Odası (Thread):**
   - Kullanıcıya özel `🟡・kullanıcı-adı` odası açılır, işleyiş hakkında detaylı bilgilendirme mesajı atılır.
6. **Yetkili Onay Kartı:**
   - Yetkili kanalına (`1559621928187199488`), `<@&1559625308737507358>` yetkili rolü etiketlenerek Roblox avatarı, hesap açılış/katılış tarihleri ve detaylı bilgiler ile düşer.
7. **Yetkili Kararı:**
   - **✅ Onayla:** `<@&1559604645821812896>` ve `<@&1559604702143062016>` rolleri verilir, kayıtsız rolü (`1559604540997636147`) alınır. Kullanıcıya DM ve odasından tebrik mesajı atılır.
   - **✖️ Reddet:** Yetkiliden red sebebi istenir. Sebep DM ve odadan bildirilir. Özel oda 5 dakika sonra otomatik olarak silinir.
8. **Otomatik Kayıtsız Rolü:**
   - Sunucuya katılan her yeni üyeye otomatik `<@&1559604540997636147>` Kayıtsız rolü verilir.

---

## 🛠️ GitHub & Railway Kurulum Rehberi

### 1. Discord Developer Portal Ayarları
1. [Discord Developer Portal](https://discord.com/developers/applications) adresine gidin.
2. Botunuzu seçin ve **Bot** sekmesine gelin.
3. **Privileged Gateway Intents** bölümünden:
   - ✅ **Server Members Intent** (ZORUNLU - Yeni üye rolü ve yetkili işlemleri için)
   - ✅ **Message Content Intent**
   açık olduğundan emin olun ve kaydedin.
4. Sunucunuzda **Sunucu Ayarları > Roller** kısmından botun rolünü, vereceği rollerin (`1559604645821812896`, `1559604702143062016`, `1559604540997636147`) **ÜSTÜNE** taşıyın (Discord rol hiyerarşisi kuralı).

---

### 2. GitHub'a Gönderme
Projeyi GitHub reponuza göndermek için terminalde şu komutları çalıştırın:

```bash
git add .
git commit -m "feat: TSB Piyade Roblox kayit botu tamamlandi"
git push origin main
```

---

### 3. Railway Üzerinde Dağıtım (Deploy)
1. [Railway.app](https://railway.app) hesabınıza giriş yapın.
2. **New Project** > **Deploy from GitHub repo** seçin ve `tsb.piyade.bot` reponuzu bağlayın.
3. Proje açıldıktan sonra **Variables** (Çevre Değişkenleri) sekmesine gelin ve şunları ekleyin:
   - `TSB_TOKEN` = `Botunuzun Discord Tokeni`
   - `GUILD_ID` = `1559313292651008040`
4. Railway otomatik olarak `npm install` ve `npm start` komutlarını çalıştırarak botunuzu 7/24 aktif hale getirecektir!

---

### 4. Sunucuda Paneli Kurma
Bot aktif olduktan sonra sunucunuzda yetkili bir hesapla:
```text
/kayit-paneli
```
komutunu yazmanız yeterlidir. Panel doğrudan belirlenen kayıt kanalına (`1559605626198302741`) gönderilecektir.

---

## 📁 Dosya Yapısı

```
tsb.piyade.bot/
├── config.js                 # Sunucu ID'leri, rol ve kanal yapılandırmaları
├── index.js                  # Bot başlatıcı ve olay yükleyici
├── package.json              # Bağımlılıklar ve başlatma betikleri
├── .env.example              # Örnek çevre değişkenleri dosyası
├── .gitignore                # Git yok sayma listesi
├── data/
│   └── database.json         # Yerel kayıt ve multi-hesap veritabanı
└── src/
    ├── commands/
    │   ├── kayitPaneli.js    # /kayit-paneli komutu
    │   └── kayitBilgi.js     # /kayit-bilgi komutu
    ├── events/
    │   ├── ready.js          # Bot hazır olduğunda çalışan olay
    │   ├── guildMemberAdd.js # Yeni üyelere kayıtsız rolü verme olayı
    │   └── interactionCreate.js # Buton, modal, select menu ve onay mekanizmaları
    ├── services/
    │   └── roblox.js         # Roblox API sorgulama, ban ve avatar servisi
    └── utils/
        ├── database.js       # JSON veritabanı okuma/yazma yöneticisi
        └── panel.js          # Kayıt paneli mesaj ve buton oluşturucu
```