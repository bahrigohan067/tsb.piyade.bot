const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const { resolveLang } = require('./i18n');

// 12 adet mor çizgi emojisi
const PURPLE_DIVIDER = Array(12).fill(config.EMOJIS.PURPLE_LINE).join('');

// Tüm renk rolü ID'leri kümesi
const COLOR_ROLE_IDS = new Set(config.COLOR_ROLES.map((c) => c.id));

const COLOR_LABELS_EN = {
  Siyah: 'Black',
  Kırmızı: 'Red',
  Sarı: 'Yellow',
  Mavi: 'Blue',
  Yeşil: 'Green',
  Pembe: 'Pink',
};

// 10 saniyelik bekleme süresi (Cooldown: Map<userId, timestamp>)
const colorCooldowns = new Map();
const COLOR_COOLDOWN_MS = 10 * 1000; // 10 Saniye

/**
 * İsim Rengi Seçim Panelini Üretir (1559605214690934854 Kanalı İçin)
 */
function createColorPanel() {
  const styleMap = {
    Primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger,
  };

  const embed = new EmbedBuilder()
    .setTitle(`${config.EMOJIS.KING} Piyade Team | TSB | İsim Rengi Seçim Paneli 🎨✨`)
    .setColor(0x9B59B6) // Canlı Mor / Gökkuşağı Teması
    .setDescription(
      `${PURPLE_DIVIDER}\n\n` +
      `## 🌈 İsim Rengi Sistemi Nedir? Ne İşe Yarar?\n` +
      `Sunucumuzda sohbet ederken, üye listesinde görünürken ve ses kanallarında takılırken **isminizin kendi tarzınızı yansıtan özel bir renkte** görünmesini ister misiniz? 💎✨\n\n` +
      `Bu panel sayesinde hiçbir yetkiliye ihtiyaç duymadan, **tek bir tıklamayla** dilediğiniz renk rolünü üzerinize alabilir ve istediğiniz zaman değiştirebilirsiniz! 🎭🔥\n\n` +
      `${PURPLE_DIVIDER}\n\n` +
      `## 📋 Nasıl Kullanılır & Kurallar\n` +
      `> 🖱️ **1️⃣ Renk Seçimi:** Aşağıda yer alan renk butonlarından beğendiğiniz renge tıklayın; bot anında renginizi tanımlayacaktır!\n` +
      `> 🎨 **2️⃣ Tek Renk Kuralı:** Aynı anda **sadece 1 renk rolüne** sahip olabilirsiniz. Yeni bir renge tıkladığınızda **önceki renk rolünüz otomatik olarak alınır** ve yeni seçtiğiniz renk verilir!\n` +
      `> 🗑️ **3️⃣ Rengi Kaldırma:** Üzerinizde bulunan rengin butonuna tekrar tıklarsanız renk rolünüz kaldırılır.\n` +
      `> ⏳ **4️⃣ Bekleme Süresi:** Spam yapılmasını önlemek adına renk butonlarını **10 saniye aralıklarla** kullanabilirsiniz.\n\n` +
      `${PURPLE_DIVIDER}\n\n` +
      `## 🎨 Mevcut İsim Renklerimiz (Önizleme / Preview)\n\n` +
      `> 🖤 <@&1559899395233808444> — **Siyah / Black** *(Asil & Karanlık Tarz)*\n` +
      `> ❤️ <@&1559926857472675910> — **Kırmızı / Red** *(Ateşli & Keskin Tarz)*\n` +
      `> 💛 <@&1559927000183873597> — **Sarı / Yellow** *(Parlak & Enerjik Tarz)*\n` +
      `> 💙 <@&1559926616535339010> — **Mavi / Blue** *(Soğukkanlı & Okyanus Tarzı)*\n` +
      `> 💚 <@&1559926912338362379> — **Yeşil / Green** *(Canlı & Zümrüt Tarzı)*\n` +
      `> 🩷 <@&1559926687645311017> — **Pembe / Pink** *(Neon & Gösterişli Tarz)*\n\n` +
      `🇬🇧 **English:** Click any button below to equip a name color (1 color max, click again to remove, 10s cooldown).\n\n` +
      `${PURPLE_DIVIDER}\n` +
      `-# ${config.EMOJIS.MODERATOR} Piyade Team | TSB • Kişiselleştirilebilir İsim Rengi Sistemi ✨`
    )
    .setFooter({
      text: '🎨 Piyade Team • Sadece 1 renk seçilebilir (1 color max) • Bekleme süresi: 10sn',
    })
    .setTimestamp();

  // 1. Satır Butonları (İlk 3 Renk: Siyah, Kırmızı, Sarı)
  const row1 = new ActionRowBuilder();
  config.COLOR_ROLES.slice(0, 3).forEach((color) => {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_color_${color.id}`)
        .setLabel(color.label)
        .setEmoji(color.emoji)
        .setStyle(styleMap[color.style] || ButtonStyle.Secondary)
    );
  });

  // 2. Satır Butonları (Son 3 Renk: Mavi, Yeşil, Pembe)
  const row2 = new ActionRowBuilder();
  config.COLOR_ROLES.slice(3, 6).forEach((color) => {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_color_${color.id}`)
        .setLabel(color.label)
        .setEmoji(color.emoji)
        .setStyle(styleMap[color.style] || ButtonStyle.Primary)
    );
  });

  // 3. Satır Butonu (İngilizce Rehber Butonu)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_color_en_info')
      .setLabel('🇬🇧 English')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row1, row2, row3],
  };
}

