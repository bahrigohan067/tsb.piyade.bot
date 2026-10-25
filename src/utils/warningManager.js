const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');

const LINE_DIVIDER = '────────────────────────────────────────────────────';

// ==========================================
// KURAL MADDELERİ TABLOSU (M1-M13, D1-D3, Y1-Y5)
// ==========================================
const RULES = {
  // Katılımcı Maddeleri (M1 - M13)
  M1: {
    code: 'M1',
    category: 'participant',
    description: 'Sunucumuzda küfür/hakarete başvurmak. Bununla ilgili içerik paylaşmak.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Puan',
  },
  M2: {
    code: 'M2',
    category: 'participant',
    description: 'Reklam yapmak, hesap/oyun satışı gibi ticari faaliyetlerde bulunmak (Özel mesajda dahil).',
    type: 'ban',
    points: 0,
    penaltyLabel: 'Kalıcı Yasak (Permanent Ban)',
  },
  M3: {
    code: 'M3',
    category: 'participant',
    description: 'Sunucumuzda düzenlenen etkinliklerde veya yapılacak olan kapışmalarda karşı taraf rahatsız olduğu halde kendini abartı şekilde övmek.',
    type: 'points',
    points: 1,
    penaltyLabel: '+1 Puan',
  },
  M4: {
    code: 'M4',
    category: 'participant',
    description: 'Cinsiyet fark etmeksizin taciz içeren davranışlarda bulunmak.',
    type: 'timeout',
    durationDays: 2,
    points: 0,
    penaltyLabel: '2 Gün Timeout',
  },
  M5: {
    code: 'M5',
    category: 'participant',
    description: "Kanalları amacı dışında kullanmak (Örn: #bot-komut'da sohbet etmek).",
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Puan',
  },
  M6: {
    code: 'M6',
    category: 'participant',
    description: 'Cinsel içerikli herhangi bir paylaşım (görsel, yazı, link) yapmak.',
    type: 'points',
    points: 8,
    penaltyLabel: '+8 Puan',
  },
  M7: {
    code: 'M7',
    category: 'participant',
    description: 'Bir kişiye muhattap olmak istemediği sürece ya da kasten kavga ortamı yaratmak.',
    type: 'points',
    points: 4,
    penaltyLabel: '+4 Puan',
  },
  M8: {
    code: 'M8',
    category: 'participant',
    description: 'Zorbalık yapmak, başka bir üyeyi sunucudan soğutacak davranışlarda bulunmak.',
    type: 'points',
    points: 5,
    penaltyLabel: '+5 Puan',
  },
  M9: {
    code: 'M9',
    category: 'participant',
    description: 'Yönetmenliği bilgisi dışında sunucu üyelerini kendi sunucunuza veya grubunuza davet etmek.',
    type: 'yasakli',
    points: 0,
    penaltyLabel: 'Doğrudan Yasaklı',
  },
  M10: {
    code: 'M10',
    category: 'participant',
    description: '+18, cinsel taciz, ırkçılık, cinsiyet/yaş ayrımcılığı içeren içerik paylaşmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
  },
  M11: {
    code: 'M11',
    category: 'participant',
    description: 'Irkçılık ve her türlü ayrımcılık yapmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
  },
  M12: {
    code: 'M12',
    category: 'participant',
    description: 'Sunucuda bulunan kişilerin piskolojisini etkileyecek argo, küçümseme ve dalga geçme gibi faliyetler yapmak.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Puan',
  },
  M13: {
    code: 'M13',
    category: 'participant',
    description: 'Sunucuda yapılan etkinliklerde ve kapışmalarda 3. Taraf yazılım kullanmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
  },

  // Düzen / Kanal Maddeleri (D1 - D3)
  D1: {
    code: 'D1',
    category: 'participant',
    description: 'Önemli kanallara (duyuru vb.) anlamsız, boş mesajlar atmak.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Puan',
  },
  D2: {
    code: 'D2',
    category: 'participant',
    description: 'Ses kanallarında ses panelini veya sohbet kanallarında sohbeti gereksiz yere çağırmak (spawnlamak).',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Puan',
  },
  D3: {
    code: 'D3',
    category: 'participant',
    description: 'Önemli ses kanallarında sürekli yolculuk yaparak gereksiz bildirim yağmuruna sebep olmak.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Puan',
  },

  // Yetkili Maddeleri (Y1 - Y5)
  Y1: {
    code: 'Y1',
    category: 'staff',
    description: 'Yetkisini kendi lehine kullanmak.',
    type: 'staff_strip',
    points: 0,
    penaltyLabel: 'Direkt Yetkiler Alınır',
  },
  Y2: {
    code: 'Y2',
    category: 'staff',
    description: 'Sunucudaki katılımcıyı yanlış yönlendirmek.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarı',
  },
  Y3: {
    code: 'Y3',
    category: 'staff',
    description: 'Yanlış işlem yapmak. (Örn: Yanlış uyarı vermek)',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarı',
  },
  Y4: {
    code: 'Y4',
    category: 'staff',
    description: 'Sunucuda kendini üstün görmek.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarı',
  },
  Y5: {
    code: 'Y5',
    category: 'staff',
    description: 'Kendinden üst kademeli yetkililerin yönlendirmesini dinlememek/takmamak.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarı',
  },
};

// Otomatik oluşturulacak uyarı rolleri şablonu
const WARNING_ROLE_DEFINITIONS = [
  { key: 'uyari1', name: 'Uyarı 1', color: 0xF1C40F },
  { key: 'uyari2', name: 'Uyarı 2', color: 0xF39C12 },
  { key: 'uyari3', name: 'Uyarı 3', color: 0xE67E22 },
  { key: 'uyari4', name: 'Uyarı 4', color: 0xE74C3C },
  { key: 'uyari5', name: 'Uyarı 5', color: 0xC0392B },
  { key: 'yetkiliUyari1', name: 'Yetkili Uyarı 1', color: 0xFF7675 },
  { key: 'yetkiliUyari2', name: 'Yetkili Uyarı 2', color: 0xD63031 },
  { key: 'yetkiliUyari3', name: 'Yetkili Uyarı 3', color: 0x8B0000 },
  { key: 'yasakli', name: 'Yasaklı', color: 0x2C2F33 },
];

/**
 * Yetki Kontrolü: Sadece Developer (1561777507223601353) ve Yönetmenlik (1559614111128490044)
 */
