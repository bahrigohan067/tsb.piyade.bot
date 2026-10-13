const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Kayıt Kanalı Panel Mesajını ve Butonunu Üretir.
 */
function createRegisterPanel() {
  const panelContent = `# Piyade Team | TSB | Kayıt Sistemi

***

## 📋 Nasıl Kayıt Olunur?

Sunucumuza hoş geldiniz! Topluluğumuzun bir parçası olmak, oyun içi etkinliklere katılmak ve yetkili/üye rollerinize erişebilmek için aşağıdaki adımları sırasıyla izleyiniz:

> **1️⃣ Adım:** Aşağıda yer alan **"✅ Kayıt Ol"** butonuna tıklayın.
> 
> **2️⃣ Adım:** Açılan menüden **Cinsiyetinizi** (👨 Erkek veya 👩 Kız) belirleyin.
> 
> **3️⃣ Adım:** Ekrana gelen kayıt formuna **Gerçek Adınızı** ve **Roblox Bilginizi** (Kullanıcı Adı, ID veya Profil Linki) eksiksiz yazın.
> 
> **4️⃣ Adım:** Sistem Roblox hesabınızı otomatik olarak sorgular, güvenliği teyit eder ve adınıza özel bir kayıt odası açar.
> 
> **5️⃣ Adım:** Yetkili ekibimiz başvurunuzu onayladığında rolleriniz otomatik olarak hesabınıza tanımlanır!

### ⚠️ Önemli Kurallar & Uyarılar
• **Doğru Hesap Bilgisi:** Lütfen Roblox görünen adınızı (Display Name) değil, asıl **\`@kullanıcı\`** adınızı veya linkinizi giriniz.
• **Multi-Hesap Koruması:** Sunucumuzda **1 Discord Hesabı = 1 Roblox Hesabı** kuralı geçerlidir. Başka bir üyeye kayıtlı hesaplar kabul edilmez.
• **Yasaklı Hesaplar:** Roblox platformu üzerinde yasaklanmış (Banned) hesaplarla kayıt olunamaz.

***

-# 🛡️ Piyade Team & TSB Kayıt Sistemi • Güvenli Doğrulama • ${new Date().toLocaleDateString('tr-TR')}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol')
      .setLabel('✅ Kayıt Ol')
      .setStyle(ButtonStyle.Success)
  );

  return {
    content: panelContent,
    components: [row],
  };
}

module.exports = {
  createRegisterPanel,
};
