# Piyade Team | TSB | Kayıt & VS (Kapışma) Botu 🛡️⚔️

Bu bot, **Piyade Team | TSB** Discord sunucusu için geliştirilmiş, Roblox API doğrulamalı kayıt sistemi ve tam teşekküllü **VS (Kapışma) Talep & Top 10 Sıralama Sistemi** içeren gelişmiş bir sunucu yönetim botudur.

---

## 🚀 Başlıca Özellikler

### 1. 🛡️ Roblox Doğrulamalı Kayıt Sistemi
* **Gelişmiş Kayıt Paneli (`/kayit-paneli`):**
  - Mavi temalı Discord Embed formatında ve **`✅ Kayıt Ol`** butonuyla kurulur.
* **Ön Kontroller:**
  - `<@&1559604702143062016>` rolü varsa mükerrer kayıt engellenir.
  - Aktif başvurusu olanlar devam eden odalarına yönlendirilir.
* **Kayıt Formu (`KayitModal`):**
  - Cinsiyet seçimi açılır menüsü (👨 Erkek / 👩 Kız).
  - Gerçek Adı (Ad Soyad) ve Roblox Bilgisi (Kullanıcı Adı, ID veya Profil Linki).
  - Formdaki cinsiyet okunarak kayıt onaylandığında:
    - Erkek ise: `<@&1559637360558350356>` Erkek rolü tanımlanır.
    - Kız ise: `<@&1559637300042797096>` Kız rolü tanımlanır.
    - Genel Roller: `<@&1559604645821812896>` ve `<@&1559604702143062016>` tanımlanır.
    - `<@&1559604540997636147>` Kayıtsız rolü üzerinden geri alınır.
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

## 🛠️ Slash Komutları Listesi

| Komut | Yetki | Açıklama |
|---|---|---|
| `/kayit-paneli` | Yönetici | Kayıt panelini kayıt kanalına kurar. |
| `/kayit-bilgi` | Yetkili | Bir üyenin veya Roblox ID'sinin kayıt detaylarını sorgular. |
| `/vs_talep_panel_kur` | Yönetici | VS Talep panelini ilgili kanala kurar. |
| `/top10_guncelle` | Yönetici | Top 10 sıralama tablosunu anında yeniler. |
| `/yardim_paneli_kur` | Yönetici | Acil Yardım ve Takviye Çağrısı panelini kurar. |

---

## 🚀 GitHub ve Railway Güncellemesi

Değişiklikleri GitHub'a pushlayarak Railway üzerinde otomatik güncelleyebilirsiniz:

```bash
git add .
git commit -m "feat: VS sistemi, Top 10 tablosu, takma ad ve thread silme eklendi"
git push origin main
```