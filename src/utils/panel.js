const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../../config');
const gamesConfig = require('../../games.config');

/**
 * Etkin oyunları virgülle ayrılmış emojili liste olarak üretir (Örn: "🧱 Roblox, 🔫 CS2, 🪖 Zula, ⛏️ Minecraft").
 */
function formatGamesInline(lang = 'tr') {
  const games = gamesConfig.getEnabledGames();
  return games
    .map((game) => `${game.emoji} ${gamesConfig.getGameLabel(game, lang)}`)
    .join(', ');
}

/**
 * Kayıt Kanalı Panel Mesajını (TR + EN iki dilli) ve sabit butonlarını üretir.
 * Not: btn_kayit_ol ve btn_kayit_ol_en customId'leri geriye dönük uyumluluk için korunur.
 */
function createRegisterPanel() {
  const gamesTr = formatGamesInline('tr');
  const gamesEn = formatGamesInline('en');
  const todayStr = new Date().toLocaleDateString('tr-TR');

  const trSection =
    `## 🇹🇷 📋 Nasıl Kayıt Olunur?\n` +
    `> **1️⃣** Aşağıdaki **"✅ Kayıt Ol (Türkçe)"** butonuna tıkla.\n` +
    `> **2️⃣** Oynadığın oyunları seç: ${gamesTr}.\n` +
    `> *Birden fazla seçebilirsin; her oyunu bir kez seçebilirsin. Sonra **"Devam"** butonuna bas.*\n` +
    `> **3️⃣** Cinsiyetini seç (**👦 Erkek** / **👧 Kız**).\n` +
    `> **4️⃣** Formu doldur: adın *(istersen takma ad)* ve seçtiğin oyunların kullanıcı adları. *(Yanlış dilde açılırsa **Esc** ile kapatıp önceki mesajdaki dil butonunu kullanabilirsin)*\n` +
    `> **5️⃣** Roblox seçtiysen hesabın otomatik doğrulanır; hesap bulunamazsa başvuru reddedilir.\n` +
    `> **6️⃣** Yetkililer onaylayınca rollerin otomatik verilir: **🎭 Cengaver**, **✅ Hesabı Onaylı** ve seçtiğin oyunların rolleri.\n\n` +
    `### ⚠️ Önemli\n` +
    `• Roblox için görünen ad (Display Name) değil asıl **\`@kullanıcı\`** adını yaz\n` +
    `• **1 Discord hesabı = 1 Roblox hesabı** • Roblox'ta yasaklı hesaplar kabul edilmez\n` +
    `• Bilgileri doğru ve eksiksiz yaz\n` +
    `💡 *Kayıttan sonra \`/profilim\` yazarak oyunlarını ve kullanıcı adlarını herkese gösterebilirsin.*`;

  const enSection =
    `## 🇬🇧 📋 How to Register?\n` +
    `> **1️⃣** Click the **"🇬🇧 Register (English)"** button below.\n` +
    `> **2️⃣** Pick the games you play: ${gamesEn}.\n` +
    `> *You can select multiple games (each once). Then click **"Continue"**.*\n` +
    `> **3️⃣** Choose your gender (**👦 Male** / **👧 Female**).\n` +
    `> **4️⃣** Fill out the survey: your name *(or nickname)* and the usernames for your selected games. *(If it opens in the wrong language, press **Esc** and use the language button on the previous message)*\n` +
    `> **5️⃣** If you selected Roblox, your account is verified automatically; missing accounts are rejected.\n` +
    `> **6️⃣** Once approved by staff, your roles are assigned automatically: **🎭 Cengaver**, **✅ Verified Account**, and your selected game roles.\n\n` +
    `### ⚠️ Important\n` +
    `• For Roblox, enter your actual **\`@username\`** — not your Display Name\n` +
    `• **1 Discord Account = 1 Roblox Account** • Banned Roblox accounts are not accepted\n` +
    `• Enter accurate and complete information\n` +
    `💡 *After registering, use \`/profile\` to share your games and usernames with everyone.*`;

  const langHintLine =
    `🌐 *Yanlış dili mi seçtin? Kayıt sırasında dil butonuna basarak değiştirebilirsin. / Chose the wrong language? Use the language button during registration.*`;

  const fullDescription = `${trSection}\n\n━━━━━━━━━━━━━━━━━━━━\n\n${enSection}\n\n${langHintLine}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol')
      .setLabel('✅ Kayıt Ol (Türkçe)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol_en')
      .setLabel('🇬🇧 Register (English)')
      .setStyle(ButtonStyle.Secondary)
  );

  // Embed açıklama sınırı (4096) kontrolü: normalde ~2000 karakter, taşma ihtimaline karşı iki embed'e böler
  const footerText = `${config.BRAND_NAME} • Güvenli Doğrulama • Secure Verification • ${todayStr}`;

  if (fullDescription.length <= 4096) {
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ ${config.BRAND_NAME} | Kayıt Sistemi / Registration`)
      .setColor(config.COLORS.BLUE)
      .setDescription(fullDescription)
      .setFooter({ text: footerText });

    return {
      embeds: [embed],
      components: [row],
    };
  }

  const embedTr = new EmbedBuilder()
    .setTitle(`🛡️ ${config.BRAND_NAME} | Kayıt Sistemi`)
    .setColor(config.COLORS.BLUE)
    .setDescription(trSection);

  const embedEn = new EmbedBuilder()
    .setTitle(`🛡️ ${config.BRAND_NAME} | Registration`)
    .setColor(config.COLORS.BLUE)
    .setDescription(enSection)
    .setFooter({ text: footerText });

  return {
    embeds: [embedTr, embedEn],
    components: [row],
  };
}