/**
 * İngilizce İsim Rengi Seçim Paneli Rehberi Embed'ini Üretir (Ephemeral)
 */
function createEnglishColorGuideEmbed() {
  return new EmbedBuilder()
    .setTitle(`${config.EMOJIS.KING} Piyade Team | TSB | Name Color Selection Panel (EN) 🎨✨`)
    .setColor(0x9B59B6)
    .setDescription(
      `${PURPLE_DIVIDER}\n\n` +
      `## 🌈 What is the Name Color System?\n` +
      `Would you like your display name to stand out with a **custom color** while chatting, appearing on the member list, and hanging out in voice channels? 💎✨\n\n` +
      `With this panel, you can equip or change your favorite color role **with a single click** — no staff needed! 🎭🔥\n\n` +
      `${PURPLE_DIVIDER}\n\n` +
      `## 📋 How to Use & Rules\n` +
      `> 🖱️ **1️⃣ Choose a Color:** Click any color button on the panel to equip that color role instantly!\n` +
      `> 🎨 **2️⃣ Single Color Rule:** You can only have **1 color role** at a time. Clicking a new color **automatically removes your previous color** and assigns the new one!\n` +
      `> 🗑️ **3️⃣ Remove Color:** Click the button of the color you currently have equipped to remove your color role.\n` +
      `> ⏳ **4️⃣ Cooldown:** To prevent spam, color buttons have a **10-second cooldown**.\n\n` +
      `${PURPLE_DIVIDER}\n\n` +
      `## 🎨 Available Name Colors (Preview)\n\n` +
      `> 🖤 <@&1559899395233808444> — **Black** *(Siyah — Noble & Dark Style)*\n` +
      `> ❤️ <@&1559926857472675910> — **Red** *(Kırmızı — Fiery & Sharp Style)*\n` +
      `> 💛 <@&1559927000183873597> — **Yellow** *(Sarı — Bright & Energetic Style)*\n` +
      `> 💙 <@&1559926616535339010> — **Blue** *(Mavi — Cool & Ocean Style)*\n` +
      `> 💚 <@&1559926912338362379> — **Green** *(Yeşil — Vibrant & Emerald Style)*\n` +
      `> 🩷 <@&1559926687645311017> — **Pink** *(Pembe — Neon & Flashy Style)*\n\n` +
      `${PURPLE_DIVIDER}\n` +
      `-# ${config.EMOJIS.MODERATOR} Piyade Team | TSB • Customizable Name Color System ✨`
    )
    .setFooter({
      text: '🎨 Piyade Team • Only 1 color allowed at a time • Cooldown: 10 Seconds',
    })
    .setTimestamp();
}

/**
 * Kullanıcı Bir Renk Butonuna Bastığında Çalışan Fonksiyon
 */