function hasWarningAuthority(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return config.ROLES.WARNING_AUTHORITIES.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Sadece Developer (1561777507223601353) Kontrolü (/uyari-panel için)
 */
function isDeveloper(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return member.roles.cache.has(config.ROLES.DEVELOPER);
}

/**
 * Hedef kullanıcının sunucuda yetkili olup olmadığını kontrol eder
 */
function isTargetStaff(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return config.ROLES.STAFF_ROLES_TO_STRIP.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Katılımcı ve Yetkili Uyarı Kademe Rollerini Sunucuda Kontrol Eder, Yoksa Otomatik Oluşturur
 */
async function ensureWarningRoles(guild) {
  if (!guild) return {};

  await guild.roles.fetch().catch(() => {});
  const savedRoles = database.getWarningRoles();
  const updatedRoles = { ...savedRoles };
  let changed = false;

  for (const def of WARNING_ROLE_DEFINITIONS) {
    let role = savedRoles[def.key] ? guild.roles.cache.get(savedRoles[def.key]) : null;

    // İsimle kontrol et
    if (!role) {
      role = guild.roles.cache.find(
        (r) => r.name.toLowerCase() === def.name.toLowerCase()
      );
    }

    // Yoksa oluştur
    if (!role) {
      try {
        role = await guild.roles.create({
          name: def.name,
          color: def.color,
          reason: 'Piyade Team | Uyarı Sistemi Otomatik Rol Kurulumu',
        });
        console.log(`[UYARI SİSTEMİ] '${def.name}' rolü otomatik oluşturuldu (ID: ${role.id}).`);
      } catch (err) {
        console.error(`[UYARI SİSTEMİ] '${def.name}' rolü oluşturulamadı:`, err.message);
      }
    }

    if (role && updatedRoles[def.key] !== role.id) {
      updatedRoles[def.key] = role.id;
      changed = true;
    }
  }

  if (changed) {
    database.setWarningRoles(updatedRoles);
  }

  return updatedRoles;
}

/**
 * Toplam puana göre Katılımcı Uyarı Kademesini (0 - 5) hesaplar
 */
function calculateTierFromPoints(points) {
  if (points >= 15) return 5;
  if (points >= 12) return 4;
  if (points >= 9) return 3;
  if (points >= 6) return 2;
  if (points >= 3) return 1;
  return 0;
}

/**
 * Madde numarasını temizler ve RULES tablosundan bulur (Örn: "m1", "M-5", "d 2", "y3")
 */
function resolveRuleCode(rawInput) {
  if (!rawInput) return null;
  const cleaned = String(rawInput)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();

  if (RULES[cleaned]) return RULES[cleaned];

  // Kullanıcının "M1 - küfür" gibi uzun yazması ihtimaline karşı başındaki kodu yakala
  const match = String(rawInput)
    .toUpperCase()
    .trim()
    .match(/^([MDY])\s*[-.]?\s*(\d{1,2})/);
  if (match) {
    const code = `${match[1]}${match[2]}`;
    if (RULES[code]) return RULES[code];
  }

  return null;
}

/**
 * 1563923294602666125 Kanalına Kurulacak Sabit Uyarı Panelini Üretir
 */
function createWarningPanel() {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Sunucu Uyarı Paneli')
    .setColor(config.COLORS.DANGER)
    .setDescription(
      `${LINE_DIVIDER}\n\n` +
      `### 📋 Yapmanız Gerekenler:\n` +
      `→ Uyarı alacak kişiyi seç.\n` +
      `→ Karşına çıkan madde numarasını doldur.\n` +
      `→ Kanıt görseli varsa yükle.\n\n` +
      `${LINE_DIVIDER}\n\n` +
      `### 📌 Katılımcı Maddeleri: \`M1–M13\`, \`D1–D3\`\n` +
      `> • **M1:** Küfür/hakaret ve içerik paylaşımı *(\`+2 Puan\`)*\n` +
      `> • **M2:** Reklam, hesap/oyun satışı ticari faaliyet *(\`Kalıcı Ban\`)*\n` +
      `> • **M3:** Rakip rahatsız olduğu halde abartı övünmek *(\`+1 Puan\`)*\n` +
      `> • **M4:** Taciz içeren davranışlar *(\`2 Gün Timeout\`)*\n` +
      `> • **M5:** Kanalları amacı dışında kullanmak *(\`+3 Puan\`)*\n` +
      `> • **M6:** Cinsel içerikli paylaşım yapmak *(\`+8 Puan\`)*\n` +
      `> • **M7:** İstenmediği halde muhatap olmak / kavga çıkarmak *(\`+4 Puan\`)*\n` +
      `> • **M8:** Zorbalık ve üyeyi sunucudan soğutmak *(\`+5 Puan\`)*\n` +
      `> • **M9:** İzinsiz sunucu/grup daveti yapmak *(\`Doğrudan Yasaklı\`)*\n` +
      `> • **M10:** +18, cinsel taciz, ırkçılık, ayrımcılık içeriği *(\`1 Gün Timeout\`)*\n` +
      `> • **M11:** Irkçılık ve her türlü ayrımcılık yapmak *(\`1 Gün Timeout\`)*\n` +
      `> • **M12:** Psikoloji bozucu argo, küçümseme ve dalga geçme *(\`+2 Puan\`)*\n` +
      `> • **M13:** Etkinlik ve kapışmalarda 3. taraf yazılım (hile) *(\`1 Gün Timeout\`)*\n` +
      `> • **D1:** Önemli kanallara anlamsız/boş mesaj atmak *(\`+3 Puan\`)*\n` +
      `> • **D2:** Ses panelini veya sohbeti gereksiz spamlamak *(\`+3 Puan\`)*\n` +
      `> • **D3:** Ses kanallarında sürekli gir-çık bildirim yağmuru *(\`+3 Puan\`)*\n\n` +
      `### 🛡️ Yetkili Maddeleri: \`Y1–Y5\`\n` +
      `> • **Y1:** Yetkisini kendi lehine kullanmak *(\`Direkt Yetkiler Alınır\`)*\n` +
      `> • **Y2:** Sunucudaki katılımcıyı yanlış yönlendirmek *(\`+1 Yetkili Uyarı\`)*\n` +
      `> • **Y3:** Yanlış işlem yapmak (Örn: Yanlış uyarı vermek) *(\`+1 Yetkili Uyarı\`)*\n` +
      `> • **Y4:** Sunucuda kendini üstün görmek *(\`+1 Yetkili Uyarı\`)*\n` +
      `> • **Y5:** Üst kademe yetkililerin yönlendirmesini dinlememek *(\`+1 Yetkili Uyarı\`)*\n\n` +
      `${LINE_DIVIDER}`
    )
    .setFooter({
      text: 'Piyade Team | TSB • Sunucu Disiplin & Uyarı Sistemi',
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_warn_verbal')
      .setLabel('🗣️ Sözlü Uyarı Ver')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_warn_official')
      .setLabel('⚠️ Uyarı Ver')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

/**
 * Uyarı Bildirimi Mesaj Şemasını (Log Embed) Üretir (1563923439121604720 Kanalı İçin)
 */
function buildWarningLogPayload(guild, record, memberRolesText) {
  let embedColor = config.COLORS.DANGER; // Katılımcı: Kırmızı
  if (record.type === 'verbal') {
    embedColor = config.COLORS.WARNING_ORANGE; // Sözlü: Turuncu
  } else if (record.type === 'staff') {
    embedColor = config.COLORS.DARK_RED; // Yetkili: Koyu Kırmızı
  }

  const proofFieldText = record.proofUrl
    ? `[Görseli Görüntüle](${record.proofUrl})`
    : 'Eklenmedi';

  const description =
    `👤 **Taraflar**\n` +
    `**Ceza Yiyen Kişi:** <@${record.userId}>\n` +
    `**Yetkili:** <@${record.staffId}>\n\n` +
    `${LINE_DIVIDER}\n\n` +
    `📌 **Kayıt Özet**\n` +
    `**Uyarı ID:** \`#${record.id}\`\n` +
    `**Yetkili:** <@${record.staffId}>\n` +
    `**Ceza Yiyen Kişi:** <@${record.userId}>\n` +
    `**Uyarı Bitiş Tarihi:** ${record.expiresAtText}\n` +
    `**Toplam Uyarı:** ${record.totalWarnings}\n\n` +
    `${LINE_DIVIDER}\n\n` +
    `🚨 **Verilen Uyarı Puanı:**\n` +
    `${record.pointsDisplay}\n\n` +
    `${LINE_DIVIDER}\n\n` +
    `📝 **Uyarı Sebebi:**\n` +
    `${record.reasonDisplay}\n\n` +
    `${LINE_DIVIDER}\n\n` +
    `🏷️ **Rolleri:**\n` +
    `${memberRolesText}\n\n` +
    `${LINE_DIVIDER}\n\n` +
    `📎 **Kanıt**\n` +
    `**Görsel Kanıtı:** ${proofFieldText}\n\n` +
    `\`\`\`\n⚡ Uygulanan İşlem\n${record.actionTaken}\n\`\`\``;

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Uyarı Var!!!')
    .setColor(embedColor)
    .setDescription(description)
    .setFooter({
      text: `Uyarı ID: #${record.id} • © ${new Date().getFullYear()} Piyade Team`,
    })
    .setTimestamp(record.createdAt || Date.now());

  if (guild && guild.iconURL()) {
    embed.setThumbnail(guild.iconURL({ size: 256 }));
  }

  if (record.proofAttachmentName) {
    embed.setImage(`attachment://${record.proofAttachmentName}`);
  } else if (record.proofUrl) {
    embed.setImage(record.proofUrl);
  }

  return {
    content: `<@${record.userId}>`,
    embeds: [embed],
  };
}

/**
 * Üyenin mevcut rollerini metin olarak döndürür
 */
function formatMemberRoles(member) {
  if (!member || !member.roles || !member.roles.cache) return '`Rol bulunmuyor`';
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => `<@&${r.id}>`);

  if (roles.length === 0) return '`Rol bulunmuyor`';
  return roles.slice(0, 15).join(', ') + (roles.length > 15 ? ` (+${roles.length - 15})` : '');
}

/**
 * 1. Adım: "[ 🗣️ Sözlü Uyarı Ver ]" veya "[ ⚠️ Uyarı Ver ]" Butonuna Basıldığında
 */
async function handleWarningButton(interaction, mode) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: `❌ Bu paneli yalnızca <@&${config.ROLES.DEVELOPER}> ve <@&${config.ROLES.TRYOUT_STAFF}> rollerine sahip yetkililer kullanabilir!`,
      ephemeral: true,
    });
  }

  const isVerbal = mode === 'verbal';
  const selectMenu = new UserSelectMenuBuilder()
    .setCustomId(isVerbal ? 'select_warn_verbal_user' : 'select_warn_official_user')
    .setPlaceholder(isVerbal ? 'Kullanıcı Seçin...' : 'Uyarı verilecek kişiyi seçin...')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return interaction.reply({
    content: isVerbal
      ? '🗣️ **Sözlü Uyarı İşlemi**\nLütfen aşağıdan sözlü uyarı verilecek kullanıcıyı seçin:'
      : '⚠️ **Resmi Uyarı İşlemi**\nLütfen aşağıdan uyarı verilecek kullanıcıyı seçin:',
    components: [row],
    ephemeral: true,
  });
}

