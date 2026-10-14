const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');

// 5 dakikalık bekleme süresi (Cooldown: Map<userId, timestamp>)
const helpCooldowns = new Map();

/**
 * <@&1559604702143062016> Rolüne Sahip Üyelerin Discord Aktifliklerini Sorgular
 */
async function getRolePresenceStats(guild) {
  if (!guild) return null;

  try {
    const roleId = config.ROLES.REGISTERED_CHECK; // 1559604702143062016
    const role = guild.roles.cache.get(roleId);
    if (!role) return null;

    // Üyeleri fetch et (presence verilerinin gelmesi için)
    await guild.members.fetch().catch(() => {});

    const members = role.members;

    let onlineCount = 0;
    let idleCount = 0;
    let dndCount = 0;
    let offlineCount = 0;

    const activeMembers = [];

    members.forEach((member) => {
      if (member.user.bot) return;

      const status = member.presence?.status || 'offline';

      if (status === 'online') {
        onlineCount++;
        activeMembers.push({ member, icon: '🟢', status });
      } else if (status === 'idle') {
        idleCount++;
        activeMembers.push({ member, icon: '🌙', status });
      } else if (status === 'dnd') {
        dndCount++;
        activeMembers.push({ member, icon: '⛔', status });
      } else {
        offlineCount++;
      }
    });

    const activeTotal = onlineCount + idleCount + dndCount;

    return {
      total: members.filter((m) => !m.user.bot).size,
      activeTotal,
      onlineCount,
      idleCount,
      dndCount,
      offlineCount,
      activeMembers,
    };
  } catch (err) {
    console.error('[PRESENCE STATS HATASI]:', err.message);
    return null;
  }
}

/**
 * Acil Yardım Paneli Embed ve Butonunu Üretir (Kırmızı Tema)
 */
