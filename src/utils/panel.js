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
      `> **2️⃣ Adım:** Kayıt türünüzü seçin (**🛡️ Piyade Klanına Katılmak İstiyorum** veya **🏳️ Bir Klanım Bulunmakta**).\n` +
      `> \n` +
      `> **3️⃣ Adım:** Açılan menüden **Cinsiyetinizi** (👨 Erkek veya 👩 Kız) belirleyin.\n` +
      `> \n` +
      `> **4️⃣ Adım:** Ekrana gelen kayıt formuna **Gerçek Adınızı**, **Roblox Bilginizi** (ve başka klandaysanız **Klan Adınızı**) eksiksiz yazın.\n` +
      `> \n` +
      `> **5️⃣ Adım:** Sistem Roblox hesabınızı otomatik olarak sorgular ve adınıza özel bir kayıt odası açar.\n` +
      `> \n` +
      `> **6️⃣ Adım:** Yetkili ekibimiz başvurunuzu onayladığında uygun rolleriniz (Piyade Üyeliği veya Diğer Klan + Klan Rolü) otomatik tanımlanır!\n\n` +
      `### ⚠️ Önemli Kurallar & Uyarılar\n` +
      `• **Doğru Hesap Bilgisi:** Lütfen Roblox görünen adınızı (Display Name) değil, asıl **\`@kullanıcı\`** adınızı veya linkinizi giriniz.\n` +
      `• **Multi-Hesap Koruması:** Sunucumuzda **1 Discord Hesabı = 1 Roblox Hesabı** kuralı geçerlidir. Başka bir üyeye kayıtlı hesaplar kabul edilmez.\n` +
      `• **Yasaklı Hesaplar:** Roblox platformu üzerinde yasaklanmış (Banned) hesaplarla kayıt olunamaz.\n` +
      `• **Klan Seçimi:** Başka bir klandaysanız "Bir Klanım Bulunmakta" seçeneğini seçiniz; klanınız için özel klan rolü atanacaktır.\n\n` +
      `***`
    )
    .setFooter({
      text: `🛡️ Piyade Team & TSB Kayıt Sistemi • Güvenli Doğrulama • ${new Date().toLocaleDateString('tr-TR')}`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol')
      .setLabel('✅ Kayıt Ol')
      .setStyle(ButtonStyle.Primary), // Mavi Discord Butonu
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol_en')
      .setLabel('🇬🇧 Register (English)')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

/**
 * İngilizce Kayıt Rehberi Embed'ini Üretir (Ephemeral)
 */
function createEnglishRegisterGuideEmbed() {
  return new EmbedBuilder()
    .setTitle('🛡️ Piyade Team | TSB | Registration Guide (EN)')
    .setColor(config.COLORS.BLUE)
    .setDescription(
      `***\n\n` +
      `## 📋 How to Register?\n\n` +
      `Welcome to **Piyade Team | TSB**! Follow these steps to verify your account and unlock member channels:\n\n` +
      `> **1️⃣ Step:** Select your registration type (**🛡️ I Want to Join the Piyade Clan** or **🏳️ I Already Have a Clan**).\n` +
      `> \n` +
      `> **2️⃣ Step:** Select your **Gender** (**👨 Male** or **👩 Female**) from the dropdown menu.\n` +
      `> \n` +
      `> **3️⃣ Step:** Fill out the registration form with your **Real Name**, **Roblox Info** (\`@username\`, User ID, or Profile Link), and your **Clan Name** if you have one.\n` +
      `> \n` +
      `> **4️⃣ Step:** Our system will automatically verify your Roblox account and open a private registration thread for you.\n` +
      `> \n` +
      `> **5️⃣ Step:** Once our staff approves your application, your member/clan roles and the **🇬🇧 English** role will be assigned automatically!\n\n` +
      `### ⚠️ Important Rules\n` +
      `• **Exact Username:** Please enter your actual Roblox **\`@username\`**, User ID, or profile URL — **not** your Display Name.\n` +
      `• **One Account Rule:** **1 Discord Account = 1 Roblox Account**. Accounts already linked to another member will be rejected.\n` +
      `• **Banned Accounts:** Terminated/banned Roblox accounts cannot register.\n` +
      `• **Clan Selection:** If you belong to another clan, select "I Already Have a Clan" to receive your custom clan role.\n\n` +
      `***`
    )
    .setFooter({
      text: '🛡️ Piyade Team & TSB Registration System • English Support',
    });
}

/**
 * Sunucu açılışında kayıt kanalındaki mevcut kayıt panelini yeni butonlarla günceller
 */
async function ensureRegisterPanelMessage(guild) {
  if (!guild) return;

  const channel =
    guild.channels.cache.get(config.CHANNELS.REGISTER) ||
    (await guild.channels.fetch(config.CHANNELS.REGISTER).catch(() => null));

  if (!channel) return;

  try {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (!messages) return;

    const existingBotPanel = messages.find(
      (m) =>
        m.author.id === guild.client.user.id &&
        m.embeds.length > 0 &&
        m.embeds[0].title &&
        m.embeds[0].title.includes('Kayıt Sistemi')
    );

    if (existingBotPanel) {
      await existingBotPanel.edit(createRegisterPanel());
    }
  } catch (err) {
    console.warn('[KAYIT PANELİ GÜNCELLEME HATASI]:', err.message);
  }
}

module.exports = {
  createRegisterPanel,
  createEnglishRegisterGuideEmbed,
  ensureRegisterPanelMessage,
};
