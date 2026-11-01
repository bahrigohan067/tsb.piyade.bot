const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');
const robloxService = require('../services/roblox');

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
      `Aşağıda bulunan **"🚨 ACİL YARDIM ÇAĞIR"** butonuna basarak tüm Piyade Team savaşçılarına acil durum bildirimi ve DM mesajı gönderebilirsiniz!\n\n` +
      `***\n\n` +
      `## 📋 Nasıl Kullanılır?\n` +
      `> **1️⃣ Adım:** Aşağıdaki kırmızı **"🚨 ACİL YARDIM ÇAĞIR"** butonuna basın.\n` +
      `> **2️⃣ Adım:** Bot anında <#${config.CHANNELS.HELP_ALERT}> kanalına bildirim atar ve aktif olan tüm üyelerin **DM kutusuna** acil çağrı mesajı gönderir.\n` +
      `> **3️⃣ Adım:** Bildirim mesajının altındaki **"🎮 Roblox Profiline Git & Sunucusuna Katıl"** butonuna basan üyeler doğrudan profilinize giderek sunucunuza katılır!\n\n` +
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
 * Acil Yardım Durumu ve Aktiflik İstatistiklerini Döndürür
 */
async function getHelpStatus(guild, userId = null) {
  const presenceStats = await getRolePresenceStats(guild);
  let cooldownInfo = { active: false, remainingSeconds: 0, readyAt: null };

  if (userId) {
    const lastUsed = helpCooldowns.get(String(userId));
    const COOLDOWN_MS = 5 * 60 * 1000;
    const now = Date.now();
    if (lastUsed && now - lastUsed < COOLDOWN_MS) {
      const remainingMs = lastUsed + COOLDOWN_MS - now;
      cooldownInfo = {
        active: true,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        readyAt: Math.floor((lastUsed + COOLDOWN_MS) / 1000),
      };
    }
  }

  return {
    activeTotal: presenceStats ? presenceStats.activeTotal : 0,
    totalRegistered: presenceStats ? presenceStats.total : 0,
    onlineCount: presenceStats ? presenceStats.onlineCount : 0,
    idleCount: presenceStats ? presenceStats.idleCount : 0,
    dndCount: presenceStats ? presenceStats.dndCount : 0,
    offlineCount: presenceStats ? presenceStats.offlineCount : 0,
    cooldown: cooldownInfo,
  };
}

/**
 * Acil Yardım Çağrısını Gerçekleştiren Çekirdek Fonksiyon (Discord & Web API ortak)
 */
