const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');

// 12 adet mor çizgi emojisi
const PURPLE_DIVIDER = Array(12).fill(config.EMOJIS.PURPLE_LINE).join('');

/**
 * VS Talep Kanalı için Ana Paneli Üretir (/vs_talep_panel_kur)
 */
function createVsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Piyade Team | TSB | Kapışma (VS) Talep Sistemi')
    .setColor(config.COLORS.BLUE)
    .setDescription(
      `***\n\n` +
      `## 📜 Kapışma (VS) Kuralları & İşleyiş\n\n` +
      `Sunucumuzdaki diğer savaşçılara meydan okumak, kendini kanıtlamak ve **Top 10 Sıralaması**'nda zirveye oynamak için aşağıdaki kurallara uyunuz:\n\n` +
      `> **1️⃣ Adım:** Aşağıda yer alan **"⚔️ VS Talep Oluştur"** butonuna tıklayın.\n` +
      `> \n` +
      `> **2️⃣ Adım:** Açılan menüden kapışmak istediğiniz **Rakibinizi** seçin.\n` +
      `> \n` +
      `> **3️⃣ Adım:** Sistem size ve rakibinize özel gizli bir VS kanalı açacaktır.\n` +
      `> \n` +
      `> **4️⃣ Adım:** Maçınızı tamamladıktan sonra maçın **Video / Ekran Kaydını (Kanıt)** odaya yükleyin.\n` +
      `> \n` +
      `> **5️⃣ Adım:** <@&${config.ROLES.VS_STAFF}> yetkililerimiz kanıtları inceleyerek kazananı ilan edecektir!\n\n` +
      `### ⚠️ Önemli Kurallar\n` +
      `• **48 Saat Kuralı:** Açılan her VS talebi en geç **48 saat (2 gün)** içinde sonuçlandırılmalıdır. Aksi halde talep otomatik iptal edilir.\n` +
      `• **Kanıt Zorunluluğu:** Odaya video kaydı veya geçerli kanıt atılmadan sonuç onaylanmaz.\n` +
      `• **Tek Talep Sınırı:** Aynı anda yalnızca 1 açık VS talebiniz bulunabilir.\n` +
      `• **Hile & Kural İhlali:** TSB kurallarına aykırı hareket eden veya hile kullananlar diskalifiye edilir.\n\n` +
      `***`
    )
    .setFooter({
      text: `⚔️ Piyade Team VS Sistemi • Hakem: Kapışma Talep Yetkilisi`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_vs_talep_olustur')
      .setLabel('⚔️ VS Talep Oluştur')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

/**
 * VS Odası Açıldığında Kanalın İçine Gönderilen ve Sabitlenen (Pin) Mesaj
 */
function createVsRoomMessage(challengerMember, opponentMember) {
  const challengerName = challengerMember.displayName || challengerMember.user.username;
  const opponentName = opponentMember.displayName || opponentMember.user.username;

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Kapışma (VS) Başlatıldı!')
    .setColor(config.COLORS.BLUE)
    .setDescription(
      `Meydan okuma başarıyla oluşturuldu! Her iki oyuncuya da başarılar dileriz.\n\n` +
      `***\n\n` +
      `• **Meydan Okuyan:** <@${challengerMember.id}> (\`${challengerName}\`)\n` +
      `• **Rakip (Mağdur):** <@${opponentMember.id}> (\`${opponentName}\`)\n` +
      `• **Hakem Ekibi:** <@&${config.ROLES.VS_STAFF}>\n\n` +
      `⏳ **Süre Sınırı:** Bu odanın geçerlilik süresi **48 saattir**.\n` +
      `📹 **Kanıt Bildirimi:** Maç tamamlandığında kazanan taraf video kaydını bu odaya göndermelidir.\n\n` +
      `***`
    )
    .setFooter({
      text: 'Sonuç sadece Kapışma Talep Yetkilisi tarafından belirlenebilir.',
    })
    .setTimestamp();

  // Butonlar: [Açan Kazandı], [Rakip Kazandı], [Talep İptal Edildi]
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_vs_win_${challengerMember.id}`)
      .setLabel(`🟢 ${challengerName.slice(0, 20)} Kazandı`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`btn_vs_win_${opponentMember.id}`)
      .setLabel(`🔵 ${opponentName.slice(0, 20)} Kazandı`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_vs_cancel')
      .setLabel('🔴 Talep İptal Edildi')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    content: `<@${challengerMember.id}> ⚔️ <@${opponentMember.id}> | Yetkili: <@&${config.ROLES.VS_STAFF}>`,
    embeds: [embed],
    components: [row],
  };
}

/**
 * VS Sonuç Kanalına Gönderilecek Duyuru Kartı
 */
function createVsResultAnnouncement(winnerId, loserId, totalKills) {
  const embed = new EmbedBuilder()
    .setTitle(`${config.EMOJIS.TROPHY} VS Sonucu`)
    .setColor(config.COLORS.SUCCESS)
    .setDescription(
      `* **Kazanan:** <@${winnerId}> ${config.EMOJIS.WINNER_ADMIN}\n` +
      `* **Kaybeden:** <@${loserId}> ${config.EMOJIS.COFFIN}\n\n` +
      `${PURPLE_DIVIDER}\n\n` +
      `* ${config.EMOJIS.SKULL} **Toplam Kill:** \`${totalKills}\` Kill`
    )
    .setFooter({
      text: `Piyade Team | Resmi VS Sonucu`,
    })
    .setTimestamp();

  return {
    content: `<@${winnerId}> ⚔️ <@${loserId}>`,
    embeds: [embed],
  };
}

/**
 * Top 10 Sıralama Tablosu Embed Kartı
 */
function createTop10Embed(top10List) {
  const rankEmojis = [
    config.EMOJIS.MEDAL_1, // 1. Sıra
    config.EMOJIS.MEDAL_2, // 2. Sıra
    config.EMOJIS.MEDAL_3, // 3. Sıra
    config.EMOJIS.RANK_4,  // 4. Sıra
    config.EMOJIS.RANK_5,  // 5. Sıra
    config.EMOJIS.RANK_6,  // 6. Sıra
    config.EMOJIS.RANK_7,  // 7. Sıra
    config.EMOJIS.RANK_8,  // 8. Sıra
    config.EMOJIS.RANK_9,  // 9. Sıra
    config.EMOJIS.RANK_10, // 10. Sıra
  ];

  let listContent = '';

  if (!top10List || top10List.length === 0) {
    listContent = `*Henüz kayıtlı bir kapışma sonucu bulunmamaktadır.*`;
  } else {
    top10List.forEach((entry, index) => {
      const emoji = rankEmojis[index] || `**${index + 1}.**`;
      const isLast = index === top10List.length - 1;
      const golemEmoji = isLast ? ` ${config.EMOJIS.GOLEM}` : '';

      listContent += `${emoji} [ ${index + 1}. Sıra ] <@${entry.userId}> - **${entry.kills}** Kill${golemEmoji}\n`;

      // 3. Sıradan sonra bölme çizgisi koy
      if (index === 2 && top10List.length > 3) {
        listContent += `${PURPLE_DIVIDER}\n`;
      }
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${config.EMOJIS.KING} Piyade Team | TSB | Top 10 ${config.EMOJIS.KING}`)
    .setColor(config.COLORS.GOLD_ORANGE) // Sarı ve turuncunun karışımı
    .setDescription(
      `\n` +
      `${listContent}\n` +
      `${PURPLE_DIVIDER}\n` +
      `-## ${config.EMOJIS.MODERATOR} Piyade Team | Top 10 Listesi`
    )
    .setFooter({
      text: `Piyade Team | Otomatik Güncellenen Sıralama • ${new Date().toLocaleDateString('tr-TR')}`,
    })
    .setTimestamp();

  return {
    embeds: [embed],
  };
}

/**
 * Top 10 Kanalındaki Mesajı Günceller veya Yoksa Oluşturur
 */
async function updateTop10Message(guild) {
  if (!guild) return;

  const top10Channel = guild.channels.cache.get(config.CHANNELS.TOP10);
  if (!top10Channel) {
    console.warn(`[TOP 10] Kanal (${config.CHANNELS.TOP10}) bulunamadı!`);
    return;
  }

  const top10List = database.getTop10();
  const payload = createTop10Embed(top10List);

  const existingMessageId = database.getTop10MessageId();

  if (existingMessageId) {
    try {
      const message = await top10Channel.messages.fetch(existingMessageId).catch(() => null);
      if (message) {
        await message.edit(payload);
        console.log('[TOP 10] Sıralama tablosu başarıyla güncellendi.');
        return;
      }
    } catch (err) {
      console.warn('[TOP 10] Eski mesaj güncellenemedi, yeni mesaj gönderilecek:', err.message);
    }
  }

  // Yeni mesaj gönder ve ID'yi kaydet
  try {
    const newMessage = await top10Channel.send(payload);
    database.setTop10MessageId(newMessage.id);
    console.log(`[TOP 10] Yeni sıralama tablosu oluşturuldu (ID: ${newMessage.id}).`);
  } catch (err) {
    console.error('[TOP 10] Mesaj gönderilirken hata:', err.message);
  }
}

/**
 * Süresi dolan veya 5 saat kalan VS kanallarını denetleyen döngü fonksiyonu
 */
async function checkVsDeadlines(client) {
  try {
    const activeVsList = database.getAllActiveVs();
    if (!activeVsList || activeVsList.length === 0) return;

    const now = Date.now();
    const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    const FORTY_THREE_HOURS_MS = 43 * 60 * 60 * 1000;

    for (const vs of activeVsList) {
      const elapsed = now - vs.createdAt;
      const channel = await client.channels.fetch(vs.channelId).catch(() => null);

      if (!channel) {
        // Kanal zaten manuel silinmişse veritabanından temizle
        database.removeActiveVs(vs.channelId);
        continue;
      }

      // 1. Durum: 48 Saat Doldu (Zaman Aşımı / İptal)
      if (elapsed >= FORTY_EIGHT_HOURS_MS) {
        try {
          await channel.send({
            content: `⏰ **Süre doldu!** Bu VS talebi 2 gün (48 saat) içinde sonuçlandırılmadığı için otomatik olarak iptal ediliyor. Oda 5 saniye içinde silinecektir.`,
          });
        } catch (e) {}

        database.removeActiveVs(vs.channelId);

        setTimeout(async () => {
          try {
            await channel.delete('VS süresi 48 saati aştı (Zaman aşımı)');
            console.log(`[VS SÜRE SİLME] ${vs.channelId} kanalı zaman aşımı nedeniyle silindi.`);
          } catch (delErr) {}
        }, 5000);

        continue;
      }

      // 2. Durum: Son 5 Saat Uyarısı (43. saatten sonra ve henüz uyarılmamışsa)
      if (elapsed >= FORTY_THREE_HOURS_MS && !vs.warned5Hours) {
        try {
          await channel.send({
            content: `⚠️ <@${vs.challengerId}> <@${vs.opponentId}> <@&${config.ROLES.VS_STAFF}>\n> **Dikkat!** Bu VS talebinin kapanmasına **5 saat** kaldı! Lütfen sonucu belirleyin, aksi takdirde talep otomatik iptal edilecektir.`,
          });
          vs.warned5Hours = true;
          database.setActiveVs(vs.channelId, vs);
          console.log(`[VS UYARI] ${vs.channelId} kanalına son 5 saat uyarısı gönderildi.`);
        } catch (warnErr) {
          console.warn('[VS UYARI HATASI]:', warnErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[VS DEADLINE ERROR]:', err);
  }
}

/**
 * Kanal adını Discord kurallarına uygun hale getirir
 */
function sanitizeChannelName(name) {
  const trMap = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'I': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u',
  };

  let clean = name.replace(/[çÇğĞıIİöÖşŞüÜ]/g, (match) => trMap[match] || match);
  clean = clean.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean.slice(0, 30) || 'oyuncu';
}

module.exports = {
  createVsPanel,
  createVsRoomMessage,
  createVsResultAnnouncement,
  createTop10Embed,
  updateTop10Message,
  checkVsDeadlines,
  sanitizeChannelName,
};
