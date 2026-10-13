const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../../config');

/**
 * Kayıt Kanalı Panel Mesajını ve Butonunu Mavi Embed Olarak Üretir.
 */
function createRegisterPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Piyade Team | TSB | Kayıt Sistemi')
    .setColor(config.COLORS.BLUE) // 0x0099FF Canlı Mavi
    .setDescription(
      `***\n\n` +
      `## 📋 Nasıl Kayıt Olunur?\n\n` +
      `Sunucumuza hoş geldiniz! Topluluğumuzun bir parçası olmak, etkinliklere katılmak ve üye rollerinize erişebilmek için aşağıdaki adımları sırasıyla izleyiniz:\n\n` +
      `> **1️⃣ Adım:** Aşağıda yer alan **"✅ Kayıt Ol"** butonuna tıklayın.\n` +
      `> \n` +
      `> **2️⃣ Adım:** Açılan menüden **Cinsiyetinizi** (👨 Erkek veya 👩 Kız) belirleyin.\n` +
      `> \n` +
      `> **3️⃣ Adım:** Ekrana gelen kayıt formuna **Gerçek Adınızı** ve **Roblox Bilginizi** (Kullanıcı Adı, ID veya Profil Linki) eksiksiz yazın.\n` +
      `> \n` +
      `> **4️⃣ Adım:** Sistem Roblox hesabınızı otomatik olarak sorgular, güvenliği teyit eder ve adınıza özel bir kayıt odası açar.\n` +
      `> \n` +
      `> **5️⃣ Adım:** Yetkili ekibimiz başvurunuzu onayladığında rolleriniz otomatik olarak hesabınıza tanımlanır!\n\n` +
      `### ⚠️ Önemli Kurallar & Uyarılar\n` +
      `• **Doğru Hesap Bilgisi:** Lütfen Roblox görünen adınızı (Display Name) değil, asıl **\`@kullanıcı\`** adınızı veya linkinizi giriniz.\n` +
      `• **Multi-Hesap Koruması:** Sunucumuzda **1 Discord Hesabı = 1 Roblox Hesabı** kuralı geçerlidir. Başka bir üyeye kayıtlı hesaplar kabul edilmez.\n` +
      `• **Yasaklı Hesaplar:** Roblox platformu üzerinde yasaklanmış (Banned) hesaplarla kayıt olunamaz.\n\n` +
      `***`
    )
    .setFooter({
      text: `🛡️ Piyade Team & TSB Kayıt Sistemi • Güvenli Doğrulama • ${new Date().toLocaleDateString('tr-TR')}`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol')
      .setLabel('✅ Kayıt Ol')
      .setStyle(ButtonStyle.Primary) // Mavi Discord Butonu
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

module.exports = {
  createRegisterPanel,
};