/**
 * 2. Adım: Kullanıcı Seçildiğinde İlgili Modal'ı Aç
 */
async function handleWarningUserSelected(interaction, mode) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: '❌ Bu işlemi yapmaya yetkiniz yok!',
      ephemeral: true,
    });
  }

  const targetUserId = interaction.values[0];
  const targetUser = interaction.users.get(targetUserId);

  if (targetUser && targetUser.bot) {
    return interaction.reply({
      content: '❌ Botlara uyarı verilemez!',
      ephemeral: true,
    });
  }

  if (mode === 'verbal') {
    const modal = new ModalBuilder()
      .setCustomId(`modal_warn_verbal_${targetUserId}`)
      .setTitle('🗣️ Sözlü Uyarı Formu');

    const reasonInput = new TextInputBuilder()
      .setCustomId('warn_verbal_reason')
      .setLabel('Uyarı Sebebini Yazın')
      .setPlaceholder('Örn: Sohbet kanalında gereksiz tartışma uzatmak, lütfen dikkat edelim...')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(3)
      .setMaxLength(1000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  } else {
    const modal = new ModalBuilder()
      .setCustomId(`modal_warn_official_${targetUserId}`)
      .setTitle('⚠️ Resmi Uyarı Formu');

    const codeInput = new TextInputBuilder()
      .setCustomId('warn_rule_code')
      .setLabel('Madde Numarası')
      .setPlaceholder('M1 / D1 / M5 / Y2 vb.')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(20)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
    return interaction.showModal(modal);
  }
}

/**
 * Kanıt ekleme buton satırını üretir
 */