async function triggerHelpCall({ guild, member, user, source = 'discord' }) {
  const targetMember = member;
  const targetUser = user || member.user;
  const userId = targetUser.id;
  const now = Date.now();
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 Dakika

  // 1. Cooldown Kontrolü (5 Dakika)
  const lastUsed = helpCooldowns.get(userId);
  if (lastUsed && now - lastUsed < COOLDOWN_MS) {
    const readyAt = Math.floor((lastUsed + COOLDOWN_MS) / 1000);
    const remainingSeconds = Math.ceil((lastUsed + COOLDOWN_MS - now) / 1000);
    return {
      success: false,
      cooldown: true,
      remainingSeconds,
      readyAt,
      message: `Çok sık yardım çağrısı yapamazsınız. Yeniden çağrı yapabilmek için lütfen bekleyin (${remainingSeconds} saniye).`,
    };
  }

  // 2. Yardım Bildirim Kanalını Kontrol Et
  const alertChannel = guild.channels.cache.get(config.CHANNELS.HELP_ALERT);
  if (!alertChannel) {
    return {
      success: false,
      message: 'Yardım bildirim kanalı bulunamadı! Lütfen sunucu ayarlarını kontrol ediniz.',
    };
  }

  // Cooldown kaydet
  helpCooldowns.set(userId, now);

  // Kullanıcının Roblox bilgilerini veritabanından (veya sunucu takma adından) bul
  let reg = database.getRegistrationByDiscordId(userId);
  let robloxProfileUrl = null;
  let robloxInfo = '`Profil Kayıtlı Değil`';

  if (reg && reg.robloxId) {
    robloxProfileUrl = `https://www.roblox.com/users/${reg.robloxId}/profile`;
    robloxInfo = `[${reg.robloxUsername} (@${reg.realName || ''})](${robloxProfileUrl})`;
  } else {
    // Veritabanında yoksa sunucu takma adından ("Gerçek Ad | RobloxNick") çözümlemeyi dene
    const displayName = targetMember.displayName || targetUser.username;
    const parts = displayName.split('|').map((s) => s.trim());
    const possibleRobloxNick = parts.length > 1 ? parts[parts.length - 1] : displayName;

    const resolved = await robloxService.resolveUser(possibleRobloxNick).catch(() => null);
    if (resolved && resolved.success && resolved.user) {
      robloxProfileUrl = `https://www.roblox.com/users/${resolved.user.id}/profile`;
      robloxInfo = `[${resolved.user.name} (@${resolved.user.displayName})](${robloxProfileUrl})`;
    } else {
      robloxProfileUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(possibleRobloxNick)}`;
      robloxInfo = `[${possibleRobloxNick}](${robloxProfileUrl})`;
    }
  }

  const alertEmbed = new EmbedBuilder()
    .setTitle('🚨 ACİL DESTEK / TAKVİYE ÇAĞRISI!')
    .setColor(0xED4245)
    .setDescription(
      `📢 <@&${config.ROLES.REGISTERED_CHECK}> **DİKKAT! BİR EKİP ÜYEMİZ OYUNDA DESTEK BEKLİYOR!**\n\n` +
      `***\n\n` +
      `👤 **Yardım İsteyen Savaşçı:** <@${userId}> (\`${targetMember.displayName}\`)\n` +
      `🎮 **Roblox Profili:** ${robloxInfo}\n` +
      `⚔️ **Durum:** TSB oyununda acil takviye ihtiyacı (1v3, teamer baskısı veya haksız kapışma)!\n` +
      `⏰ **Çağrı Zamanı:** <t:${Math.floor(now / 1000)}:F> (<t:${Math.floor(now / 1000)}:R>)\n` +
      (source === 'site' ? `🌐 **Kaynak:** \`Web Sitesi Paneli\`\n\n` : `\n`) +
      `***\n\n` +
      `> ⚡ **Aktif olan tüm üyeler:** Lütfen derhal aşağıdaki butona tıklayarak arkadaşımızın profiline gidin ve bulunduğu sunucuya girerek desteğe katılın!`
    )
    .setFooter({
      text: `Piyade Team • Acil Müdahale & Destek Sistemi${source === 'site' ? ' • Web Paneli' : ''}`,
    })
    .setTimestamp();

  // Bildirimin altındaki doğrudan Roblox Profiline götüren buton
  const profileButtonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🎮 Roblox Profiline Git & Sunucusuna Katıl')
      .setStyle(ButtonStyle.Link)
      .setURL(robloxProfileUrl)
  );

  try {
    // 1) Bildirim kanalına mesajı ve profil butonunu gönder
    const sentAlertMsg = await alertChannel.send({
      content: `<@&${config.ROLES.REGISTERED_CHECK}> 🚨 **ACİL TAKVİYE ÇAĞRISI!**`,
      embeds: [alertEmbed],
      components: [profileButtonRow],
    });

    // 2) Aktif olan (<@&1559604702143062016> rolündeki online/idle/dnd) kullanıcılara DM gönder
    const presenceStats = await getRolePresenceStats(guild);
    let dmTargets = [];

    if (presenceStats && presenceStats.activeMembers.length > 0) {
      dmTargets = presenceStats.activeMembers
        .map((item) => item.member)
        .filter((m) => m.id !== userId && !m.user.bot);
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('🚨 PİYADE TEAM | ACİL TAKVİYE ÇAĞRISI!')
      .setColor(0xED4245)
      .setDescription(
        `⚡ **Sunucumuzda bir ekip arkadaşımız şu an oyunda acil yardıma ihtiyaç duyuyor!**\n\n` +
        `👤 **Yardım İsteyen Savaşçı:** <@${userId}> (\`${targetMember.displayName}\`)\n` +
        `🎮 **Roblox Profili:** ${robloxInfo}\n` +
        `📢 **Bildirim Kanalı:** <#${config.CHANNELS.HELP_ALERT}>\n` +
        `⏰ **Çağrı Zamanı:** <t:${Math.floor(now / 1000)}:R>\n\n` +
        `> 👇 **Hemen desteğe katılmak için aşağıdaki butona basarak oyuncunun Roblox profiline gidebilir ve sunucusuna katılabilirsin!**`
      )
      .setFooter({
        text: 'Piyade Team • Acil Müdahale & DM Bildirim Sistemi',
      })
      .setTimestamp();

    const dmButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🎮 Roblox Profiline Git & Sunucusuna Katıl')
        .setStyle(ButtonStyle.Link)
        .setURL(robloxProfileUrl),
      new ButtonBuilder()
        .setLabel('📢 Bildirim Mesajına Git')
        .setStyle(ButtonStyle.Link)
        .setURL(sentAlertMsg.url)
    );

    // Aktif üyelere paralel olarak DM gönder
    let dmSuccessCount = 0;
    if (dmTargets.length > 0) {
      const dmResults = await Promise.allSettled(
        dmTargets.map((m) =>
          m.user.send({
            content: `🚨 **ACİL TAKVİYE ÇAĞRISI!** <@${userId}> oyunda destek bekliyor!`,
            embeds: [dmEmbed],
            components: [dmButtonRow],
          })
        )
      );
      dmSuccessCount = dmResults.filter((r) => r.status === 'fulfilled').length;
    }

    return {
      success: true,
      message: 'Acil yardım çağrınız başarıyla gönderildi!',
      dmCount: dmSuccessCount,
      alertMessageUrl: sentAlertMsg.url,
      robloxProfileUrl,
      readyAt: Math.floor((now + COOLDOWN_MS) / 1000),
    };
  } catch (err) {
    console.error('[YARDIM ÇAĞRISI GÖNDERME HATASI]:', err);
    return {
      success: false,
      message: `Yardım çağrısı gönderilirken bir hata oluştu: ${err.message}`,
    };
  }
}