async function createHelpPanelPayload(guild) {
  const stats = await getRolePresenceStats(guild);

  let presenceSection = '';
  if (stats) {
    // İlk 15 aktif üyeyi listele
    const activeList = stats.activeMembers.slice(0, 15).map((a) => {
      return `${a.icon} <@${a.member.id}>`;
    });

    const activeListStr =
      activeList.length > 0
        ? activeList.join(', ') + (stats.activeMembers.length > 15 ? ` ve +${stats.activeMembers.length - 15} kişi daha...` : '')
        : '*Şu anda çevrim içi üye bulunmuyor.*';

    presenceSection =
      `## 👥 Discord Üye Aktiflik Durumu\n` +
      `*(Her 30 saniyede bir otomatik güncellenir)*\n\n` +
      `🟢 **Çevrim içi:** \`${stats.onlineCount}\` kişi\n` +
      `🌙 **Boşta:** \`${stats.idleCount}\` kişi\n` +
      `⛔ **Rahatsız Etmeyin:** \`${stats.dndCount}\` kişi\n` +
      `⚫ **Çevrim dışı:** \`${stats.offlineCount}\` kişi\n\n` +
      `🔥 **Toplam Aktif Savaşçı:** \`${stats.activeTotal} / ${stats.total}\`\n\n` +
      `### ⚡ Anlık Aktif Ekip Üyeleri:\n` +
      `> ${activeListStr}\n\n`;
  } else {
    presenceSection = `*Aktiflik durumu yükleniyor...*\n\n`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🚨 Piyade Team | TSB | Acil Takviye & Yardım Çağrısı')
    .setColor(0xED4245) // Kırmızı Alarm Rengi
    .setDescription(
      `***\n\n` +
      `## 🆘 Acil Takviye Çağrısı Nedir?\n\n` +
      `The Strongest Battlegrounds (TSB) oyununda bir kapışma esnasında:\n` +
      `• Çoklu kişiye karşı (**1v2, 1v3, 1v4 Teamerlar**) tek kaldıysanız,\n` +
      `• Sunucuda ezilme, hedef alınma veya haksız durumlara maruz kalıyorsanız,\n` +
      `• Ekipçe baskın veya acil arkadaş desteğine ihtiyacınız varsa!\n\n` +
      `Aşağıda bulunan **"🚨 ACİL YARDIM ÇAĞIR"** butonuna basarak tüm Piyade Team savaşçılarına acil durum bildirimi gönderebilirsiniz!\n\n` +
      `***\n\n` +
      `## 📋 Nasıl Kullanılır?\n` +
      `> **1️⃣ Adım:** Aşağıdaki kırmızı **"🚨 ACİL YARDIM ÇAĞIR"** butonuna basın.\n` +
      `> **2️⃣ Adım:** Bot anında <#${config.CHANNELS.HELP_ALERT}> kanalına <@&${config.ROLES.REGISTERED_CHECK}> rolünü etiketleyerek bildirim atar.\n` +
      `> **3️⃣ Adım:** Açılan çağrı kanalına Roblox sunucu linkinizi veya profilinizi atarak ekibinize katılmalarını sağlayın!\n\n` +
      `***\n\n` +
      `${presenceSection}` +
      `***\n\n` +
      `### ⚠️ Önemli Kurallar\n` +
      `• **5 Dakika Bekleme Süresi:** Butona basan üye **5 dakika** boyunca tekrar çağrı yapamaz.\n` +
      `• **Trolleme Yasaktır:** Boş yere veya gereksiz yere yardım çağırmak yetkililer tarafından cezalandırılır.\n\n` +
      `***`
    )
    .setFooter({
      text: `🚨 Piyade Team Acil Müdahale Sistemi • Kırmızı Alarm • Son Güncelleme: ${new Date().toLocaleTimeString('tr-TR')}`,
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_acil_yardim')
      .setLabel('🚨 ACİL YARDIM ÇAĞIR')
      .setStyle(ButtonStyle.Danger) // Kırmızı Buton
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

/**
 * Acil Yardım Panelini 30 Saniyede Bir Güncelleyen veya Oluşturan Fonksiyon
 */
async function updateHelpPanelMessage(guild) {
  if (!guild) return;

  const panelChannel = guild.channels.cache.get(config.CHANNELS.HELP_PANEL);
  if (!panelChannel) return;

  const payload = await createHelpPanelPayload(guild);
  const existingMessageId = database.getHelpPanelMessageId();

  if (existingMessageId) {
    try {
      const message = await panelChannel.messages.fetch(existingMessageId).catch(() => null);
      if (message) {
        await message.edit(payload);
        return;
      }
    } catch (err) {
      console.warn('[YARDIM PANELİ GÜNCELLEME HATASI]:', err.message);
    }
  }

  // Mesaj yoksa veya silinmişse yeni mesaj at
  try {
    const newMessage = await panelChannel.send(payload);
    database.setHelpPanelMessageId(newMessage.id);
    console.log(`[YARDIM PANELİ] Yeni panel oluşturuldu (ID: ${newMessage.id}).`);
  } catch (err) {
    console.error('[YARDIM PANELİ GÖNDERME HATASI]:', err.message);
  }
}

/**
 * Kullanıcı "🚨 ACİL YARDIM ÇAĞIR" Butonuna Bastığında Çalışan Fonksiyon
 */
async function handleHelpRequest(interaction) {
  const userId = interaction.user.id;
  const now = Date.now();
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 Dakika

  // 1. Cooldown Kontrolü (5 Dakika)
  const lastUsed = helpCooldowns.get(userId);
  if (lastUsed && now - lastUsed < COOLDOWN_MS) {
    const readyAt = Math.floor((lastUsed + COOLDOWN_MS) / 1000);
    return interaction.reply({
      content: `⏳ **Bekleme Süresi Aktif!**\nÇok sık yardım çağrısı yapamazsınız. Yeniden çağrı yapabilmek için lütfen bekleyin: <t:${readyAt}:R>`,
      ephemeral: true,
    });
  }

  // Cooldown kaydet
  helpCooldowns.set(userId, now);

  await interaction.deferReply({ ephemeral: true });

  // 2. Yardım Çağrısını Bildirim Kanalına Gönder
  const alertChannel = interaction.guild.channels.cache.get(config.CHANNELS.HELP_ALERT);
  if (!alertChannel) {
    return interaction.editReply({
      content: '❌ Yardım bildirim kanalı bulunamadı! Lütfen yetkililere danışınız.',
    });
  }

  // Kullanıcının Roblox bilgilerini veritabanından bul
  const reg = database.getRegistrationByDiscordId(userId);
  const robloxInfo = reg
    ? `[${reg.robloxUsername} (@${reg.realName || ''})](https://www.roblox.com/users/${reg.robloxId}/profile)`
    : '`Profil Kayıtlı Değil`';

  const alertEmbed = new EmbedBuilder()
    .setTitle('🚨 ACİL DESTEK / TAKVİYE ÇAĞRISI!')
    .setColor(0xED4245)
    .setDescription(
      `📢 <@&${config.ROLES.REGISTERED_CHECK}> **DİKKAT! BİR EKİP ÜYEMİZ OYUNDA DESTEK BEKLİYOR!**\n\n` +
      `***\n\n` +
      `👤 **Yardım İsteyen Savaşçı:** <@${userId}> (\`${interaction.member.displayName}\`)\n` +
      `🎮 **Roblox Profili:** ${robloxInfo}\n` +
      `⚔️ **Durum:** TSB oyununda acil takviye ihtiyacı (1v3, teamer baskısı veya haksız kapışma)!\n` +
      `⏰ **Çağrı Zamanı:** <t:${Math.floor(now / 1000)}:F> (<t:${Math.floor(now / 1000)}:R>)\n\n` +
      `***\n\n` +
      `> ⚡ **Aktif olan tüm üyeler:** Lütfen derhal bu mesaja yanıt vererek veya arkadaşımızın sunucusuna girerek desteğe katılın!`
    )
    .setFooter({
      text: 'Piyade Team • Acil Müdahale & Destek Sistemi',
    })
    .setTimestamp();

  try {
    // Mesajın en başında rol etiketleniyor
    await alertChannel.send({
      content: `<@&${config.ROLES.REGISTERED_CHECK}> 🚨 **ACİL TAKVİYE ÇAĞRISI!**`,
      embeds: [alertEmbed],
    });

    return interaction.editReply({
      content:
        `✅ **Acil yardım çağrınız başarıyla gönderildi!**\n` +
        `Bildirim <#${config.CHANNELS.HELP_ALERT}> kanalına <@&${config.ROLES.REGISTERED_CHECK}> rolü etiketlenerek iletildi.\n` +
        `*(Bir sonraki yardım çağrısını 5 dakika sonra yapabilirsiniz.)*`,
    });
  } catch (err) {
    console.error('[YARDIM ÇAĞRISI GÖNDERME HATASI]:', err);
    return interaction.editReply({
      content: `❌ Yardım çağrısı gönderilirken bir hata oluştu: ${err.message}`,
    });
  }
}

module.exports = {
  createHelpPanelPayload,
  updateHelpPanelMessage,
  handleHelpRequest,
};