function buildProofPromptRow(warnId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_warn_proof_upload_${warnId}`)
      .setLabel('📎 Görsel Yükle')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`btn_warn_proof_skip_${warnId}`)
      .setLabel('⏩ Pas Geç')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * 3A. Adım: Sözlü Uyarı Modal Gönderimi
 */
async function handleVerbalWarnModalSubmit(interaction, targetUserId) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: '❌ Yetkiniz bulunmuyor!',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const reason = interaction.fields.getTextInputValue('warn_verbal_reason').trim();
  const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

  if (!targetMember) {
    return interaction.editReply({
      content: '❌ Seçilen kullanıcı sunucuda bulunamadı!',
    });
  }

  const userStats = database.getUserWarningStats(targetUserId);
  const newTotalWarnings = (userStats.totalWarnings || 0) + 1;

  database.setUserWarningStats(targetUserId, {
    totalWarnings: newTotalWarnings,
  });

  const warnId = database.generateWarningId();
  const memberRolesText = formatMemberRoles(targetMember);

  const record = database.saveWarningRecord({
    id: warnId,
    type: 'verbal',
    userId: targetUserId,
    staffId: interaction.user.id,
    ruleCode: 'SÖZLÜ',
    reason,
    reasonDisplay: `🗣️ Sözlü İhtar — ${reason}`,
    pointsAdded: 0,
    previousPoints: userStats.points || 0,
    newPoints: userStats.points || 0,
    previousTier: userStats.tier || 0,
    newTier: userStats.tier || 0,
    previousStaffWarnings: userStats.staffWarnings || 0,
    newStaffWarnings: userStats.staffWarnings || 0,
    totalWarnings: newTotalWarnings,
    pointsDisplay: `0 Puan (Toplam: ${userStats.points || 0})`,
    expiresAtText: 'Sözlü İhtar (Puansız)',
    actionTaken: 'Sözlü uyarı sicile işlendi (0 Puan, Rolsüz).',
    memberRolesSnapshot: memberRolesText,
    strippedRoles: [],
    appliedTimeout: false,
    appliedBan: false,
    appliedSuspended: false,
    proofUrl: null,
    logChannelId: config.CHANNELS.WARNING_LOG,
    logMessageId: null,
    createdAt: Date.now(),
  });

  // Uyarı Log Kanalına Gönder
  const logChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.WARNING_LOG) ||
    (await interaction.guild.channels.fetch(config.CHANNELS.WARNING_LOG).catch(() => null));

  if (logChannel) {
    const payload = buildWarningLogPayload(interaction.guild, record, memberRolesText);
    const sentMsg = await logChannel.send(payload).catch(() => null);
    if (sentMsg) {
      database.updateWarningRecord(warnId, { logMessageId: sentMsg.id });
    }
  }

  // Kullanıcıya DM Bildirimi
  try {
    await targetMember.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🗣️ Sözlü Uyarı Aldınız')
          .setColor(config.COLORS.WARNING_ORANGE)
          .setDescription(
            `**${interaction.guild.name}** sunucusunda yetkili <@${interaction.user.id}> tarafından sözlü olarak uyarıldınız.\n\n` +
            `📝 **Sebep:** ${reason}\n` +
            `📌 **Uyarı ID:** \`#${warnId}\`\n\n` +
            `*Bu uyarı puan eklemez ancak sicilinize kaydedilmiştir. Lütfen kurallara özen gösterin.*`
          )
          .setTimestamp(),
      ],
    });
  } catch (e) {}

  return interaction.editReply({
    content:
      `✅ <@${targetUserId}> kullanıcısına **Sözlü Uyarı** (\`#${warnId}\`) başarıyla verildi ve <#${config.CHANNELS.WARNING_LOG}> kanalına kaydedildi!\n\n` +
      `📎 **Bu uyarıya kanıt görseli (ekran görüntüsü) eklemek ister misiniz?**`,
    components: [buildProofPromptRow(warnId)],
  });
}

/**
 * 3B. Adım: Resmi Uyarı Modal Gönderimi (Madde Numarası ile)
 */