/**
 * İngilizce Kayıt Rehberi Embed'ini Üretir (Geriye dönük dışa aktarım uyumluluğu için).
 */
function createEnglishRegisterGuideEmbed() {
  const gamesEn = formatGamesInline('en');
  return new EmbedBuilder()
    .setTitle(`🛡️ ${config.BRAND_NAME} | Registration Guide (EN)`)
    .setColor(config.COLORS.BLUE)
    .setDescription(
      `Welcome to **${config.BRAND_NAME}**! Complete your registration in a few quick steps:\n\n` +
      `> **1️⃣** Select the games you play: ${gamesEn}\n` +
      `> **2️⃣** Choose your gender (**👦 Male** / **👧 Female**)\n` +
      `> **3️⃣** Enter your name/nickname and game usernames in the form\n` +
      `> **4️⃣** Staff will review and approve your application, assigning your game roles automatically!`
    )
    .setFooter({
      text: `${config.BRAND_NAME} • Registration System`,
    });
}

/**
 * Bir mesajın bot tarafından gönderilmiş ve içinde "btn_kayit_ol" customId'li buton
 * barındıran kayıt paneli olup olmadığını kontrol eder.
 */
function isRegisterPanelMessage(message, botUserId) {
  if (!message || !botUserId) return false;
  if (String(message.author?.id) !== String(botUserId)) return false;
  if (!Array.isArray(message.components)) return false;

  return message.components.some((row) =>
    Array.isArray(row?.components) &&
    row.components.some((comp) => (comp.customId || comp.data?.custom_id) === 'btn_kayit_ol')
  );
}

/**
 * Kanal içindeki bot kayıt paneli mesajlarını en yeniden en eskiye sıralı döndürür.
 */
async function findRegisterPanelMessages(channel, botUserId) {
  if (!channel || !botUserId || !channel.messages?.fetch) return [];

  const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!fetched) return [];

  const list = Array.from(fetched.values()).filter((m) => isRegisterPanelMessage(m, botUserId));

  // En yenisi başa gelecek şekilde sırala (önce Snowflake ID / zaman damgası)
  list.sort((a, b) => {
    if (a.id && b.id && /^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
      if (BigInt(b.id) > BigInt(a.id)) return 1;
      if (BigInt(b.id) < BigInt(a.id)) return -1;
    }
    return (b.createdTimestamp || 0) - (a.createdTimestamp || 0);
  });

  return list;
}

/**
 * Kayıt kanalındaki mevcut kayıt panelini buton customId'sine göre bulup günceller.
 * Birden fazla panel varsa fazlalıkları SİLMEZ, sadece en yenisini günceller ve loga yazar.
 * @param {import('discord.js').Guild} guild
 * @param {{ channelId?: string, createIfMissing?: boolean }} options
 */
async function ensureRegisterPanelMessage(guild, options = {}) {
  if (!guild) return { action: 'none', message: null, duplicatesFound: 0 };

  const targetChannelId = options.channelId || config.CHANNELS.REGISTER;
  const channel =
    guild.channels?.cache?.get(targetChannelId) ||
    (await guild.channels?.fetch?.(targetChannelId).catch(() => null));

  if (!channel) return { action: 'no_channel', message: null, duplicatesFound: 0 };

  const botUserId = guild.client?.user?.id;
  if (!botUserId) return { action: 'no_client', message: null, duplicatesFound: 0 };

  try {
    const panelMessages = await findRegisterPanelMessages(channel, botUserId);

    if (panelMessages.length > 1) {
      console.warn(
        `[KAYIT PANELİ] <#${channel.id}> kanalında ${panelMessages.length} adet kayıt paneli bulundu. Eskiler silinmeden yalnızca en yenisi (${panelMessages[0].id}) güncellenecek.`
      );
    }

    const payload = createRegisterPanel();

    if (panelMessages.length > 0) {
      const newest = panelMessages[0];
      await newest.edit(payload);
      return {
        action: 'updated',
        message: newest,
        duplicatesFound: panelMessages.length - 1,
      };
    }

    if (options.createIfMissing) {
      const sent = await channel.send(payload);
      return {
        action: 'created',
        message: sent,
        duplicatesFound: 0,
      };
    }

    return { action: 'not_found', message: null, duplicatesFound: 0 };
  } catch (err) {
    console.warn('[KAYIT PANELİ GÜNCELLEME HATASI]:', err.message);
    return { action: 'error', error: err.message, message: null, duplicatesFound: 0 };
  }
}

module.exports = {
  createRegisterPanel,
  createEnglishRegisterGuideEmbed,
  isRegisterPanelMessage,
  findRegisterPanelMessages,
  ensureRegisterPanelMessage,
};
