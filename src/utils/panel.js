const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../config');
const gamesConfig = require('../../games.config');

/**
 * Kayıt Kanalı Panel Mesajını ve Butonlarını Mavi Embed Olarak Üretir.
 */
function createRegisterPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🛡️ ${config.BRAND_NAME} | Kayıt Sistemi`)
    .setColor(config.COLORS.BLUE) // 0x0099FF Canlı Mavi
    .setDescription(
      `***\n\n` +
      `## 📋 Nasıl Kayıt Olunur?\n\n` +
      `Sunucumuza hoş geldiniz! Topluluğumuzun bir parçası olmak, oynadığınız oyunlara özel kanallara katılmak ve üye rollerinizi almak için aşağıdaki adımları izleyin:\n\n` +
      `> **1️⃣ Adım:** Aşağıda yer alan **"✅ Kayıt Ol"** butonuna tıklayın.\n` +
      `> \n` +
      `> **2️⃣ Adım:** Açılan ekrandan oynadığınız oyunları seçin (**🎮 Roblox, 💣 CS2, 🔫 Zula, ⛏️ Minecraft** — birden fazla oyun seçebilirsiniz) ve **Cinsiyetinizi** (**👨 Erkek** / **👩 Kız**) belirleyin.\n` +
      `> \n` +
      `> **3️⃣ Adım:** Açılan ankete **Adınızı (veya Takma Adınızı)** ve seçtiğiniz oyunlardaki **kullanıcı adlarınızı** yazın.\n` +
      `> \n` +
      `> **4️⃣ Adım:** Roblox oynuyorsanız hesabınız otomatik doğrulanır ve size özel bir kayıt odası açılır.\n` +
      `> \n` +
      `> **5️⃣ Adım:** Yetkili ekibimiz onayladığında oyun rolleriniz, cinsiyet rolünüz, <@&${config.ROLES.VERIFIED}> ve <@&${config.ROLES.REGISTERED_CHECK}> rolleriniz otomatik tanımlanır!\n\n` +
      `### ⚠️ Önemli Kurallar & Uyarılar\n` +
      `• **Roblox Doğrulaması:** Roblox seçtiyseniz lütfen görünen adınızı (Display Name) değil, asıl **\`@kullanıcı\`** adınızı, ID'nizi veya profil linkinizi giriniz. Geçersiz hesaplar otomatik reddedilir.\n` +
      `• **Multi-Hesap Koruması:** Sunucumuzda **1 Discord Hesabı = 1 Roblox Hesabı** kuralı geçerlidir.\n` +
      `• **Arkadaş Ekleme (\`/profilim\`):** Kayıt olduktan sonra herhangi bir sohbet kanalında **\`/profilim\`** yazarak oyun bilgilerinizi diğer üyelerle paylaşabilirsiniz!\n\n` +
      `***`
    )
    .setFooter({
      text: `🛡️ ${config.BRAND_NAME} Kayıt Sistemi • Çoklu Oyun & Güvenli Doğrulama • ${new Date().toLocaleDateString('tr-TR')}`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_kayit_ol')
      .setLabel('✅ Kayıt Ol')
      .setStyle(ButtonStyle.Primary),
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
    .setTitle(`🛡️ ${config.BRAND_NAME} | Registration Guide (EN)`)
    .setColor(config.COLORS.BLUE)
    .setDescription(
      `***\n\n` +
      `## 📋 How to Register?\n\n` +
      `Welcome to **${config.BRAND_NAME}**! Follow these steps to verify your account, pick your games, and unlock member channels:\n\n` +
      `> **1️⃣ Step:** Click **"Register"** below.\n` +
      `> \n` +
      `> **2️⃣ Step:** Choose the games you play (**🎮 Roblox, 💣 CS2, 🔫 Zula, ⛏️ Minecraft** — multiple selections supported) and select your **Gender** (**👨 Male** or **👩 Female**).\n` +
      `> \n` +
      `> **3️⃣ Step:** Fill out the form with your **Name / Nickname** and your in-game usernames for the games you selected.\n` +
      `> \n` +
      `> **4️⃣ Step:** If you play Roblox, our system automatically verifies your profile and opens a private registration thread.\n` +
      `> \n` +
      `> **5️⃣ Step:** Once approved by staff, your game roles, gender role, member roles, and **🇬🇧 English** role will be assigned automatically! You can also share your profile with \`/profilim\`.\n\n` +
      `### ⚠️ Important Rules\n` +
      `• **Roblox Verification:** Enter your actual Roblox **\`@username\`**, User ID, or profile URL — **not** your Display Name. Invalid accounts will be rejected.\n` +
      `• **One Account Rule:** **1 Discord Account = 1 Roblox Account**.\n\n` +
      `***`
    )
    .setFooter({
      text: `🛡️ ${config.BRAND_NAME} Registration System • English Support`,
    });
}

/**
 * Kayıt Adım 1 & 2: Çoklu Oyun Seçimi (1 butona 1 kere) + Cinsiyet Seçimi Etkileşim Kartını Üretir.
 * Durum (state) customId içinde taşındığından bot yeniden başlasa bile bozulmaz.
 */
function buildGameAndGenderSelectionPayload(state = {}) {
  const cleanState = {
    games: gamesConfig.normalizeGameList(state.games || []),
    gender: state.gender === 'm' || state.gender === 'f' ? state.gender : 'u',
    lang: state.lang === 'en' ? 'en' : 'tr',
  };

  const isEn = cleanState.lang === 'en';
  const stateStr = gamesConfig.encodeRegState(cleanState);
  const enabledGames = gamesConfig.getEnabledGames();

  const selectedGamesText =
    cleanState.games.length > 0
      ? cleanState.games
          .map((id) => {
            const g = gamesConfig.getGameById(id);
            return g ? `✅ ${g.emoji} **${g.name[cleanState.lang]}**` : id;
          })
          .join('\n')
      : isEn
      ? '⏳ *No games selected yet (Select at least 1 game)*'
      : '⏳ *Henüz oyun seçilmedi (En az 1 oyun seçiniz)*';

  let selectedGenderText = isEn ? '⏳ *Not selected yet*' : '⏳ *Henüz seçilmedi*';
  if (cleanState.gender === 'm') {
    selectedGenderText = isEn ? '✅ 👨 **Male**' : '✅ 👨 **Erkek**';
  } else if (cleanState.gender === 'f') {
    selectedGenderText = isEn ? '✅ 👩 **Female**' : '✅ 👩 **Kız**';
  }

  const isReady = cleanState.games.length > 0 && (cleanState.gender === 'm' || cleanState.gender === 'f');

  const embed = new EmbedBuilder()
    .setTitle(
      isEn
        ? `🎮 ${config.BRAND_NAME} | Step 1 & 2: Games & Gender`
        : `🎮 ${config.BRAND_NAME} | Adım 1 & 2: Oyunlar ve Cinsiyet`
    )
    .setColor(isReady ? config.COLORS.SUCCESS : config.COLORS.BLUE)
    .setDescription(
      isEn
        ? `Please select the games you play and your gender below before opening the registration form:\n\n` +
          `• **Games:** You can select multiple games (each game button can be clicked once; use **Reset** to clear).\n` +
          `• **Gender:** Your gender role will be granted after approval.\n` +
          `• When both steps are ready, click **"📝 Open Form"**!`
        : `Kayıt anketini açmadan önce lütfen aşağıdan oynadığınız oyunları ve cinsiyetinizi seçiniz:\n\n` +
          `• **Oyunlar:** Birden fazla oyun seçebilirsiniz *(her oyun butonuna 1 kere basılır; değiştirmek için **Sıfırla**'yı kullanın)*.\n` +
          `• **Cinsiyet:** Kayıt onaylandıktan sonra seçiminize göre cinsiyet rolünüz verilecektir.\n` +
          `• İki adım da tamamlandığında **"📝 Kayıt Formunu Aç"** butonuna tıklayın!`
    )
    .addFields(
      {
        name: isEn ? '🎯 Selected Games' : '🎯 Seçilen Oyunlar',
        value: selectedGamesText,
        inline: true,
      },
      {
        name: isEn ? '🚻 Selected Gender' : '🚻 Seçilen Cinsiyet',
        value: selectedGenderText,
        inline: true,
      }
    )
    .setFooter({
      text: isReady
        ? isEn
          ? '✅ Ready! Click "Open Form" to continue.'
          : '✅ Hazır! Devam etmek için "Kayıt Formunu Aç" butonuna tıklayın.'
        : isEn
        ? 'Select at least 1 game and your gender to continue.'
        : 'Devam etmek için en az 1 oyun ve cinsiyet seçin.',
    });

  // Satır 1: Oyun Butonları (max 4) + Sıfırla Butonu
  const gameButtons = enabledGames.slice(0, 4).map((game) => {
    const isSelected = cleanState.games.includes(game.id);
    return new ButtonBuilder()
      .setCustomId(`reg_act:${stateStr}:g_${game.id}`)
      .setLabel(isSelected ? `${game.name[cleanState.lang]} ✓` : game.name[cleanState.lang])
      .setEmoji(game.emoji)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(isSelected);
  });

  const resetBtn = new ButtonBuilder()
    .setCustomId(`reg_act:${stateStr}:reset`)
    .setLabel(isEn ? 'Reset' : 'Sıfırla')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(cleanState.games.length === 0);

  const row1 = new ActionRowBuilder().addComponents(...gameButtons, resetBtn);

  // Satır 2: Cinsiyet Butonları + Formu Aç Butonu
  const maleBtn = new ButtonBuilder()
    .setCustomId(`reg_act:${stateStr}:sex_m`)
    .setLabel(cleanState.gender === 'm' ? (isEn ? 'Male ✓' : 'Erkek ✓') : isEn ? 'Male' : 'Erkek')
    .setEmoji('👨')
    .setStyle(cleanState.gender === 'm' ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const femaleBtn = new ButtonBuilder()
    .setCustomId(`reg_act:${stateStr}:sex_f`)
    .setLabel(cleanState.gender === 'f' ? (isEn ? 'Female ✓' : 'Kız ✓') : isEn ? 'Female' : 'Kız')
    .setEmoji('👩')
    .setStyle(cleanState.gender === 'f' ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const openFormBtn = new ButtonBuilder()
    .setCustomId(`reg_act:${stateStr}:open`)
    .setLabel(isEn ? 'Open Form' : 'Kayıt Formunu Aç')
    .setEmoji('📝')
    .setStyle(isReady ? ButtonStyle.Success : ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(maleBtn, femaleBtn, openFormBtn);

  return {
    content: '',
    embeds: [embed],
    components: [row1, row2],
  };
}

/**
 * Seçilen oyunlara ve cinsiyete göre dinamik Discord Kayıt Anketi (Modal) üretir.
 * Discord API sınırı gereği en fazla 5 alan içerir: 1 Ad/Takma Ad + en fazla 4 oyun kullanıcı adı.
 */
function buildRegistrationModal(state = {}) {
  const cleanGames = gamesConfig.normalizeGameList(state.games || []);
  const gender = state.gender === 'm' || state.gender === 'f' ? state.gender : 'm';
  const lang = state.lang === 'en' ? 'en' : 'tr';
  const isEn = lang === 'en';

  const stateStr = gamesConfig.encodeRegState({ games: cleanGames, gender, lang });
  const modalTitle = isEn
    ? `${config.BRAND_NAME} | Registration Form`
    : `${config.BRAND_NAME} | Kayıt Anketi`;

  const modal = new ModalBuilder()
    .setCustomId(`modal_kayit:${stateStr}`)
    .setTitle(modalTitle.slice(0, 45));

  // 1. Zorunlu Soru: Ad / Takma Ad
  const nameInput = new TextInputBuilder()
    .setCustomId('modal_real_name')
    .setLabel(isEn ? 'May we know your name?' : 'Adını öğrenebilir miyiz?')
    .setPlaceholder(
      isEn
        ? 'You can enter a nickname if you prefer not to share.'
        : 'İsmini yazmak istemiyorsan takma ad koyabilirsin.'
    )
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(32)
    .setRequired(true);

  const rows = [new ActionRowBuilder().addComponents(nameInput)];

  // 2..5. Seçilen her oyun için kullanıcı adı sorusu (En fazla 4 oyun -> toplam max 5 satır)
  for (const gameId of cleanGames.slice(0, 4)) {
    const game = gamesConfig.getGameById(gameId);
    if (!game) continue;

    const gameInput = new TextInputBuilder()
      .setCustomId(`modal_game_${game.id}`)
      .setLabel(game.questionLabel[lang].slice(0, 45))
      .setPlaceholder(game.placeholder[lang].slice(0, 100))
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(game.maxLength || 64)
      .setRequired(true);

    rows.push(new ActionRowBuilder().addComponents(gameInput));
  }

  modal.addComponents(rows);
  return modal;
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
  buildGameAndGenderSelectionPayload,
  buildRegistrationModal,
  ensureRegisterPanelMessage,
};
