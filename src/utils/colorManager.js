const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');

// 12 adet mor çizgi emojisi
const PURPLE_DIVIDER = Array(12).fill(config.EMOJIS.PURPLE_LINE).join('');

// Tüm renk rolü ID'leri kümesi
const COLOR_ROLE_IDS = new Set(config.COLOR_ROLES.map((c) => c.id));

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
      `## 🎨 Mevcut İsim Renklerimiz (Önizleme)\n\n` +
      `> 🖤 <@&1559899395233808444> — **Siyah** *(Asil & Karanlık Tarz)*\n` +
      `> ❤️ <@&1559926857472675910> — **Kırmızı** *(Ateşli & Keskin Tarz)*\n` +
      `> 💛 <@&1559927000183873597> — **Sarı** *(Parlak & Enerjik Tarz)*\n` +
      `> 💙 <@&1559926616535339010> — **Mavi** *(Soğukkanlı & Okyanus Tarzı)*\n` +
      `> 💚 <@&1559926912338362379> — **Yeşil** *(Canlı & Zümrüt Tarzı)*\n` +
      `> 🩷 <@&1559926687645311017> — **Pembe** *(Neon & Gösterişli Tarz)*\n\n` +
      `${PURPLE_DIVIDER}\n` +
      `-# ${config.EMOJIS.MODERATOR} Piyade Team | TSB • Kişiselleştirilebilir İsim Rengi Sistemi ✨`
    )
    .setFooter({
      text: '🎨 Piyade Team • Sadece 1 renk seçilebilir • Bekleme süresi: 10 Saniye',
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

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

/**
 * Kullanıcı Bir Renk Butonuna Bastığında Çalışan Fonksiyon
 */
async function handleColorButton(interaction, roleId) {
  const userId = interaction.user.id;
  const now = Date.now();

  // 1. 10 Saniye Bekleme Süresi (Cooldown) Kontrolü
  const lastUsed = colorCooldowns.get(userId);
  if (lastUsed && now - lastUsed < COLOR_COOLDOWN_MS) {
    const remainingSec = Math.ceil((COLOR_COOLDOWN_MS - (now - lastUsed)) / 1000);
    return interaction.reply({
      content: `⏳ **Çok Hızlı Tıklıyorsunuz!**\nRenk panelini **10 saniye** aralıklarla kullanabilirsiniz. Lütfen **${remainingSec} saniye** sonra tekrar deneyin! 🎨`,
      ephemeral: true,
    });
  }

  colorCooldowns.set(userId, now);

  await interaction.deferReply({ ephemeral: true });

  const colorInfo = config.COLOR_ROLES.find((c) => c.id === roleId);
  if (!colorInfo) {
    return interaction.editReply({
      content: '❌ Geçersiz renk rolü seçildi!',
    });
  }

  const member = interaction.member;
  const guildRole = interaction.guild.roles.cache.get(roleId);

  if (!guildRole) {
    return interaction.editReply({
      content: `❌ **${colorInfo.label}** renk rolü (\`${roleId}\`) sunucuda bulunamadı!`,
    });
  }

  try {
    // Eğer kullanıcıda zaten bu renk rolü varsa -> Kaldır (Toggle Off)
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'İsim rengi kullanıcı tarafından kaldırıldı.');
      return interaction.editReply({
        content: `🗑️ **İsim Rengi Kaldırıldı!**\nÜzerinizdeki ${colorInfo.emoji} <@&${roleId}> rengi başarıyla çıkarıldı. 10 saniye sonra yeni bir renk seçebilirsiniz! ✨`,
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
      previousRemovedText = `• **Alınan Önceki Renginiz:** ${oldMentions}\n`;
    }

    // 3. Seçilen yeni renk rolünü ver
    await member.roles.add(roleId, `İsim rengi seçildi: ${colorInfo.label}`);

    return interaction.editReply({
      content:
        `🎨 **İsim Renginiz Başarıyla Güncellendi!** ✨\n\n` +
        `${previousRemovedText}` +
        `• **Yeni Renginiz:** ${colorInfo.emoji} <@&${roleId}> (**${colorInfo.label}**)\n` +
        `• *Not: Aynı anda sadece 1 renk rolüne sahip olabilirsiniz. 10 saniye aralıklarla renginizi değiştirebilirsiniz!* 🌈`,
    });
  } catch (err) {
    console.error('[RENK ROLÜ HATASI]:', err);
    return interaction.editReply({
      content: `❌ Renk rolü verilirken bir yetki hatası oluştu! Lütfen botun rolünün renk rollerinin üzerinde olduğundan emin olun. (\`${err.message}\`)`,
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
  handleColorButton,
  ensureColorPanelMessage,
};
