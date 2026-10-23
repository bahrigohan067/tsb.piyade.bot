const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const database = require('./database');

// 12 adet mor çizgi emojisi
const PURPLE_DIVIDER = Array(12).fill(config.EMOJIS.PURPLE_LINE).join('');

// Tüm 37 seviye rolünün ID kümesi (hızlı kontrol için)
const LEVEL_ROLE_IDS = new Set(config.LEVEL_ROLES.map((r) => r.id));

/**
 * İki metin arasındaki Levenshtein mesafesini hesaplar (Yazım hatası düzeltme için)
 */
function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // silme
        matrix[i][j - 1] + 1,      // ekleme
        matrix[i - 1][j - 1] + cost // değiştirme
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Türkçe karakterleri ve fazlalık sembolleri temizler
 */
function normalizeRoleText(text) {
  if (!text) return '';
  const trMap = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'I': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u',
  };

  return String(text)
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (m) => trMap[m] || m)
    .toLowerCase()
    .replace(/<@&(\d+)>/g, '$1')
    .replace(/[@•\-_.,/\\|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Yetkilinin yazdığı rol adını analiz eder, yazım hatalarını düzeltir ve en doğru seviye rolünü bulur.
 * @param {string} rawInput
 * @returns {object|null} config.LEVEL_ROLES içindeki rol objesi
 */
function resolveLevelRole(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;

  const trimmed = rawInput.trim();

  // 1. Doğrudan Rol Etiketi (<@&ID>) veya Rol ID'si girildiyse
  const idMatch = trimmed.match(/^(?:<@&)?(\d{17,20})>?$/);
  if (idMatch) {
    const byId = config.LEVEL_ROLES.find((r) => r.id === idMatch[1]);
    if (byId) return byId;
  }

  // 2. #22 - #58 gibi sıra numarası girildiyse (Örn: "#42" veya "#58")
  const orderMatch = trimmed.match(/^#(\d{2})$/);
  if (orderMatch) {
    const orderNum = parseInt(orderMatch[1], 10);
    const byOrder = config.LEVEL_ROLES.find((r) => r.order === orderNum);
    if (byOrder) return byOrder;
  }

  const normalized = normalizeRoleText(trimmed);
  if (!normalized) return null;

  // 3. Tam eşleşme kontrolü (İsim, Canonical veya Alias)
  for (const role of config.LEVEL_ROLES) {
    if (
      normalizeRoleText(role.name) === normalized ||
      normalizeRoleText(role.canonical) === normalized ||
      role.aliases.some((alias) => normalizeRoleText(alias) === normalized)
    ) {
      return role;
    }
  }

  // 4. Akıllı Kelime / Token Çözümleme (Tier + Subtier + Sayı)
  // Örn: "hihg waek 3", "mid stabel 2", "low storng 1", "high 0" vb.
  const tokens = normalized.split(' ').filter(Boolean);

  let detectedTier = null;    // 'low' | 'mid' | 'high'
  let detectedSub = null;     // 'weak' | 'stable' | 'strong'
  let detectedNumber = null;  // '0' | '1' | '2' | '3' | '4'

  const tierPatterns = {
    low: ['low', 'lov', 'lw', 'lo', 'lwo', 'law', 'loww'],
    mid: ['mid', 'md', 'middle', 'mit', 'midd', 'mıd'],
    high: ['high', 'hihg', 'hig', 'hgih', 'hgh', 'hight', 'heigh', 'hi', 'hay', 'hıgh', 'hıhg'],
  };

  const subPatterns = {
    weak: ['weak', 'waek', 'wek', 'weka', 'wak', 'week', 'wea', 'wk', 'weakk'],
    stable: ['stable', 'stabel', 'stble', 'stabl', 'stab', 'stbl', 'staple', 'satable', 'stb', 'stabile', 'stabil'],
    strong: ['strong', 'storng', 'strng', 'stong', 'stron', 'srong', 'strg', 'str', 'strog', 'strongg'],
  };

  for (const token of tokens) {
    // Rakam kontrolü (0-4)
    if (/^[0-4]$/.test(token)) {
      detectedNumber = token;
      continue;
    }

    // Birleşik yazım kontrolü (örn: "weak2", "strong1", "high3")
    const numSuffix = token.match(/^([a-z]+)([0-4])$/);
    const wordPart = numSuffix ? numSuffix[1] : token;
    if (numSuffix && detectedNumber === null) {
      detectedNumber = numSuffix[2];
    }

    // Tier kontrolü
    if (!detectedTier) {
      for (const [tierKey, list] of Object.entries(tierPatterns)) {
        if (list.includes(wordPart) || list.some((w) => w.length >= 3 && levenshteinDistance(wordPart, w) <= 1)) {
          detectedTier = tierKey;
          break;
        }
      }
    }

    // Subtier kontrolü
    if (!detectedSub) {
      for (const [subKey, list] of Object.entries(subPatterns)) {
        if (list.includes(wordPart) || list.some((w) => w.length >= 4 && levenshteinDistance(wordPart, w) <= 1)) {
          detectedSub = subKey;
          break;
        }
      }
    }
  }

  // Özel Durum: "High Strong 0" (En üst seviye #58)
  if (detectedNumber === '0' && (detectedTier === 'high' || detectedSub === 'strong')) {
    return config.LEVEL_ROLES.find((r) => r.canonical === 'high strong 0') || null;
  }

  // Eğer Tier + Subtier + Rakam üçlüsü tespit edildiyse doğrudan eşleştir
  if (detectedTier && detectedSub && detectedNumber) {
    const targetCanonical = `${detectedTier} ${detectedSub} ${detectedNumber}`;
    const matched = config.LEVEL_ROLES.find((r) => r.canonical === targetCanonical);
    if (matched) return matched;
  }

  // 5. Genel Levenshtein Benzerlik Taraması (En yakın rol adını bul)
  let bestRole = null;
  let bestDistance = Infinity;

  for (const role of config.LEVEL_ROLES) {
    const candidates = [
      normalizeRoleText(role.name),
      normalizeRoleText(role.canonical),
      ...role.aliases.map((a) => normalizeRoleText(a)),
    ];

    for (const candidate of candidates) {
      const dist = levenshteinDistance(normalized, candidate);
      // Eğer kullanıcının yazdığı rakam ile aday rolün rakamı uyuşmuyorsa ceza puanı ekle (yanlış sayı verilmesini önler)
      const candidateNum = (candidate.match(/[0-4]/) || [])[0];
      const numberPenalty = detectedNumber && candidateNum && detectedNumber !== candidateNum ? 5 : 0;
      const totalScore = dist + numberPenalty;

      if (totalScore < bestDistance) {
        bestDistance = totalScore;
        bestRole = role;
      }
    }
  }

  // Maksimum kabul edilebilir hata payı (5 karakter farkına kadar)
  if (bestRole && bestDistance <= 5) {
    return bestRole;
  }

  return null;
}

/**
 * ID'ye göre config.LEVEL_ROLES içinden rol bilgisini getirir
 */
function getLevelRoleById(roleId) {
  if (!roleId) return null;
  return config.LEVEL_ROLES.find((r) => r.id === String(roleId)) || null;
}

/**
 * Üyenin üzerinde bulunan mevcut seviye rollerini tespit eder (En yüksek olanı döndürür)
 */
function getMemberCurrentLevelRoles(member) {
  if (!member || !member.roles || !member.roles.cache) return [];
  return config.LEVEL_ROLES.filter((r) => member.roles.cache.has(r.id)).sort(
    (a, b) => b.level - a.level
  );
}

/**
 * Tryout Değerlendirme Panelini Üretir (1562459282040029225 kanalı için)
 */
function createTryoutPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`${config.EMOJIS.KING} Piyade Team | TSB | Seviye Değerlendirme (Tryout) Paneli`)
    .setColor(config.COLORS.NAVY)
    .setDescription(
      `${PURPLE_DIVIDER}\n\n` +
      `## 🛡️ TSB Klan Seviye & Puanlama Sistemi\n` +
      `Bu panel, **Piyade Team | TSB (The Strongest Battlegrounds)** bünyesindeki klan üyelerinin oyun içi performanslarını değerlendirmek, aşamalı seviye rollerini tanımlamak ve resmi sıralama tablosunu güncellemek amacıyla kurulmuştur.\n\n` +
      `### 📌 Yetkili Kullanım Rehberi\n` +
      `> **1️⃣ Adım:** Aşağıdaki **\`📋 Kullanıcı Değerlendir\`** butonuna tıklayın.\n` +
      `> **2️⃣ Adım:** Açılan menüden değerlendirmek istediğiniz **Klan Üyesini** seçin.\n` +
      `> **3️⃣ Adım:** Ekrana gelen değerlendirme formunda:\n` +
      `> • **Verilecek Seviye Rolü:** Üyeye uygun gördüğünüz rol adını yazın *(Örn: \`Low weak 4\`, \`Mid stable 2\`, \`High strong 1\`, \`High strong 0\`)*. Yazım hatası yapsanız bile sistem otomatik düzeltecektir.\n` +
      `> • **Değerlendirme Açıklaması:** Oyuncunun genel performansı, komboları, oyun bilgisi ve maç içi analizini detaylıca yazın.\n` +
      `> • **Geliştirilmesi Gereken Yönler:** Oyuncunun bir üst seviyeye çıkabilmesi için kapatması gereken eksikleri belirtin.\n` +
      `> **4️⃣ Adım:** Formu onayladığınızda üyenin eski seviye rolü otomatik alınır, yeni rolü verilir, <#${config.CHANNELS.TRYOUT_RESULT}> kanalında paylaşılır ve <#${config.CHANNELS.TRYOUT_LEADERBOARD}> tablosu anında güncellenir!\n\n` +
      `### 📊 Aşamalı Seviye Hiyerarşisi (Düşükten Yükseğe)\n` +
      `• 🥉 **Low Klasmanı:** \`Low weak 4\` ➔ \`Low stable 4\` ➔ \`Low strong 4\` ... \`Low strong 1\`\n` +
      `• 🥈 **Mid Klasmanı:** \`Mid weak 4\` ➔ \`Mid stable 4\` ➔ \`Mid strong 4\` ... \`Mid strong 1\`\n` +
      `• 🥇 **High Klasmanı:** \`High weak 4\` ➔ \`High stable 4\` ➔ \`High strong 4\` ... \`High strong 1\`\n` +
      `• 👑 **Zirve Klasmanı:** \`Hihg Strong 0\` *(En Üst Seviye)*\n\n` +
      `### ⚙️ Yönetim & İptal İşlemleri\n` +
      `• Bir üyeye birden fazla kez değerlendirme formu açabilir ve seviyesini her an güncelleyebilirsiniz.\n` +
      `• Hatalı doldurulan bir formu geri almak için **\`/form-iptal [Form Kodu]\`** komutunu kullanabilirsiniz.\n` +
      `• **Yetkili Rolü:** <@&${config.ROLES.TRYOUT_STAFF}>\n\n` +
      `${PURPLE_DIVIDER}`
    )
    .setFooter({
      text: 'Piyade Team | TSB • Profesyonel Seviye Değerlendirme Sistemi',
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_tryout_degerlendir')
      .setLabel('Kullanıcı Değerlendir')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

/**
 * Tryout Sıralama Tablosu Embedini Üretir (1563212550332612700 kanalı için)
 */
function createTryoutLeaderboardEmbed() {
  const leaderboard = database.getTryoutLeaderboard();

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

  let rowsText = '';

  if (!leaderboard || leaderboard.length === 0) {
    rowsText = `*Henüz değerlendirmeye alınan bir klan üyesi bulunmamaktadır.*`;
  } else {
    leaderboard.forEach((entry, index) => {
      const emoji = rankEmojis[index] || `**#${index + 1}**`;
      const isLast = index === leaderboard.length - 1;
      const golemSuffix = isLast ? ` ${config.EMOJIS.GOLEM}` : '';

      rowsText += `${emoji} <@${entry.userId}> <@&${entry.roleId}> **[ ${entry.formCount} Form ]**${golemSuffix}\n`;

      // İlk 3 sıradan sonra şablondaki gibi boşluk bırak
      if (index === 2 && leaderboard.length > 3) {
        rowsText += `\n`;
      }
    });
  }

  const description =
    `# ${config.EMOJIS.KING} Piyade Team | TSB | Tryout Değerlendirmesi ${config.EMOJIS.KING}\n\n` +
    `${PURPLE_DIVIDER}\n` +
    `${config.EMOJIS.ADMIN_BADGE} <@&${config.ROLES.TRYOUT_STAFF}> | <@${config.USERS.TRYOUT_HEADER_USER}> ${config.EMOJIS.ADMIN_BADGE}\n\n` +
    `${rowsText}\n` +
    `${PURPLE_DIVIDER}\n` +
    `-# ${config.EMOJIS.MODERATOR} Piyade Team | Tryout Değerlendirmesi`;

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.NAVY)
    .setDescription(description)
    .setFooter({
      text: `Piyade Team | TSB • Toplam Değerlendirilen Üye: ${leaderboard.length}`,
    })
    .setTimestamp();

  return {
    embeds: [embed],
  };
}

/**
 * 1563212550332612700 Kanalındaki Tryout Sıralama Tablosunu Günceller veya Yoksa Gönderir
 */
async function updateTryoutLeaderboard(guild) {
  if (!guild) return;

  const channel =
    guild.channels.cache.get(config.CHANNELS.TRYOUT_LEADERBOARD) ||
    (await guild.channels.fetch(config.CHANNELS.TRYOUT_LEADERBOARD).catch(() => null));

  if (!channel) {
    console.warn(`[TRYOUT TABLO] Kanal (${config.CHANNELS.TRYOUT_LEADERBOARD}) bulunamadı!`);
    return;
  }

  const payload = createTryoutLeaderboardEmbed();
  const existingMsgId = database.getTryoutLeaderboardMessageId();

  if (existingMsgId) {
    try {
      const existingMsg = await channel.messages.fetch(existingMsgId).catch(() => null);
      if (existingMsg) {
        await existingMsg.edit(payload);
        return existingMsg;
      }
    } catch (err) {
      console.warn('[TRYOUT TABLO] Eski mesaj güncellenemedi, yeni mesaj oluşturuluyor:', err.message);
    }
  }

  // Kanalda daha önce bota ait bir tablo mesajı varsa onu bulup kullan
  try {
    const recentMessages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (recentMessages) {
      const botMsg = recentMessages.find(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.embeds.length > 0 &&
          m.embeds[0].description &&
          m.embeds[0].description.includes('Tryout Değerlendirmesi')
      );
      if (botMsg) {
        await botMsg.edit(payload);
        database.setTryoutLeaderboardMessageId(botMsg.id);
        return botMsg;
      }
    }
  } catch (e) {}

  try {
    const newMsg = await channel.send(payload);
    database.setTryoutLeaderboardMessageId(newMsg.id);
    console.log(`[TRYOUT TABLO] Yeni sıralama tablosu oluşturuldu (ID: ${newMsg.id}).`);
    return newMsg;
  } catch (err) {
    console.error('[TRYOUT TABLO] Mesaj gönderilirken hata oluştu:', err.message);
  }
}

/**
 * Uzun metinleri Discord Embed Field sınırına (1024 karakter) takılmaması için böler
 */
function createChunkedFields(baseTitle, content) {
  const cleanText = (content || 'Belirtilmedi.').trim();
  const maxChunkSize = 1000;

  if (cleanText.length <= maxChunkSize) {
    return [{ name: baseTitle, value: `>>> ${cleanText}`, inline: false }];
  }

  const fields = [];
  let remaining = cleanText;
  let part = 1;

  while (remaining.length > 0 && part <= 4) {
    let slice = remaining.slice(0, maxChunkSize);
    if (remaining.length > maxChunkSize) {
      const lastNewline = slice.lastIndexOf('\n');
      const lastSpace = slice.lastIndexOf(' ');
      const splitIndex = lastNewline > 700 ? lastNewline : lastSpace > 700 ? lastSpace : maxChunkSize;
      slice = remaining.slice(0, splitIndex);
    }
    remaining = remaining.slice(slice.length).trim();

    fields.push({
      name: part === 1 ? baseTitle : `${baseTitle} (Devamı #${part})`,
      value: `>>> ${slice}`,
      inline: false,
    });
    part++;
  }

  return fields;
}

/**
 * Yetkili kontrolü (Sadece 1559614111128490044 rolü)
 */
function hasTryoutPermission(member) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return member.roles.cache.has(config.ROLES.TRYOUT_STAFF);
}

/**
 * 1. Adım: "📋 Kullanıcı Değerlendir" butonuna basıldığında çalışır
 */
async function handleTryoutStart(interaction) {
  if (!hasTryoutPermission(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: `❌ Bu paneli sadece <@&${config.ROLES.TRYOUT_STAFF}> rolüne sahip yetkililer kullanabilir!`,
      ephemeral: true,
    });
  }

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('select_tryout_user')
    .setPlaceholder('Değerlendirmek istediğiniz klan üyesini seçin...')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(userSelect);

  return interaction.reply({
    content:
      `📋 **Tryout | Kullanıcı Değerlendirme Başlatıldı**\n` +
      `Lütfen aşağıdan değerlendirme anketi doldurmak istediğiniz üyeyi seçiniz:`,
    components: [row],
    ephemeral: true,
  });
}

/**
 * 2. Adım: Yetkili menüden bir kullanıcı seçtiğinde Değerlendirme Anketi (Modal) açılır
 */
async function handleTryoutUserSelected(interaction) {
  if (!hasTryoutPermission(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: `❌ Bu işlemi sadece <@&${config.ROLES.TRYOUT_STAFF}> yetkilileri yapabilir!`,
      ephemeral: true,
    });
  }

  const targetUserId = interaction.values[0];
  const targetUser = interaction.users.get(targetUserId);

  if (targetUser && targetUser.bot) {
    return interaction.reply({
      content: '❌ Botlara seviye değerlendirmesi yapılamaz! Lütfen gerçek bir üye seçin.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_tryout_eval_${targetUserId}`)
    .setTitle('TSB | Seviye Değerlendirme Formu');

  const roleInput = new TextInputBuilder()
    .setCustomId('tryout_role_name')
    .setLabel('Verilecek Seviye Rolü Adı')
    .setPlaceholder('Örn: Low weak 4, Mid strong 2, High stable 1, High strong 0')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(60)
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('tryout_description')
    .setLabel('Değerlendirme Açıklaması')
    .setPlaceholder('Oyuncunun maç performansı, komboları, refleksleri ve genel oyun analizi...')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(3)
    .setMaxLength(4000)
    .setRequired(true);

  const improvementsInput = new TextInputBuilder()
    .setCustomId('tryout_improvements')
    .setLabel('Geliştirilmesi Gereken Yönler')
    .setPlaceholder('Oyuncunun bir üst seviyeye çıkması için geliştirmesi gereken yönler...')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(3)
    .setMaxLength(4000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(roleInput),
    new ActionRowBuilder().addComponents(descriptionInput),
    new ActionRowBuilder().addComponents(improvementsInput)
  );

  return interaction.showModal(modal);
}

/**
 * 3. Adım: Yetkili Değerlendirme Formunu (Modal) gönderdiğinde çalışır
 */
async function handleTryoutModalSubmit(interaction, targetUserId) {
  if (!hasTryoutPermission(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: `❌ Bu işlemi sadece <@&${config.ROLES.TRYOUT_STAFF}> yetkilileri yapabilir!`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const rawRoleInput = interaction.fields.getTextInputValue('tryout_role_name').trim();
  const description = interaction.fields.getTextInputValue('tryout_description').trim();
  const improvements = interaction.fields.getTextInputValue('tryout_improvements').trim();

  // 1. Üyeyi Sunucuda Bul
  const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (!targetMember) {
    return interaction.editReply({
      content: '❌ Değerlendirilen kullanıcı sunucuda bulunamadı!',
    });
  }

  // 2. Rol Adını Çözümle (Yazım hatalarını düzelt)
  const resolvedRole = resolveLevelRole(rawRoleInput);
  if (!resolvedRole) {
    return interaction.editReply({
      content:
        `❌ **Seviye Rolü Bulunamadı!**\n` +
        `Yazdığınız rol adı (\`${rawRoleInput}\`) hiçbir aşamalı seviye rolüyle eşleşmedi.\n\n` +
        `📌 **Örnek Doğru Kullanımlar:**\n` +
        `• \`Low weak 4\`, \`Low stable 3\`, \`Low strong 1\`\n` +
        `• \`Mid weak 3\`, \`Mid stable 2\`, \`Mid strong 1\`\n` +
        `• \`High weak 2\`, \`High stable 1\`, \`High strong 0\``,
    });
  }

  // 3. Kullanıcının Mevcut Seviye Rolünü Tespit Et
  const existingMemberRoles = getMemberCurrentLevelRoles(targetMember);
  const existingStats = database.getTryoutStats(targetUserId);

  let previousRole = existingMemberRoles[0] || null;
  if (!previousRole && existingStats && existingStats.roleId) {
    previousRole = getLevelRoleById(existingStats.roleId);
  }

  // 4. Eski Seviye Rollerini Sil ve Yeni Seviye Rolünü Ekle
  try {
    const rolesToRemove = targetMember.roles.cache
      .filter((r) => LEVEL_ROLE_IDS.has(r.id) && r.id !== resolvedRole.id)
      .map((r) => r.id);

    if (rolesToRemove.length > 0) {
      await targetMember.roles.remove(
        rolesToRemove,
        `Tryout Değerlendirmesi: Eski seviye rolü kaldırıldı (Yetkili: ${interaction.user.tag})`
      );
    }

    if (!targetMember.roles.cache.has(resolvedRole.id)) {
      await targetMember.roles.add(
        resolvedRole.id,
        `Tryout Değerlendirmesi: ${resolvedRole.name} verildi (Yetkili: ${interaction.user.tag})`
      );
    }
  } catch (roleErr) {
    console.error('[TRYOUT ROL HATASI]:', roleErr);
    return interaction.editReply({
      content:
        `❌ Kullanıcıya seviye rolü (<@&${resolvedRole.id}>) verilirken yetki hatası oluştu!\n` +
        `Lütfen botun rolünün seviye rollerinin üzerinde olduğundan emin olun. (\`${roleErr.message}\`)`,
    });
  }

  // 5. Benzersiz Form Kodu Üret ve Veritabanına Kaydet
  const formCode = database.generateFormCode();
  const previousRoleId = previousRole ? previousRole.id : null;
  const previousLevel = previousRole ? previousRole.level : 0;

  const { stats } = database.addTryoutEvaluation({
    formCode,
    userId: targetUserId,
    staffId: interaction.user.id,
    previousRoleId,
    previousLevel,
    newRoleId: resolvedRole.id,
    newLevel: resolvedRole.level,
    rawRoleInput,
    description,
    improvements,
    resultMessageId: null,
    resultChannelId: config.CHANNELS.TRYOUT_RESULT,
    createdAt: Date.now(),
  });

  // 6. Anket Sonucunu 1563218527584788560 Kanalına Gönder (Rengi Lacivert, Alt Yazıda Form Kodu)
  const resultChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.TRYOUT_RESULT) ||
    (await interaction.guild.channels.fetch(config.CHANNELS.TRYOUT_RESULT).catch(() => null));

  let statusDiffText = '🆕 **İlk Seviye Belirlemesi**';
  if (previousRole) {
    if (resolvedRole.level > previousRole.level) {
      statusDiffText = `📈 **Seviye Atladı!** (<@&${previousRole.id}> ➔ <@&${resolvedRole.id}>)`;
    } else if (resolvedRole.level < previousRole.level) {
      statusDiffText = `📉 **Seviye Düştü** (<@&${previousRole.id}> ➔ <@&${resolvedRole.id}>)`;
    } else {
      statusDiffText = `⚖️ **Seviye Korundu** (<@&${resolvedRole.id}>)`;
    }
  }

  const descFields = createChunkedFields('📝 Değerlendirme Açıklaması', description);
  const impFields = createChunkedFields('🎯 Geliştirilmesi Gereken Yönler', improvements);

  const resultEmbed = new EmbedBuilder()
    .setTitle(`${config.EMOJIS.KING} Piyade Team | TSB | Tryout Değerlendirme Raporu`)
    .setColor(config.COLORS.NAVY) // Lacivert
    .setThumbnail(targetMember.user.displayAvatarURL({ size: 256 }))
    .setDescription(
      `${PURPLE_DIVIDER}\n` +
      `👤 **Değerlendirilen Oyuncu:** <@${targetUserId}> (\`${targetMember.displayName}\`)\n` +
      `👮 **Değerlendiren Yetkili:** <@${interaction.user.id}>\n` +
      `🏅 **Verilen Seviye Rolü:** <@&${resolvedRole.id}> \`[Kademe: ${resolvedRole.level}/37]\`\n` +
      `📊 **Değerlendirme Durumu:** ${statusDiffText}\n` +
      `📋 **Toplam Değerlendirme Sayısı:** \`${stats.formCount}. Form\`\n` +
      `${PURPLE_DIVIDER}`
    )
    .addFields(...descFields, ...impFields, {
      name: '🔖 Form Bilgisi & Kodu',
      value: `-# <:240274moderator:1559920704009408622> **Form Kodu:** \`${formCode}\` • *Hatalıysa \`/form-iptal ${formCode}\` ile geri alınabilir.*`,
      inline: false,
    })
    .setFooter({
      text: `Form Kodu: ${formCode} • Piyade Team | Tryout Değerlendirmesi`,
    })
    .setTimestamp();

  if (resultChannel) {
    try {
      const sentResultMsg = await resultChannel.send({
        content: `<@${targetUserId}>`,
        embeds: [resultEmbed],
      });

      // Mesaj ID'sini forma kaydet (İptal edilirse silinebilmesi için)
      const savedForm = database.getTryoutForm(formCode);
      if (savedForm) {
        savedForm.resultMessageId = sentResultMsg.id;
        database.save();
      }
    } catch (resErr) {
      console.error('[TRYOUT SONUÇ KANALI HATASI]:', resErr.message);
    }
  }

  // 7. Seviye Atlama / Değişim Logunu 1562031846295076874 Kanalına Gönder
  const logChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.TRYOUT_LOG) ||
    (await interaction.guild.channels.fetch(config.CHANNELS.TRYOUT_LOG).catch(() => null));

  if (logChannel) {
    try {
      const isLevelUp = !previousRole || resolvedRole.level > previousRole.level;
      const isSameLevel = previousRole && resolvedRole.level === previousRole.level;

      let logTitle = '📈 Üye Seviye Atladı!';
      let logColor = config.COLORS.SUCCESS;
      let logBody = '';

      if (!previousRole) {
        logTitle = '🆕 İlk Seviye Yerleştirmesi Yapıldı!';
        logColor = config.COLORS.NAVY;
        logBody =
          `👤 <@${targetUserId}> adlı üye ilk değerlendirmesini tamamlayarak **Seviyesiz** durumundan <@&${resolvedRole.id}> (**Seviye ${resolvedRole.level}/37**) seviyesine çıkmıştır!\n\n` +
          `• **Önceki Seviyesi:** \`Yok (İlk Değerlendirme)\`\n` +
          `• **Yeni Seviyesi:** <@&${resolvedRole.id}> (\`${resolvedRole.name}\`)\n` +
          `• **Değerlendiren Yetkili:** <@${interaction.user.id}>\n` +
          `• **Form Kodu:** \`${formCode}\``;
      } else if (isLevelUp) {
        logTitle = '🎉 Üye Seviye Atladı!';
        logColor = config.COLORS.SUCCESS;
        logBody =
          `🚀 <@${targetUserId}> adlı üye <@&${previousRole.id}> seviyesinden <@&${resolvedRole.id}> seviyesine çıkmıştır!\n\n` +
          `• **Önceki Seviyesi:** <@&${previousRole.id}> (\`Kademe ${previousRole.level}/37\`)\n` +
          `• **Yeni Seviyesi:** <@&${resolvedRole.id}> (\`Kademe ${resolvedRole.level}/37\`)\n` +
          `• **Değerlendiren Yetkili:** <@${interaction.user.id}>\n` +
          `• **Form Kodu:** \`${formCode}\``;
      } else if (!isSameLevel) {
        logTitle = '📉 Üye Seviyesi Güncellendi';
        logColor = config.COLORS.GOLD_ORANGE;
        logBody =
          `⚠️ <@${targetUserId}> adlı üyenin seviyesi <@&${previousRole.id}> seviyesinden <@&${resolvedRole.id}> seviyesine güncellenmiştir.\n\n` +
          `• **Önceki Seviyesi:** <@&${previousRole.id}> (\`Kademe ${previousRole.level}/37\`)\n` +
          `• **Yeni Seviyesi:** <@&${resolvedRole.id}> (\`Kademe ${resolvedRole.level}/37\`)\n` +
          `• **Değerlendiren Yetkili:** <@${interaction.user.id}>\n` +
          `• **Form Kodu:** \`${formCode}\``;
      }

      if (logBody) {
        const logEmbed = new EmbedBuilder()
          .setTitle(logTitle)
          .setColor(logColor)
          .setThumbnail(targetMember.user.displayAvatarURL({ size: 128 }))
          .setDescription(logBody)
          .setFooter({ text: `Form Kodu: ${formCode} • Piyade Team Seviye Log Sistemi` })
          .setTimestamp();

        await logChannel.send({
          content: `<@${targetUserId}>`,
          embeds: [logEmbed],
        });
      }
    } catch (logErr) {
      console.error('[TRYOUT LOG KANALI HATASI]:', logErr.message);
    }
  }

  // 8. Sıralama Tablosunu (1563212550332612700) Anında Güncelle
  await updateTryoutLeaderboard(interaction.guild);

  const correctedNotice =
    normalizeRoleText(rawRoleInput) !== normalizeRoleText(resolvedRole.name)
      ? `\n*(Yazdığınız \`${rawRoleInput}\` ifadesi otomatik olarak **${resolvedRole.name}** rolüne eşleştirildi)*`
      : '';

  return interaction.editReply({
    content:
      `✅ **Değerlendirme Başarıyla Tamamlandı!**\n\n` +
      `• **Oyuncu:** <@${targetUserId}>\n` +
      `• **Verilen Rol:** <@&${resolvedRole.id}>${correctedNotice}\n` +
      `• **Form Sayısı:** \`${stats.formCount}\`\n` +
      `• **Form Kodu:** \`${formCode}\`\n\n` +
      `📌 Rapor <#${config.CHANNELS.TRYOUT_RESULT}> kanalında paylaşıldı ve <#${config.CHANNELS.TRYOUT_LEADERBOARD}> sıralama tablosu güncellendi!`,
  });
}

/**
 * Hatalı bir formu iptal eder, verilen rolü geri alır ve önceki rolü kullanıcıya iade eder (/form-iptal)
 */
async function handleCancelFormCommand(interaction, rawFormCode) {
  if (!interaction.member.roles.cache.has(config.ROLES.TRYOUT_STAFF)) {
    return interaction.reply({
      content: `❌ Bu komutu sadece <@&${config.ROLES.TRYOUT_STAFF}> rolüne sahip yetkililer kullanabilir!`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const form = database.getTryoutForm(rawFormCode);
  if (!form) {
    return interaction.editReply({
      content: `❌ **\`${rawFormCode}\`** koduna sahip herhangi bir değerlendirme formu bulunamadı! Lütfen kodu doğru yazdığınızdan emin olun (Örn: \`TRY-4821\`).`,
    });
  }

  if (form.cancelled) {
    return interaction.editReply({
      content: `⚠️ **\`${form.formCode}\`** kodlu form zaten daha önce (<@${form.cancelledBy}> tarafından) iptal edilmiş!`,
    });
  }

  // 1. Veritabanında formu iptal et ve istatistiği geri sar
  const cancelledForm = database.cancelTryoutForm(form.formCode, interaction.user.id);
  const targetMember = await interaction.guild.members.fetch(form.userId).catch(() => null);

  // 2. Discord Üzerinde Rolleri Geri Al ve Önceki Rolü İade Et
  let roleRestoreStatus = '';
  if (targetMember) {
    try {
      // Verilen yeni rolü (ve diğer seviye rollerini) kaldır
      const rolesToRemove = targetMember.roles.cache
        .filter((r) => LEVEL_ROLE_IDS.has(r.id) && r.id !== form.previousRoleId)
        .map((r) => r.id);

      if (rolesToRemove.length > 0) {
        await targetMember.roles.remove(
          rolesToRemove,
          `Form İptal Edildi (${form.formCode}) - Yetkili: ${interaction.user.tag}`
        );
      }

      // Önceki rolü varsa geri ver
      if (form.previousRoleId && interaction.guild.roles.cache.has(form.previousRoleId)) {
        await targetMember.roles.add(
          form.previousRoleId,
          `Form İptal Edildi (${form.formCode}) - Önceki rol iade edildi`
        );
        roleRestoreStatus = `Verilen <@&${form.newRoleId}> rolü geri alındı ve önceki rolü olan <@&${form.previousRoleId}> iade edildi.`;
      } else {
        roleRestoreStatus = `Verilen <@&${form.newRoleId}> rolü geri alındı (Öncesinde seviye rolü bulunmuyordu).`;
      }
    } catch (roleErr) {
      console.error('[FORM İPTAL ROL HATASI]:', roleErr.message);
      roleRestoreStatus = `⚠️ Rol geri alınırken Discord yetki hatası oluştu: ${roleErr.message}`;
    }
  } else {
    roleRestoreStatus = `⚠️ Kullanıcı (<@${form.userId}>) şu an sunucuda bulunamadığı için sadece tablo verisi geri alındı.`;
  }

  // 3. Sonuç Kanalındaki (1563218527584788560) Rapor Mesajını Sil veya İptal Olarak İşaretle
  if (form.resultMessageId) {
    const resultChannel =
      interaction.guild.channels.cache.get(form.resultChannelId || config.CHANNELS.TRYOUT_RESULT) ||
      (await interaction.guild.channels.fetch(config.CHANNELS.TRYOUT_RESULT).catch(() => null));

    if (resultChannel) {
      const resultMsg = await resultChannel.messages.fetch(form.resultMessageId).catch(() => null);
      if (resultMsg) {
        await resultMsg.delete().catch(async () => {
          // Silinemezse içeriğini "İptal Edildi" olarak düzenle
          const cancelledEmbed = new EmbedBuilder()
            .setTitle(`✖️ Tryout Formu İptal Edildi (${form.formCode})`)
            .setColor(config.COLORS.DANGER)
            .setDescription(
              `Bu değerlendirme formu <@${interaction.user.id}> tarafından \`/form-iptal\` komutu ile iptal edilmiş ve geri alınmıştır.`
            )
            .setTimestamp();
          await resultMsg.edit({ embeds: [cancelledEmbed] }).catch(() => {});
        });
      }
    }
  }

  // 4. Seviye Log Kanalına (1562031846295076874) İptal Bilgisini Gönder
  const logChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.TRYOUT_LOG) ||
    (await interaction.guild.channels.fetch(config.CHANNELS.TRYOUT_LOG).catch(() => null));

  if (logChannel) {
    const cancelLogEmbed = new EmbedBuilder()
      .setTitle(`↩️ Değerlendirme Formu İptal Edildi (${form.formCode})`)
      .setColor(config.COLORS.DANGER)
      .setDescription(
        `<@${form.userId}> kullanıcısına ait **\`${form.formCode}\`** kodlu değerlendirme formu iptal edildi.\n\n` +
        `• **İptal Eden Yetkili:** <@${interaction.user.id}>\n` +
        `• **Geri Alınan Rol:** <@&${form.newRoleId}>\n` +
        `• **İade Edilen Önceki Rol:** ${form.previousRoleId ? `<@&${form.previousRoleId}>` : '`Yok`'}\n` +
        `• **Durum:** ${roleRestoreStatus}`
      )
      .setFooter({ text: `Form Kodu: ${form.formCode} • Piyade Team Seviye Log Sistemi` })
      .setTimestamp();

    await logChannel.send({ embeds: [cancelLogEmbed] }).catch(() => {});
  }

  // 5. Sıralama Tablosunu (1563212550332612700) Güncelle
  await updateTryoutLeaderboard(interaction.guild);

  return interaction.editReply({
    content:
      `✅ **\`${cancelledForm.formCode}\` Kodlu Form Başarıyla İptal Edildi!**\n\n` +
      `• **Oyuncu:** <@${form.userId}>\n` +
      `• **İşlem:** ${roleRestoreStatus}\n` +
      `• **Tablo:** <#${config.CHANNELS.TRYOUT_LEADERBOARD}> sıralama tablosu ve rapor mesajı güncellendi.`,
  });
}

module.exports = {
  resolveLevelRole,
  getLevelRoleById,
  createTryoutPanel,
  createTryoutLeaderboardEmbed,
  updateTryoutLeaderboard,
  handleTryoutStart,
  handleTryoutUserSelected,
  handleTryoutModalSubmit,
  handleCancelFormCommand,
};