async function handleOfficialWarnModalSubmit(interaction, targetUserId) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: '❌ Yetkiniz bulunmuyor!',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const rawCode = interaction.fields.getTextInputValue('warn_rule_code').trim();
  const rule = resolveRuleCode(rawCode);

  if (!rule) {
    return interaction.editReply({
      content:
        `❌ **Geçersiz Madde Numarası (\`${rawCode}\`)!**\n` +
        `Lütfen geçerli bir madde kodu girin:\n` +
        `• **Katılımcı Maddeleri:** \`M1\` - \`M13\`, \`D1\` - \`D3\`\n` +
        `• **Yetkili Maddeleri:** \`Y1\` - \`Y5\`\n` +
        `*(Not: RM1-RM18 maddeleri sistemde bulunmamaktadır).*`,
    });
  }

  const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (!targetMember) {
    return interaction.editReply({
      content: '❌ Seçilen kullanıcı sunucuda bulunamadı!',
    });
  }

  // Uyarı kademesi rollerinin sunucuda hazır olduğundan emin ol
  const warningRoles = await ensureWarningRoles(interaction.guild);
  const memberRolesBefore = formatMemberRoles(targetMember);
  const userStats = database.getUserWarningStats(targetUserId);

  const previousPoints = userStats.points || 0;
  const previousTier = userStats.tier || 0;
  const previousStaffWarnings = userStats.staffWarnings || 0;
  const previousSuspendedUntil = userStats.suspendedUntil || null;
  const newTotalWarnings = (userStats.totalWarnings || 0) + 1;

  let newPoints = previousPoints;
  let newTier = previousTier;
  let newStaffWarnings = previousStaffWarnings;
  let newSuspendedUntil = previousSuspendedUntil;

  let warnType = 'participant';
  let pointsDisplay = '';
  let expiresAtText = 'Kalıcı';
  const actionsList = [];
  const strippedRoles = [];
  let appliedTimeout = false;
  let appliedBan = false;
  let appliedSuspended = false;

  // ==========================================
  // A) YETKİLİ MADDELERİ (Y1 - Y5)
  // ==========================================
  if (rule.category === 'staff') {
    warnType = 'staff';

    const staffWarningRoleIds = [
      warningRoles.yetkiliUyari1,
      warningRoles.yetkiliUyari2,
      warningRoles.yetkiliUyari3,
    ].filter(Boolean);

    if (rule.type === 'staff_strip') {
      // Y1: Direkt Tüm Yetkiler Alınır
      pointsDisplay = `Ağır Yetki İhlali (Y1)`;
      expiresAtText = 'Kalıcı';

      const rolesToStrip = targetMember.roles.cache
        .filter(
          (r) =>
            config.ROLES.STAFF_ROLES_TO_STRIP.includes(r.id) ||
            staffWarningRoleIds.includes(r.id)
        )
        .map((r) => r.id);

      if (rolesToStrip.length > 0) {
        strippedRoles.push(...rolesToStrip);
        await targetMember.roles
          .remove(rolesToStrip, `Y1 İhlali: Yetkiler alındı (Yetkili: ${interaction.user.tag})`)
          .catch(() => {});
      }
      actionsList.push('Ağır yetki ihlali (Y1): Kullanıcının tüm yetki rolleri anında alındı.');
    } else {
      // Y2 - Y5: +1 Yetkili Uyarı
      newStaffWarnings = previousStaffWarnings + 1;
      pointsDisplay = `+1 Yetkili Uyarı (Toplam: ${newStaffWarnings}/4)`;
      expiresAtText = 'Kalıcı';

      // Mevcut yetkili uyarı rollerini temizle
      const existingStaffWarnRoles = targetMember.roles.cache
        .filter((r) => staffWarningRoleIds.includes(r.id))
        .map((r) => r.id);
      if (existingStaffWarnRoles.length > 0) {
        await targetMember.roles.remove(existingStaffWarnRoles).catch(() => {});
      }

      if (newStaffWarnings >= 4) {
        // 4. İhlal (Sınır Aşımı): Tüm yetkiler alınır
        const rolesToStrip = targetMember.roles.cache
          .filter((r) => config.ROLES.STAFF_ROLES_TO_STRIP.includes(r.id))
          .map((r) => r.id);

        if (rolesToStrip.length > 0) {
          strippedRoles.push(...rolesToStrip);
          await targetMember.roles
            .remove(rolesToStrip, `4. Yetkili Uyarısı Sınır Aşımı (Yetkili: ${interaction.user.tag})`)
            .catch(() => {});
        }
        actionsList.push('4. Yetkili Uyarısı (Sınır Aşımı): Tüm yetki ve yönetim rolleri geri alındı!');
      } else {
        const targetRoleKey = `yetkiliUyari${newStaffWarnings}`;
        const roleIdToGive = warningRoles[targetRoleKey];
        if (roleIdToGive) {
          await targetMember.roles
            .add(roleIdToGive, `Yetkili Uyarı ${newStaffWarnings} verildi`)
            .catch(() => {});
        }
        actionsList.push(`Yetkili Uyarı ${newStaffWarnings} rolü verildi.`);
      }
    }
  }
  // ==========================================
  // B) KATILIMCI MADDELERİ (M1 - M13, D1 - D3)
  // ==========================================
  else {
    warnType = 'participant';

    // 1. Doğrudan Kalıcı Ban (M2)
    if (rule.type === 'ban') {
      pointsDisplay = `Özel Yaptırım (Kalıcı Ban)`;
      expiresAtText = 'Kalıcı';
      appliedBan = true;

      try {
        await targetMember.user.send(
          `🔨 **${interaction.guild.name}** sunucusundan **${rule.code} — ${rule.description}** sebebiyle kalıcı olarak yasaklandınız.`
        ).catch(() => {});
        await targetMember.ban({
          reason: `${rule.code}: ${rule.description} (Yetkili: ${interaction.user.tag})`,
        });
        actionsList.push('Kullanıcı sunucudan kalıcı olarak yasaklandı (Permanent Ban).');
      } catch (banErr) {
        actionsList.push(`Ban uygulanırken yetki hatası oluştu: ${banErr.message}`);
      }
    }
    // 2. Doğrudan Yasaklı Rolü (M9)
    else if (rule.type === 'yasakli') {
      pointsDisplay = `Özel Yaptırım (Doğrudan Yasaklı)`;
      expiresAtText = 'Kalıcı';

      const removableRoles = targetMember.roles.cache
        .filter((r) => r.id !== interaction.guild.id && !r.managed)
        .map((r) => r.id);

      if (removableRoles.length > 0) {
        strippedRoles.push(...removableRoles);
        await targetMember.roles
          .remove(removableRoles, `${rule.code}: Doğrudan Yasaklı izolasyonu`)
          .catch(() => {});
      }

      const yasakliRoleId = warningRoles.yasakli || config.ROLES.SUSPENDED;
      if (yasakliRoleId) {
        await targetMember.roles
          .add(yasakliRoleId, `${rule.code}: Doğrudan Yasaklı rolü verildi`)
          .catch(() => {});
      }
      actionsList.push('Kullanıcının tüm rolleri alındı ve @Yasaklı rolü verilerek izole edildi.');
    }
    // 3. Sabit Zaman Aşımı / Timeout (M4, M10, M11, M13)
    else if (rule.type === 'timeout') {
      const days = rule.durationDays || 1;
      const timeoutMs = days * 24 * 60 * 60 * 1000;
      const expireDate = new Date(Date.now() + timeoutMs);

      pointsDisplay = `0 Puan (Doğrudan ${days} Gün Timeout)`;
      expiresAtText = expireDate.toLocaleDateString('tr-TR');

      try {
        await targetMember.timeout(
          timeoutMs,
          `${rule.code}: ${rule.description} (Yetkili: ${interaction.user.tag})`
        );
        appliedTimeout = true;
        actionsList.push(`Puan işletilmeden doğrudan ${days} Gün Timeout (Zaman Aşımı) uygulandı.`);
      } catch (timeErr) {
        actionsList.push(`Timeout uygulanırken yetki hatası: ${timeErr.message}`);
      }
    }
    // 4. Puanlı Kurallar (M1, M3, M5, M6, M7, M8, M12, D1, D2, D3)
    else if (rule.type === 'points') {
      newPoints = previousPoints + rule.points;
      newTier = calculateTierFromPoints(newPoints);

      const amnestyDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expiresAtText = amnestyDate.toLocaleDateString('tr-TR');
      pointsDisplay = `+${rule.points} Puan (Toplam: ${newPoints})`;

      const tierRoleIds = [
        warningRoles.uyari1,
        warningRoles.uyari2,
        warningRoles.uyari3,
        warningRoles.uyari4,
        warningRoles.uyari5,
      ].filter(Boolean);

      // Eski Uyarı 1-5 rollerini temizle ve yeni kademe rolünü ver
      if (newTier === 0) {
        actionsList.push(`Ceza puanı işlendi (${newPoints} Puan — Kademe 0, henüz uyarı rolü verilmedi).`);
      } else {
        const targetTierRoleId = warningRoles[`uyari${newTier}`];
        const toRemove = targetMember.roles.cache
          .filter((r) => tierRoleIds.includes(r.id) && r.id !== targetTierRoleId)
          .map((r) => r.id);

        if (toRemove.length > 0) {
          await targetMember.roles.remove(toRemove, 'Uyarı kademesi yükseldi').catch(() => {});
        }

        if (targetTierRoleId && !targetMember.roles.cache.has(targetTierRoleId)) {
          await targetMember.roles
            .add(targetTierRoleId, `Uyarı kademesi: Uyarı ${newTier}`)
            .catch(() => {});
        }
        actionsList.push(`Uyarı ${newTier} rolü verildi.`);
      }

      // 10 Puan Kritik Eşiği: Puan 10'a ulaştığında veya aştığında anında +3 Gün Timeout
      if (newPoints >= 10 && previousPoints < 10) {
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        try {
          await targetMember.timeout(
            threeDaysMs,
            `10 Puan Kritik Eşiği Aşıldı (${newPoints} Puan) - Otomatik +3 Gün Timeout`
          );
          appliedTimeout = true;
          actionsList.push('10 Puan Kritik Eşiği: Otomatik +3 Gün Zaman Aşımı (Timeout) uygulandı.');
        } catch (err) {
          actionsList.push(`10 Puan Timeout hatası: ${err.message}`);
        }
      }

      // 15+ Puan Eşiği: Uyarı 5 + 1 Hafta Süreli @Askıda (1563922256525000895) Rolü
      if (newPoints >= 15) {
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        newSuspendedUntil = Date.now() + oneWeekMs;
        appliedSuspended = true;

        if (config.ROLES.SUSPENDED && interaction.guild.roles.cache.has(config.ROLES.SUSPENDED)) {
          await targetMember.roles
            .add(
              config.ROLES.SUSPENDED,
              `15+ Puan Eşiği (${newPoints} Puan) - 1 Haftalık Askıda/Karantina`
            )
            .catch(() => {});
        }
        actionsList.push('15+ Puan Eşiği: @Askıda (Jail) rolü tanımlandı (1 Hafta Karantina).');
      }
    }
  }

  // Kullanıcı istatistiklerini kaydet
  database.setUserWarningStats(targetUserId, {
    points: newPoints,
    tier: newTier,
    staffWarnings: newStaffWarnings,
    totalWarnings: newTotalWarnings,
    lastWarnedAt: Date.now(),
    suspendedUntil: newSuspendedUntil,
  });

  const warnId = database.generateWarningId();
  const actionTakenText = actionsList.join(' | ') || 'Uyarı kaydı işlendi.';

  const record = database.saveWarningRecord({
    id: warnId,
    type: warnType,
    userId: targetUserId,
    staffId: interaction.user.id,
    ruleCode: rule.code,
    reason: rule.description,
    reasonDisplay: `${rule.code} — ${rule.description}`,
    pointsAdded: rule.points || 0,
    previousPoints,
    newPoints,
    previousTier,
    newTier,
    previousStaffWarnings,
    newStaffWarnings,
    previousSuspendedUntil,
    totalWarnings: newTotalWarnings,
    pointsDisplay,
    expiresAtText,
    actionTaken: actionTakenText,
    memberRolesSnapshot: memberRolesBefore,
    strippedRoles,
    appliedTimeout,
    appliedBan,
    appliedSuspended,
    proofUrl: null,
    logChannelId: config.CHANNELS.WARNING_LOG,
    logMessageId: null,
    createdAt: Date.now(),
  });

  // Uyarı Log Kanalına (1563923439121604720) Gönder
  const logChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.WARNING_LOG) ||
    (await interaction.guild.channels.fetch(config.CHANNELS.WARNING_LOG).catch(() => null));

  if (logChannel) {
    const payload = buildWarningLogPayload(interaction.guild, record, memberRolesBefore);
    const sentMsg = await logChannel.send(payload).catch(() => null);
    if (sentMsg) {
      database.updateWarningRecord(warnId, { logMessageId: sentMsg.id });
    }
  }

  // Kullanıcıya DM Bildirimi (Banlanmadıysa)
  if (!appliedBan) {
    try {
      await targetMember.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ Sunucu Uyarısı Aldınız!')
            .setColor(config.COLORS.DANGER)
            .setDescription(
              `**${interaction.guild.name}** sunucusunda kural ihlali nedeniyle resmi uyarı aldınız.\n\n` +
              `📌 **Uyarı ID:** \`#${warnId}\`\n` +
              `📝 **İhlal Edilen Madde:** ${rule.code} — ${rule.description}\n` +
              `🚨 **Ceza / Puan:** ${pointsDisplay}\n` +
              `⚡ **Uygulanan İşlem:** ${actionTakenText}\n` +
              `📅 **Bitiş Tarihi:** ${expiresAtText}`
            )
            .setTimestamp(),
        ],
      }).catch(() => {});
    } catch (e) {}
  }

  return interaction.editReply({
    content:
      `✅ **Uyarı İşlemi Tamamlandı!** (\`#${warnId}\`)\n\n` +
      `• **Ceza Alan:** <@${targetUserId}>\n` +
      `• **Madde:** \`${rule.code}\` — ${rule.description}\n` +
      `• **İşlem:** ${actionTakenText}\n\n` +
      `📎 **Kanıt görseli (ekran görüntüsü) yüklemek için aşağıdaki butonu kullanabilirsiniz (30 saniye):**`,
    components: [buildProofPromptRow(warnId)],
  });
}