/**
 * Kullanıcı "🚨 ACİL YARDIM ÇAĞIR" Butonuna Bastığında Çalışan Fonksiyon
 */
async function handleHelpRequest(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const result = await triggerHelpCall({
    guild: interaction.guild,
    member: interaction.member,
    user: interaction.user,
    source: 'discord',
  });

  if (!result.success) {
    if (result.cooldown) {
      return interaction.editReply({
        content: `⏳ **Bekleme Süresi Aktif!**\nÇok sık yardım çağrısı yapamazsınız. Yeniden çağrı yapabilmek için lütfen bekleyin: <t:${result.readyAt}:R>`,
      });
    }
    return interaction.editReply({
      content: `❌ ${result.message}`,
    });
  }

  return interaction.editReply({
    content:
      `✅ **Acil yardım çağrınız başarıyla gönderildi!**\n` +
      `• 📢 Bildirim <#${config.CHANNELS.HELP_ALERT}> kanalına **Roblox Profil Butonu** ile birlikte iletildi.\n` +
      `• 📩 Şu anda aktif olan **${result.dmCount}** ekip üyemize özel **DM bildirimi** gönderildi.\n` +
      `*(Bir sonraki yardım çağrısını 5 dakika sonra yapabilirsiniz.)*`,
  });
}

module.exports = {
  getRolePresenceStats,
  getHelpStatus,
  triggerHelpCall,
  createHelpPanelPayload,
  updateHelpPanelMessage,
  handleHelpRequest,
  helpCooldowns,
};