async function handleColorButton(interaction, roleId) {
  const userId = interaction.user.id;
  const now = Date.now();
  const isEn = resolveLang(interaction) === 'en';

  // 1. 10 Saniye Bekleme Süresi (Cooldown) Kontrolü
  const lastUsed = colorCooldowns.get(userId);
  if (lastUsed && now - lastUsed < COLOR_COOLDOWN_MS) {
    const remainingSec = Math.ceil((COLOR_COOLDOWN_MS - (now - lastUsed)) / 1000);
    return interaction.reply({
      content: isEn
        ? `⏳ **Clicking Too Fast!**\nYou can use the color panel once every **10 seconds**. Please try again in **${remainingSec} seconds**! 🎨`
        : `⏳ **Çok Hızlı Tıklıyorsunuz!**\nRenk panelini **10 saniye** aralıklarla kullanabilirsiniz. Lütfen **${remainingSec} saniye** sonra tekrar deneyin! 🎨`,
      ephemeral: true,
    });
  }

  colorCooldowns.set(userId, now);

  await interaction.deferReply({ ephemeral: true });

  const colorInfo = config.COLOR_ROLES.find((c) => c.id === roleId);
  if (!colorInfo) {
    return interaction.editReply({
      content: isEn ? '❌ Invalid color role selected!' : '❌ Geçersiz renk rolü seçildi!',
    });
  }

  const colorLabelEn = COLOR_LABELS_EN[colorInfo.label] || colorInfo.label;
  const member = interaction.member;
  const guildRole = interaction.guild.roles.cache.get(roleId);

  if (!guildRole) {
    return interaction.editReply({
      content: isEn
        ? `❌ **${colorLabelEn}** color role (\`${roleId}\`) was not found on the server!`
        : `❌ **${colorInfo.label}** renk rolü (\`${roleId}\`) sunucuda bulunamadı!`,
    });
  }

  try {
    // Eğer kullanıcıda zaten bu renk rolü varsa -> Kaldır (Toggle Off)
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'İsim rengi kullanıcı tarafından kaldırıldı.');
      return interaction.editReply({
        content: isEn
          ? `🗑️ **Name Color Removed!**\nYour ${colorInfo.emoji} <@&${roleId}> (**${colorLabelEn}**) color role has been removed. You can pick a new color in 10 seconds! ✨`
          : `🗑️ **İsim Rengi Kaldırıldı!**\nÜzerinizdeki ${colorInfo.emoji} <@&${roleId}> rengi başarıyla çıkarıldı. 10 saniye sonra yeni bir renk seçebilirsiniz! ✨`,
      });
    }

    // 2. Tek Renk Kuralı: Kullanıcıda başka bir renk rolü varsa önce onları tamamen kaldır
    const existingColorRoles = member.roles.cache
      .filter((r) => COLOR_ROLE_IDS.has(r.id) && r.id !== roleId)
      .map((r) => r.id);

    let previousRemovedText = '';
    if (existingColorRoles.length > 0) {
      await member.roles.remove(existingColorRoles, 'Yeni isim rengi seçildiği için önceki renk rolü alındı.');
      const oldMentions = existingColorRoles.map((id) => `<@&${id}>`).join(', ');
      previousRemovedText = isEn
        ? `• **Previous Color Removed:** ${oldMentions}\n`
        : `• **Alınan Önceki Renginiz:** ${oldMentions}\n`;
    }

    // 3. Seçilen yeni renk rolünü ver
    await member.roles.add(roleId, `İsim rengi seçildi: ${colorInfo.label}`);

    return interaction.editReply({
      content: isEn
        ? `🎨 **Name Color Updated Successfully!** ✨\n\n` +
          `${previousRemovedText}` +
          `• **New Color:** ${colorInfo.emoji} <@&${roleId}> (**${colorLabelEn}**)\n` +
          `• *Note: You can only have 1 color role at a time. You can change your color every 10 seconds!* 🌈`
        : `🎨 **İsim Renginiz Başarıyla Güncellendi!** ✨\n\n` +
          `${previousRemovedText}` +
          `• **Yeni Renginiz:** ${colorInfo.emoji} <@&${roleId}> (**${colorInfo.label}**)\n` +
          `• *Not: Aynı anda sadece 1 renk rolüne sahip olabilirsiniz. 10 saniye aralıklarla renginizi değiştirebilirsiniz!* 🌈`,
    });
  } catch (err) {
    console.error('[RENK ROLÜ HATASI]:', err);
    return interaction.editReply({
      content: isEn
        ? `❌ A permission error occurred while assigning the color role! (\`${err.message}\`)`
        : `❌ Renk rolü verilirken bir yetki hatası oluştu! Lütfen botun rolünün renk rollerinin üzerinde olduğundan emin olun. (\`${err.message}\`)`,
    });
  }
}

/**
 * Sunucu açılışında 1559605214690934854 kanalında panel yoksa otomatik kurar veya günceller
 */
async function ensureColorPanelMessage(guild) {
  if (!guild) return;

  const channel =
    guild.channels.cache.get(config.CHANNELS.COLOR_PANEL) ||
    (await guild.channels.fetch(config.CHANNELS.COLOR_PANEL).catch(() => null));

  if (!channel) return;

  const payload = createColorPanel();

  try {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (messages) {
      const existingBotPanel = messages.find(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.embeds.length > 0 &&
          m.embeds[0].title &&
          m.embeds[0].title.includes('İsim Rengi Seçim Paneli')
      );

      if (existingBotPanel) {
        await existingBotPanel.edit(payload);
        return existingBotPanel;
      }
    }

    const sent = await channel.send(payload);
    console.log(`[RENK PANELİ] İsim rengi paneli ${channel.id} kanalına otomatik kuruldu.`);
    return sent;
  } catch (err) {
    console.error('[RENK PANELİ OTOMATİK KURULUM HATASI]:', err.message);
  }
}

module.exports = {
  createColorPanel,
  createEnglishColorGuideEmbed,
  handleColorButton,
  ensureColorPanelMessage,
};