/**
 * 4. Adım: "[ 📎 Görsel Yükle ]" veya "[ ⏩ Pas Geç ]" Butonları
 */
async function handleProofButton(interaction, action, warnId) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: '❌ Bu işlemi yapmaya yetkiniz yok!',
      ephemeral: true,
    });
  }

  const record = database.getWarningRecord(warnId);
  if (!record) {
    return interaction.reply({
      content: '❌ İlgili uyarı kaydı bulunamadı!',
      ephemeral: true,
    });
  }

  if (action === 'skip') {
    return interaction.update({
      content: `✅ **#${record.id}** numaralı uyarı işlemi tamamlandı (Kanıt görseli pas geçildi).`,
      components: [],
    });
  }

  // action === 'upload' -> 30 saniye boyunca bu kanalda yetkilinin atacağı görseli bekle
  await interaction.update({
    content:
      `📸 **Kanıt Görseli Bekleniyor... (30 Saniye)**\n` +
      `Lütfen **30 saniye** içinde bulunduğunuz bu kanala **ekran görüntüsünü (görsel dosyasını veya resim linkini)** gönderin.\n` +
      `*(Gönderdiğiniz mesaj otomatik silinecek ve <#${config.CHANNELS.WARNING_LOG}> kanalındaki uyarı kartına eklenecektir).*`,
    components: [],
  });

  const channel = interaction.channel;
  if (!channel) return;

  const filter = (msg) => {
    if (msg.author.id !== interaction.user.id) return false;
    const hasImageAttachment = msg.attachments.some(
      (att) =>
        (att.contentType && att.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(att.url)
    );
    const hasImageUrl = /https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?/i.test(msg.content);
    return hasImageAttachment || hasImageUrl;
  };

  const collector = channel.createMessageCollector({
    filter,
    max: 1,
    time: 30 * 1000,
  });

  collector.on('collect', async (msg) => {
    try {
      const attachment = msg.attachments.first();
      let imageBuffer = null;
      let fileName = `kanit_${record.id}.png`;
      let directUrl = null;

      if (attachment) {
        directUrl = attachment.url;
        // Mesaj silindiğinde Discord CDN linkinin bozulmaması için görseli belleğe çekip log mesajına ekliyoruz
        try {
          const res = await fetch(attachment.url);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuf);
          }
        } catch (e) {}
      } else {
        const urlMatch = msg.content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?/i);
        if (urlMatch) directUrl = urlMatch[0];
      }

      // Panel kanalını temiz tutmak için yetkilinin attığı geçici görsel mesajını sil
      await msg.delete().catch(() => {});

      const logChannel =
        interaction.guild.channels.cache.get(config.CHANNELS.WARNING_LOG) ||
        (await interaction.guild.channels.fetch(config.CHANNELS.WARNING_LOG).catch(() => null));

      if (logChannel && record.logMessageId) {
        const logMsg = await logChannel.messages.fetch(record.logMessageId).catch(() => null);
        if (logMsg) {
          if (imageBuffer) {
            record.proofAttachmentName = fileName;
            record.proofUrl = directUrl;
            const updatedPayload = buildWarningLogPayload(
              interaction.guild,
              record,
              record.memberRolesSnapshot
            );
            updatedPayload.files = [{ attachment: imageBuffer, name: fileName }];

            const edited = await logMsg.edit(updatedPayload).catch(() => null);
            if (edited && edited.embeds[0]?.image?.url) {
              record.proofUrl = edited.embeds[0].image.url;
            }
          } else if (directUrl) {
            record.proofUrl = directUrl;
            const updatedPayload = buildWarningLogPayload(
              interaction.guild,
              record,
              record.memberRolesSnapshot
            );
            await logMsg.edit(updatedPayload).catch(() => {});
          }
        }
      }

      database.updateWarningRecord(record.id, {
        proofUrl: record.proofUrl,
        proofAttachmentName: record.proofAttachmentName || null,
      });

      await interaction.followUp({
        content: `✅ **Kanıt görseli başarıyla \`#${record.id}\` numaralı uyarı kartına eklendi!**`,
        ephemeral: true,
      }).catch(() => {});
    } catch (err) {
      console.error('[KANIT YÜKLEME HATASI]:', err);
    }
  });

  collector.on('end', async (collected) => {
    if (collected.size === 0) {
      await interaction.followUp({
        content: `⏰ **30 saniyelik kanıt yükleme süresi doldu.** Uyarı kartı görselsiz olarak bırakıldı.`,
        ephemeral: true,
      }).catch(() => {});
    }
  });
}

/**
 * /uyari-iptal Komutu: Verilen uyarıyı, puanları, rolleri, timeout veya banı geri alır
 */
async function handleCancelWarningCommand(interaction, rawWarnId) {
  if (!hasWarningAuthority(interaction.member)) {
    return interaction.reply({
      content: `❌ Bu komutu yalnızca <@&${config.ROLES.DEVELOPER}> ve <@&${config.ROLES.TRYOUT_STAFF}> rollerine sahip yetkililer kullanabilir!`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const record = database.getWarningRecord(rawWarnId);
  if (!record) {
    return interaction.editReply({
      content: `❌ **\`${rawWarnId}\`** koduna sahip bir uyarı kaydı bulunamadı! (Örn: \`A8F2\` veya \`#A8F2\`)`,
    });
  }

  if (record.cancelled) {
    return interaction.editReply({
      content: `⚠️ **\`#${record.id}\`** numaralı uyarı zaten daha önce iptal edilmiş!`,
    });
  }

  const warningRoles = await ensureWarningRoles(interaction.guild);
  const userStats = database.getUserWarningStats(record.userId);

  // 1. İstatistikleri Geri Sar
  const restoredPoints = Math.max(0, (userStats.points || 0) - (record.pointsAdded || 0));
  const restoredTier = calculateTierFromPoints(restoredPoints);
  const restoredStaffWarnings =
    record.type === 'staff' && record.newStaffWarnings > record.previousStaffWarnings
      ? Math.max(0, (userStats.staffWarnings || 1) - 1)
      : userStats.staffWarnings || 0;
  const restoredTotal = Math.max(0, (userStats.totalWarnings || 1) - 1);

  database.setUserWarningStats(record.userId, {
    points: restoredPoints,
    tier: restoredTier,
    staffWarnings: restoredStaffWarnings,
    totalWarnings: restoredTotal,
    suspendedUntil: record.appliedSuspended ? record.previousSuspendedUntil || null : userStats.suspendedUntil,
  });

  database.updateWarningRecord(record.id, {
    cancelled: true,
    cancelledBy: interaction.user.id,
    cancelledAt: Date.now(),
  });

  const revertActions = [];

  // 2. Ban Uygulandıysa Banı Kaldır
  if (record.appliedBan) {
    try {
      await interaction.guild.members.unban(
        record.userId,
        `Uyarı İptal Edildi (#${record.id}) - Yetkili: ${interaction.user.tag}`
      );
      revertActions.push('Kullanıcının sunucu yasağı (Ban) kaldırıldı.');
    } catch (e) {}
  }

  // 3. Üye Sunucudaysa Rolleri ve Timeout'u Geri Al
  const targetMember = await interaction.guild.members.fetch(record.userId).catch(() => null);
  if (targetMember) {
    // Timeout kaldır
    if (record.appliedTimeout && targetMember.isCommunicationDisabled()) {
      await targetMember.timeout(null, `Uyarı İptal Edildi (#${record.id})`).catch(() => {});
      revertActions.push('Kullanıcının Timeout (Zaman Aşımı) cezası kaldırıldı.');
    }

    // Askıda rolü verildiyse kaldır
    if (record.appliedSuspended && config.ROLES.SUSPENDED) {
      await targetMember.roles
        .remove(config.ROLES.SUSPENDED, `Uyarı İptal Edildi (#${record.id})`)
        .catch(() => {});
      revertActions.push('@Askıda (Karantina) rolü kaldırıldı.');
    }

    // M9 Yasaklı rolü verildiyse kaldır
    if (record.ruleCode === 'M9' && warningRoles.yasakli) {
      await targetMember.roles
        .remove(warningRoles.yasakli, `Uyarı İptal Edildi (#${record.id})`)
        .catch(() => {});
    }

    // Alınan roller varsa (Y1, 4. Yetkili Uyarısı veya M9) iade et
    if (Array.isArray(record.strippedRoles) && record.strippedRoles.length > 0) {
      const validRestorable = record.strippedRoles.filter((id) =>
        interaction.guild.roles.cache.has(id)
      );
      if (validRestorable.length > 0) {
        await targetMember.roles
          .add(validRestorable, `Uyarı İptal Edildi (#${record.id}) - Alınan roller iade edildi`)
          .catch(() => {});
        revertActions.push('Geri alınan tüm roller kullanıcıya iade edildi.');
      }
    }

    // Katılımcı Uyarı kademesi rolünü güncelle
    if (record.type === 'participant') {
      const tierRoleIds = [
        warningRoles.uyari1,
        warningRoles.uyari2,
        warningRoles.uyari3,
        warningRoles.uyari4,
        warningRoles.uyari5,
      ].filter(Boolean);

      const toRemove = targetMember.roles.cache
        .filter((r) => tierRoleIds.includes(r.id))
        .map((r) => r.id);
      if (toRemove.length > 0) {
        await targetMember.roles.remove(toRemove).catch(() => {});
      }

      if (restoredTier > 0 && warningRoles[`uyari${restoredTier}`]) {
        await targetMember.roles.add(warningRoles[`uyari${restoredTier}`]).catch(() => {});
        revertActions.push(`Katılımcı kademesi Uyarı ${restoredTier} (${restoredPoints} Puan) olarak güncellendi.`);
      } else {
        revertActions.push(`Katılımcı uyarı rolleri temizlendi (${restoredPoints} Puan).`);
      }
    }

    // Yetkili Uyarı kademesi rolünü güncelle
    if (record.type === 'staff') {
      const staffWarnRoleIds = [
        warningRoles.yetkiliUyari1,
        warningRoles.yetkiliUyari2,
        warningRoles.yetkiliUyari3,
      ].filter(Boolean);

      const toRemove = targetMember.roles.cache
        .filter((r) => staffWarnRoleIds.includes(r.id))
        .map((r) => r.id);
      if (toRemove.length > 0) {
        await targetMember.roles.remove(toRemove).catch(() => {});
      }

      if (
        restoredStaffWarnings >= 1 &&
        restoredStaffWarnings <= 3 &&
        warningRoles[`yetkiliUyari${restoredStaffWarnings}`]
      ) {
        await targetMember.roles
          .add(warningRoles[`yetkiliUyari${restoredStaffWarnings}`])
          .catch(() => {});
      }
      revertActions.push(`Yetkili uyarı seviyesi ${restoredStaffWarnings} olarak geri alındı.`);
    }
  }

  // 4. Log Kanalındaki Mesajı İptal Edildi Olarak Güncelle
  if (record.logMessageId) {
    const logChannel =
      interaction.guild.channels.cache.get(config.CHANNELS.WARNING_LOG) ||
      (await interaction.guild.channels.fetch(config.CHANNELS.WARNING_LOG).catch(() => null));

    if (logChannel) {
      const logMsg = await logChannel.messages.fetch(record.logMessageId).catch(() => null);
      if (logMsg && logMsg.embeds.length > 0) {
        const oldEmbed = logMsg.embeds[0];
        const cancelledEmbed = EmbedBuilder.from(oldEmbed)
          .setTitle(`↩️ Uyarı İptal Edildi (#${record.id})`)
          .setColor(config.COLORS.SUCCESS)
          .setFooter({
            text: `Uyarı ID: #${record.id} • ${interaction.user.tag} tarafından iptal edildi`,
          });

        await logMsg.edit({ embeds: [cancelledEmbed] }).catch(() => {});
      }
    }
  }

  return interaction.editReply({
    content:
      `✅ **\`#${record.id}\` Numaralı Uyarı Başarıyla İptal Edildi ve Geri Alındı!**\n\n` +
      `• **Kullanıcı:** <@${record.userId}>\n` +
      `• **Geri Alınan İşlemler:** ${revertActions.join(' ') || 'Sicil kaydı geri alındı.'}`,
  });
}

/**
 * Arka Plan Döngüsü 1: 30 Günlük Otomatik Af Kontrolü (Saat Başı Çalışır)
 * Son uyarısından itibaren 30 gün boyunca hiçbir ceza almayan üyenin puanı ve kademesi 0 yapılır,
 * üzerindeki uyarı rolleri temizlenir. (Loglara ve sicil arşivine dokunulmaz).
 */
async function checkThirtyDayAmnesty(client) {
  try {
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return;

    const warningRoles = database.getWarningRoles();
    const tierRoleIds = [
      warningRoles.uyari1,
      warningRoles.uyari2,
      warningRoles.uyari3,
      warningRoles.uyari4,
      warningRoles.uyari5,
    ].filter(Boolean);

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const allStats = database.getAllWarningStats();

    for (const stats of allStats) {
      if ((stats.points > 0 || stats.tier > 0) && stats.lastWarnedAt > 0) {
        if (now - stats.lastWarnedAt >= THIRTY_DAYS_MS) {
          database.setUserWarningStats(stats.userId, {
            points: 0,
            tier: 0,
          });

          const member = await guild.members.fetch(stats.userId).catch(() => null);
          if (member && tierRoleIds.length > 0) {
            const rolesToRemove = member.roles.cache
              .filter((r) => tierRoleIds.includes(r.id))
              .map((r) => r.id);
            if (rolesToRemove.length > 0) {
              await member.roles
                .remove(rolesToRemove, '30 Günlük Otomatik Af: Uyarı puanları ve rolleri sıfırlandı')
                .catch(() => {});
            }
          }
          console.log(`[OTOMATİK AF] ${stats.userId} kullanıcısının 30 günlük süresi doldu, puanları sıfırlandı.`);
        }
      }
    }
  } catch (err) {
    console.error('[OTOMATİK AF HATASI]:', err.message);
  }
}

/**
 * Arka Plan Döngüsü 2: @Askıda (1563922256525000895) 1 Haftalık Süre Kontrolü (Her 30 Dakikada Bir)
 */
async function checkSuspendedExpirations(client) {
  try {
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return;

    const now = Date.now();
    const allStats = database.getAllWarningStats();

    for (const stats of allStats) {
      if (stats.suspendedUntil && now >= stats.suspendedUntil) {
        database.setUserWarningStats(stats.userId, {
          suspendedUntil: null,
        });

        const member = await guild.members.fetch(stats.userId).catch(() => null);
        if (member && config.ROLES.SUSPENDED && member.roles.cache.has(config.ROLES.SUSPENDED)) {
          await member.roles
            .remove(config.ROLES.SUSPENDED, '1 Haftalık @Askıda (Karantina) süresi doldu')
            .catch(() => {});
          console.log(`[ASKIDA SÜRE DOLDU] ${stats.userId} kullanıcısının @Askıda rolü kaldırıldı.`);
        }
      }
    }
  } catch (err) {
    console.error('[ASKIDA KONTROL HATASI]:', err.message);
  }
}

/**
 * Sunucu açılışında 1563923294602666125 kanalında uyarı paneli yoksa otomatik kurar veya günceller
 */
async function ensureWarningPanelMessage(guild) {
  if (!guild) return;

  await ensureWarningRoles(guild).catch(() => {});

  const channel =
    guild.channels.cache.get(config.CHANNELS.WARNING_PANEL) ||
    (await guild.channels.fetch(config.CHANNELS.WARNING_PANEL).catch(() => null));

  if (!channel) return;

  const payload = createWarningPanel();

  try {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (messages) {
      const existingPanel = messages.find(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.embeds.length > 0 &&
          m.embeds[0].title &&
          m.embeds[0].title.includes('Sunucu Uyarı Paneli')
      );

      if (existingPanel) {
        await existingPanel.edit(payload);
        return existingPanel;
      }
    }

    const sent = await channel.send(payload);
    console.log(`[UYARI PANELİ] Uyarı paneli ${channel.id} kanalına otomatik kuruldu.`);
    return sent;
  } catch (err) {
    console.error('[UYARI PANELİ OTOMATİK KURULUM HATASI]:', err.message);
  }
}

module.exports = {
  RULES,
  isDeveloper,
  hasWarningAuthority,
  ensureWarningRoles,
  createWarningPanel,
  ensureWarningPanelMessage,
  handleWarningButton,
  handleWarningUserSelected,
  handleVerbalWarnModalSubmit,
  handleOfficialWarnModalSubmit,
  handleProofButton,
  handleCancelWarningCommand,
  checkThirtyDayAmnesty,
  checkSuspendedExpirations,
};
