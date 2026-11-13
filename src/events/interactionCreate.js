const {
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const database = require('../utils/database');
const robloxService = require('../services/roblox');
const { createEnglishRegisterGuideEmbed } = require('../utils/panel');
const { handleHelpRequest, createEnglishHelpGuideEmbed } = require('../utils/helpManager');
const {
  handleTryoutStart,
  handleTryoutUserSelected,
  handleTryoutModalSubmit,
  createEnglishTryoutPanelEmbed,
  createEnglishTryoutLeaderboardEmbed,
  handleTryoutReportEnglishButton,
} = require('../utils/tryoutManager');
const { handleColorButton, createEnglishColorGuideEmbed } = require('../utils/colorManager');
const {
  handleWarningButton,
  handleWarningUserSelected,
  handleVerbalWarnModalSubmit,
  handleOfficialWarnModalSubmit,
  handleProofButton,
  handleWarningLogEnglishButton,
} = require('../utils/warningManager');
const { createRegistrationApplication } = require('../services/registrationService');
const { resolveLang, setMemberLanguage, parseGenderInput } = require('../utils/i18n');
const clanMatcher = require('../utils/clanMatcher');

// Eşzamanlı işlem kilitleri (Bellek içi kilitler)
const approvalUserLocks = new Set();
const clanRoleCreationLocks = new Set();

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      // 0. AUTOCOMPLETE ETKİLEŞİMLERİ (/klan-duzenle, /klan-sil vb.)
      if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command && typeof command.autocomplete === 'function') {
          await command.autocomplete(interaction);
        }
        return;
      }

      // 1. SLASH KOMUTLAR
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      // 2. BUTON ETKİLEŞİMLERİ
      if (interaction.isButton()) {
        // [A] "✅ Kayıt Ol" ve "🇬🇧 Register (English)" Paneli Butonları
        if (interaction.customId === 'btn_kayit_ol' || interaction.customId === 'btn_kayit_ol_en') {
          const isEnClick = interaction.customId === 'btn_kayit_ol_en';
          if (isEnClick) {
            await setMemberLanguage(interaction.member, 'en').catch(() => {});
          }
          const isEn = isEnClick || resolveLang(interaction) === 'en';

          // Kontrol 1: Zaten Kayıtlı mı? (Piyade veya Diğer Klan)
          if (config.isRegisteredMember(interaction.member)) {
            const hasOtherClan = Boolean(
              config.ROLES?.OTHER_CLAN && interaction.member.roles.cache.has(config.ROLES.OTHER_CLAN)
            );
            return interaction.reply({
              content: hasOtherClan
                ? (isEn
                    ? '❌ You are already registered (Other Clan member). Please contact staff to switch to Piyade Clan.'
                    : '❌ Zaten kayıtlısınız (Diğer Klan üyesi). Piyade Klanına geçmek için yetkililere ulaşın.')
                : (isEn
                    ? '❌ You are already registered on our server! You cannot submit another application.'
                    : '❌ Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.'),
              ephemeral: true,
            });
          }

          // Kontrol 2: Aktif Başvurusu Var mı?
          const activeApp = database.getActiveApplication(interaction.user.id);
          if (activeApp && activeApp.threadId) {
            const existingThread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
            if (existingThread) {
              return interaction.reply({
                content: isEn
                  ? `⚠️ You already have an active registration application! Please check your registration thread: <#${activeApp.threadId}>`
                  : `⚠️ Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
                ephemeral: true,
              });
            } else {
              database.removeActiveApplication(interaction.user.id);
            }
          }

          // Kayıt Türü Seçimi (Ephemeral 2 Buton)
          const typeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(isEn ? 'btn_reg_type_own_en' : 'btn_reg_type_own')
              .setLabel(isEn ? '🛡️ I Want to Join the Piyade Clan' : '🛡️ Piyade Klanına Katılmak İstiyorum')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(isEn ? 'btn_reg_type_other_en' : 'btn_reg_type_other')
              .setLabel(isEn ? '🏳️ I Already Have a Clan' : '🏳️ Bir Klanım Bulunmakta')
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.reply({
            content: isEn
              ? `👋 Welcome <@${interaction.user.id}>! First, choose your registration type:\n\n` +
                `• **🛡️ I Want to Join the Piyade Clan:** Apply to become a member of our clan (Grants Member role).\n` +
                `• **🏳️ I Already Have a Clan:** Choose this if you belong to another clan (Grants Other Clan & Clan role; does NOT grant Registered Member role).`
              : `👋 Hoş geldin <@${interaction.user.id}>! Önce kayıt türünü seç:\n\n` +
                `• **🛡️ Piyade Klanına Katılmak İstiyorum:** Klanımıza katılmak için başvurursunuz (Kayıtlı Üye rolü verilir).\n` +
                `• **🏳️ Bir Klanım Bulunmakta:** Başka bir klandaysanız seçiniz (Diğer Klan ve klan rolü verilir, Kayıtlı Üye rolü verilmez).`,
            embeds: isEn ? [createEnglishRegisterGuideEmbed()] : [],
            components: [typeRow],
            ephemeral: true,
          });
        }

        // [A1] Kayıt Türü Seçildiğinde Cinsiyet Seçimini Getiren Butonlar
        if (
          interaction.customId === 'btn_reg_type_own' ||
          interaction.customId === 'btn_reg_type_own_en' ||
          interaction.customId === 'btn_reg_type_other' ||
          interaction.customId === 'btn_reg_type_other_en'
        ) {
          const isOther = interaction.customId.includes('other');
          const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
          if (isEn) {
            await setMemberLanguage(interaction.member, 'en').catch(() => {});
          }

          const selectCustomId = isOther
            ? (isEn ? 'select_gender_other_en' : 'select_gender_other')
            : (isEn ? 'select_gender_own_en' : 'select_gender_own');

          const genderSelect = new StringSelectMenuBuilder()
            .setCustomId(selectCustomId)
            .setPlaceholder(isEn ? 'Please select your gender...' : 'Lütfen Cinsiyetinizi Seçiniz...')
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Male' : 'Erkek')
                .setEmoji('👨')
                .setValue('gender_erkek')
                .setDescription(
                  isEn
                    ? (isOther ? 'Register as male member (Other Clan)' : 'Register as male member of Piyade Team')
                    : (isOther ? 'Diğer klan erkek üye kaydı' : 'Piyade Team bünyesine erkek üye olarak kayıt')
                ),
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Female' : 'Kız')
                .setEmoji('👩')
                .setValue('gender_kiz')
                .setDescription(
                  isEn
                    ? (isOther ? 'Register as female member (Other Clan)' : 'Register as female member of Piyade Team')
                    : (isOther ? 'Diğer klan kadın üye kaydı' : 'Piyade Team bünyesine kadın üye olarak kayıt')
                )
            );

          const row = new ActionRowBuilder().addComponents(genderSelect);

          return interaction.update({
            content: isEn
              ? `Selected: **${isOther ? '🏳️ Other Clan' : '🛡️ Piyade Clan'}**\nNow please select your **Gender** to open the registration form:`
              : `Seçilen Kayıt Türü: **${isOther ? '🏳️ Bir Klanım Bulunmakta' : '🛡️ Piyade Klanına Katılmak İstiyorum'}**\nKayıt formunu açmak için lütfen aşağıdan **Cinsiyetinizi** seçiniz:`,
            components: [row],
          });
        }

        // [A2] Yetkili Başka Klan Başvurusunda "🏷️ Klanı Düzenle" Butonuna Bastığında
        if (interaction.customId.startsWith('btn_clan_edit_')) {
          const isStaff =
            interaction.member.roles.cache.has(config.ROLES.STAFF) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.has(config.ROLES.TRYOUT_STAFF) ||
            interaction.member.roles.cache.has(config.ROLES.DEVELOPER);

          if (!isStaff) {
            return interaction.reply({
              content: '❌ Bu işlemi sadece yetkililer yapabilir!',
              ephemeral: true,
            });
          }

          const applicantId = interaction.customId.replace('btn_clan_edit_', '');
          const activeApp = database.getActiveApplication(applicantId);
          if (!activeApp || activeApp.registrationType !== 'other') {
            return interaction.reply({
              content: '❌ Aktif bir başka klan başvurusu bulunamadı!',
              ephemeral: true,
            });
          }

          const modal = new ModalBuilder()
            .setCustomId(`modal_clan_edit_${applicantId}`)
            .setTitle('Piyade Team | Klanı Düzenle');

          const clanInput = new TextInputBuilder()
            .setCustomId('modal_clan_name_edit')
            .setLabel('Klan Adı')
            .setValue(activeApp.clanTypedName || '')
            .setPlaceholder('Örn: Dark Wolves')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setMaxLength(32)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(clanInput));
          return interaction.showModal(modal);
        }

        // [A2] İNGİLİZCE REHBER BUTONLARI
        if (interaction.customId === 'btn_help_en_info') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishHelpGuideEmbed()],
            ephemeral: true,
          });
        }

        if (interaction.customId === 'btn_color_en_info') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishColorGuideEmbed()],
            ephemeral: true,
          });
        }

        if (interaction.customId === 'btn_tryout_panel_en') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishTryoutPanelEmbed()],
            ephemeral: true,
          });
        }

        if (interaction.customId === 'btn_tryout_leaderboard_en') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          const payload = createEnglishTryoutLeaderboardEmbed();
          return interaction.reply({
            ...payload,
            ephemeral: true,
          });
        }

        if (interaction.customId.startsWith('btn_tryout_report_en_')) {
          const formCode = interaction.customId.replace('btn_tryout_report_en_', '');
          return handleTryoutReportEnglishButton(interaction, formCode);
        }

        // [B] YETKİLİ KART BUTONU: ✅ ONAYLA
        if (interaction.customId.startsWith('btn_approve_')) {
          const applicantId = interaction.customId.replace('btn_approve_', '');
          return handleApprove(interaction, applicantId);
        }

        // [C] YETKİLİ KART BUTONU: ✖️ REDDET
        if (interaction.customId.startsWith('btn_reject_')) {
          const applicantId = interaction.customId.replace('btn_reject_', '');
          return handleRejectButton(interaction, applicantId);
        }

        // [G] ACİL YARDIM ÇAĞRISI BUTONU (btn_acil_yardim)
        if (interaction.customId === 'btn_acil_yardim') {
          return handleHelpRequest(interaction);
        }

        // [H] TRYOUT / SEVİYE DEĞERLENDİRME BUTONU (btn_tryout_degerlendir)
        if (interaction.customId === 'btn_tryout_degerlendir') {
          return handleTryoutStart(interaction);
        }

        // [I] İSİM RENGİ SEÇİM BUTONLARI (btn_color_...)
        if (interaction.customId.startsWith('btn_color_')) {
          const roleId = interaction.customId.replace('btn_color_', '');
          return handleColorButton(interaction, roleId);
        }

        // [J] UYARI SİSTEMİ: SÖZLÜ UYARI & RESMİ UYARI BUTONLARI
        if (interaction.customId === 'btn_warn_verbal') {
          return handleWarningButton(interaction, 'verbal');
        }
        if (interaction.customId === 'btn_warn_official') {
          return handleWarningButton(interaction, 'official');
        }

        // [K] UYARI SİSTEMİ: KANIT GÖRSELİ YÜKLE / PAS GEÇ BUTONLARI
        if (interaction.customId.startsWith('btn_warn_proof_upload_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_upload_', '');
          return handleProofButton(interaction, 'upload', warnId);
        }
        if (interaction.customId.startsWith('btn_warn_proof_skip_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_skip_', '');
          return handleProofButton(interaction, 'skip', warnId);
        }

        // [L] UYARI LOG KANALINDAKİ "🇬🇧 English" ÇEVİRİ BUTONU (1563923439121604720)
        if (interaction.customId.startsWith('btn_warn_log_en_')) {
          const warnId = interaction.customId.replace('btn_warn_log_en_', '');
          return handleWarningLogEnglishButton(interaction, warnId);
        }
      }

      // 3. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
      if (interaction.isStringSelectMenu()) {
        if (
          interaction.customId === 'select_gender' ||
          interaction.customId === 'select_gender_en' ||
          interaction.customId === 'select_gender_own' ||
          interaction.customId === 'select_gender_own_en' ||
          interaction.customId === 'select_gender_other' ||
          interaction.customId === 'select_gender_other_en'
        ) {
          const isOther = interaction.customId.includes('other');
          const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
          const selectedGender = interaction.values[0]; // 'gender_erkek' veya 'gender_kiz'

          const modalCustomId = isOther
            ? (isEn ? `modal_kayit_other_${selectedGender}_en` : `modal_kayit_other_${selectedGender}`)
            : (isEn ? `modal_kayit_own_${selectedGender}_en` : `modal_kayit_own_${selectedGender}`);

          const modalTitle = isOther
            ? (isEn ? 'Piyade Team | Registration (Other Clan)' : 'Piyade Team | Kayıt Formu (Başka Klan)')
            : (isEn ? 'Piyade Team | Registration Form' : 'Piyade Team | Kayıt Formu');

          const modal = new ModalBuilder()
            .setCustomId(modalCustomId)
            .setTitle(modalTitle.slice(0, 45));

          const nameInput = new TextInputBuilder()
            .setCustomId('modal_real_name')
            .setLabel(isEn ? 'What is your Real Name?' : 'Gerçek Adın Nedir?')
            .setPlaceholder(isEn ? 'e.g. John' : 'Örn: Ahmet Yılmaz')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setMaxLength(32)
            .setRequired(true);

          const robloxInput = new TextInputBuilder()
            .setCustomId('modal_roblox_input')
            .setLabel(isEn ? 'Roblox Username, ID, or Profile Link' : 'Roblox Adı, ID\'si veya Profil Linki')
            .setPlaceholder(isEn ? 'e.g. Builderman, 156, or profile link' : 'Örn: Builderman, 156 veya profil linki')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(120)
            .setRequired(true);

          const genderInput = new TextInputBuilder()
            .setCustomId('modal_gender')
            .setLabel(isEn ? 'Your Gender (Male / Female)' : 'Cinsiyetiniz (Erkek / Kız)')
            .setValue(
              selectedGender.includes('kiz')
                ? isEn ? 'Female' : 'Kız'
                : isEn ? 'Male' : 'Erkek'
            )
            .setPlaceholder(isEn ? 'Male or Female' : 'Erkek veya Kız')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(15)
            .setRequired(true);

          const rows = [
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(robloxInput),
            new ActionRowBuilder().addComponents(genderInput),
          ];

          if (isOther) {
            const clanInput = new TextInputBuilder()
              .setCustomId('modal_clan_name')
              .setLabel(isEn ? 'Which clan are you in?' : 'Hangi klandasın?')
              .setPlaceholder(isEn ? 'e.g. Dark Wolves' : 'Örn: Dark Wolves')
              .setStyle(TextInputStyle.Short)
              .setMinLength(2)
              .setMaxLength(32)
              .setRequired(true);

            rows.push(new ActionRowBuilder().addComponents(clanInput));
          }

          modal.addComponents(rows);
          return interaction.showModal(modal);
        }
      }

      // 4. USER SELECT MENU (TRYOUT & UYARI KULLANICI SEÇİMİ)
      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'select_tryout_user') {
          return handleTryoutUserSelected(interaction);
        }

        if (interaction.customId === 'select_warn_verbal_user') {
          return handleWarningUserSelected(interaction, 'verbal');
        }

        if (interaction.customId === 'select_warn_official_user') {
          return handleWarningUserSelected(interaction, 'official');
        }
      }

      // 5. MODAL GÖNDERİMLERİ (MODAL SUBMIT)
      if (interaction.isModalSubmit()) {
        // [A] Kullanıcı Kayıt Formu Gönderimi
        if (interaction.customId.startsWith('modal_kayit_')) {
          return handleRegistrationModalSubmit(interaction);
        }

        // [A1] Yetkili Klan Düzenleme Formu Gönderimi
        if (interaction.customId.startsWith('modal_clan_edit_')) {
          const applicantId = interaction.customId.replace('modal_clan_edit_', '');
          return handleClanEditModalSubmit(interaction, applicantId);
        }

        // [B] Yetkili Red Sebebi Formu Gönderimi
        if (interaction.customId.startsWith('modal_reject_staff_')) {
          const applicantId = interaction.customId.replace('modal_reject_staff_', '');
          return handleRejectModalSubmit(interaction, applicantId);
        }

        // [C] Tryout Seviye Değerlendirme Formu Gönderimi
        if (interaction.customId.startsWith('modal_tryout_eval_')) {
          const targetUserId = interaction.customId.replace('modal_tryout_eval_', '');
          return handleTryoutModalSubmit(interaction, targetUserId);
        }

        // [D] Sözlü Uyarı Formu Gönderimi
        if (interaction.customId.startsWith('modal_warn_verbal_')) {
          const targetUserId = interaction.customId.replace('modal_warn_verbal_', '');
          return handleVerbalWarnModalSubmit(interaction, targetUserId);
        }

        // [E] Resmi Uyarı (Madde No) Formu Gönderimi
        if (interaction.customId.startsWith('modal_warn_official_')) {
          const targetUserId = interaction.customId.replace('modal_warn_official_', '');
          return handleOfficialWarnModalSubmit(interaction, targetUserId);
        }
      }
    } catch (err) {
      console.error('[INTERACTION ERROR] Beklenmeyen hata:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Bir hata meydana geldi! Lütfen yetkililere danışın.',
          ephemeral: true,
        }).catch(() => {});
      }
    }
  },
};

// =========================================================================
// KAYIT SİSTEMİ FONKSİYONLARI
// =========================================================================

/**
 * Kullanıcı kayıt formunu doldurup gönderdiğinde çalışan ana fonksiyon.
 */
async function handleRegistrationModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const isEnModal =
    interaction.customId.startsWith('modal_kayit_en_') ||
    interaction.customId.endsWith('_en');
  const isEn = isEnModal || resolveLang(interaction) === 'en';
  const isOther = interaction.customId.includes('_other_');

  const realName = interaction.fields.getTextInputValue('modal_real_name').trim();
  const robloxInput = interaction.fields.getTextInputValue('modal_roblox_input').trim();

  let clanName = null;
  if (isOther) {
    try {
      clanName = interaction.fields.getTextInputValue('modal_clan_name')?.trim() || null;
    } catch (e) {}
  }

  // Formda yazılan cinsiyet okunuyor (Türkçe ve İngilizce girdileri destekler)
  let inputGender = '';
  try {
    inputGender = interaction.fields.getTextInputValue('modal_gender')?.trim() || '';
  } catch (e) {}

  const parsedGender = parseGenderInput(inputGender, interaction.customId);
  const gender = parsedGender.tr;

  const result = await createRegistrationApplication({
    guild: interaction.guild,
    member: interaction.member,
    user: interaction.user,
    realName,
    gender,
    robloxInput,
    registrationType: isOther ? 'other' : 'own',
    clanName,
    source: 'discord',
    lang: isEn ? 'en' : 'tr',
  });

  if (!result.success) {
    return interaction.editReply({
      content: `❌ ${result.message}`,
    });
  }

  return interaction.editReply({
    content: isEn
      ? `✅ Your registration application has been submitted! You can follow your application in your private thread: <#${result.threadId}>`
      : `✅ Başvurunuz başarıyla alındı! Size özel oluşturulan kayıt odasını takip edebilirsiniz: <#${result.threadId}>`,
  });
}

/**
 * Yetkili 🏷️ Klanı Düzenle modalını gönderdiğinde çalışan fonksiyon.
 */
async function handleClanEditModalSubmit(interaction, applicantId) {
  const isStaff =
    interaction.member.roles.cache.has(config.ROLES.STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.member.roles.cache.has(config.ROLES.TRYOUT_STAFF) ||
    interaction.member.roles.cache.has(config.ROLES.DEVELOPER);

  if (!isStaff) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece yetkililer yapabilir!',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const activeApp = database.getActiveApplication(applicantId);
  if (!activeApp || activeApp.registrationType !== 'other') {
    return interaction.editReply({
      content: '❌ Aktif bir başka klan başvurusu bulunamadı veya sonuçlanmış!',
    });
  }

  const rawClanName = interaction.fields.getTextInputValue('modal_clan_name_edit')?.trim() || '';
  const sanitized = clanMatcher.sanitizeClanName(rawClanName);
  if (!sanitized.valid) {
    return interaction.editReply({
      content:
        sanitized.error === 'CLAN_BLOCKED'
          ? '❌ Girdiğiniz klan adı uygunsuz içerik (etiket, link veya küfür) barındırdığı için reddedildi.'
          : '❌ Geçersiz klan adı! 2-32 karakter olmalı ve harf içermelidir.',
    });
  }

  const registryRoles = database.getClanRoles();
  const safeGuildRoles = Array.from(interaction.guild.roles.cache.values()).filter((r) =>
    clanMatcher.isSafeClanRole(r, interaction.guild, config, database)
  );
  const knownClans = database.getKnownClans();

  const resolution = clanMatcher.resolveClan(sanitized.cleanName, {
    registryRoles,
    safeGuildRoles,
    knownClans,
    ownClanAliases: config.OWN_CLAN_ALIASES,
  });

  if (resolution.ownClan) {
    return interaction.editReply({
      content: '❌ Başka klan alanına Piyade klanının adı yazılamaz!',
    });
  }

  resolution.forcedByStaff = true;

  // Veritabanını güncelle
  database.setActiveApplication(applicantId, {
    ...activeApp,
    clanTypedName: sanitized.cleanName,
    clanResolution: resolution,
  });

  // Yetkili onay kartını güncelle
  if (activeApp.staffChannelId && activeApp.staffMessageId) {
    try {
      const staffChannel = await interaction.guild.channels.fetch(activeApp.staffChannelId).catch(() => null);
      if (staffChannel) {
        const staffMsg = await staffChannel.messages.fetch(activeApp.staffMessageId).catch(() => null);
        if (staffMsg && staffMsg.embeds.length > 0) {
          const oldEmbed = staffMsg.embeds[0];
          let roleDecisionText = '';
          if (resolution.mode === 'existing') {
            roleDecisionText = `✅ Mevcut rol kullanılacak: <@&${resolution.roleId}> (%${Math.round(resolution.score * 100)}) [Yetkili Düzenledi]`;
          } else if (resolution.mode === 'suggested') {
            const candidateList = (resolution.candidates || [])
              .map((c) => `• <@&${c.roleId}> (%${Math.round(c.score * 100)})`)
              .join('\n');
            roleDecisionText = `⚠️ Benzer rol bulundu: <@&${resolution.roleId}> (%${Math.round(resolution.score * 100)}) [Yetkili Düzenledi]\n${candidateList}`;
          } else {
            roleDecisionText = `🆕 Yeni rol oluşturulacak: **${resolution.displayName}** [Yetkili Düzenledi]`;
          }

          const updatedFields = oldEmbed.fields.map((f) => {
            if (f.name === '🏷️ Yazdığı Klan') {
              return { ...f, value: `\`${sanitized.cleanName}\` *(Yetkili tarafından güncellendi)*` };
            }
            if (f.name === '🧩 Rol Kararı') {
              return { ...f, value: roleDecisionText };
            }
            return f;
          });

          const newEmbed = EmbedBuilder.from(oldEmbed).setFields(updatedFields);
          await staffMsg.edit({ embeds: [newEmbed] });
        }
      }
    } catch (e) {
      console.warn('[CLAN EDIT EMBED UPDATE ERROR]:', e.message);
    }
  }

  return interaction.editReply({
    content: `✅ <@${applicantId}> adlı üyenin klanı **${sanitized.cleanName}** olarak güncellendi ve karar kaydedildi!`,
  });
}

/**
 * Yetkili ✅ ONAYLA butonuna bastığında çalışan fonksiyon.
 */
async function handleApprove(interaction, applicantId) {
  const isStaff =
    interaction.member.roles.cache.has(config.ROLES.STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.member.roles.cache.has(config.ROLES.TRYOUT_STAFF) ||
    interaction.member.roles.cache.has(config.ROLES.DEVELOPER);

  if (!isStaff) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece Kayıt Yetkilileri yapabilir!',
      ephemeral: true,
    });
  }

  if (approvalUserLocks.has(applicantId)) {
    return interaction.reply({
      content: '⚠️ Bu başvuru için onay işlemi zaten yürütülüyor, lütfen bekleyin.',
      ephemeral: true,
    });
  }

  approvalUserLocks.add(applicantId);

  try {
    await interaction.deferReply({ ephemeral: true });

    const activeApp = database.getActiveApplication(applicantId);
    if (!activeApp) {
      return interaction.editReply({
        content: '⚠️ Bu başvuru zaten sonuçlanmış veya bulunamadı!',
      });
    }

    const applicantMember = await interaction.guild.members.fetch(applicantId).catch(() => null);
    if (!applicantMember) {
      return interaction.editReply({
        content: '❌ Başvuru sahibi kullanıcı sunucuda bulunamadı!',
      });
    }

    const isOtherClan = activeApp.registrationType === 'other';
    const isApplicantEn = activeApp?.lang === 'en' || resolveLang(applicantMember || applicantId) === 'en';
    if (isApplicantEn) {
      await setMemberLanguage(applicantMember, 'en').catch(() => {});
    }

    let assignedRoleId = null;
    let isRoleCreated = false;

    // 1. Rolleri Belirleme
    const rolesToGive = [];

    if (isOtherClan) {
      // Başka Klan akışı: OTHER_CLAN ve VERIFIED verilir, REGISTERED_CHECK ASLA VERİLMEZ
      if (config.ROLES.OTHER_CLAN) rolesToGive.push(config.ROLES.OTHER_CLAN);
      if (config.ROLES.VERIFIED) rolesToGive.push(config.ROLES.VERIFIED);

      // Klan Rolünü Çözümleme
      const clanRes = activeApp.clanResolution || {};
      let targetRole = null;

      if (clanRes.mode === 'existing' || clanRes.mode === 'suggested') {
        if (clanRes.roleId) {
          const fetchedRole = interaction.guild.roles.cache.get(clanRes.roleId);
          if (fetchedRole && clanMatcher.isSafeClanRole(fetchedRole, interaction.guild, config, database)) {
            targetRole = fetchedRole;
            assignedRoleId = fetchedRole.id;
            isRoleCreated = false;
          }
        }
      }

      // Rol bulunamadıysa veya 'new' modundaysa
      if (!targetRole) {
        const targetName = clanRes.displayName || activeApp.clanTypedName || 'Klan';
        const normCompact = clanMatcher.normalizeClanName(targetName).compact;

        // Çift rol açılmasını önlemek için klan compact lock ve registry kontrolü
        const registryMatch = database.getClanRoles().find((cr) => cr.compact === normCompact);
        if (registryMatch && interaction.guild.roles.cache.has(registryMatch.roleId)) {
          assignedRoleId = registryMatch.roleId;
          isRoleCreated = false;
        } else {
          // Güvenli roller arasında compact tam eşleşen var mı?
          const guildMatch = Array.from(interaction.guild.roles.cache.values()).find(
            (r) =>
              clanMatcher.normalizeClanName(r.name).compact === normCompact &&
              clanMatcher.isSafeClanRole(r, interaction.guild, config, database)
          );

          if (guildMatch) {
            assignedRoleId = guildMatch.id;
            isRoleCreated = false;
          } else {
            // Sunucu rol sınırı kontrolü (CLAN.MAX_GUILD_ROLES = 245)
            const maxRoles = config.CLAN?.MAX_GUILD_ROLES || 245;
            if (interaction.guild.roles.cache.size >= maxRoles) {
              return interaction.editReply({
                content: `❌ Sunucudaki maksimum rol sınırına (${maxRoles}) ulaşıldığı için yeni klan rolü oluşturulamadı! Lütfen sunucu rollerini temizleyiniz veya mevcut bir rol seçiniz. Başvuru aktif tutuldu.`,
              });
            }

            clanRoleCreationLocks.add(normCompact);
            try {
              const newRole = await interaction.guild.roles.create({
                name: targetName,
                color: config.CLAN?.ROLE_COLOR || 0x95A5A6,
                hoist: false,
                mentionable: false,
                permissions: [],
                reason: `Klan rolü (otomatik) - ${activeApp.clanTypedName} - Yetkili: ${interaction.user.tag}`,
              });

              // Rolü Other Clan rolünün hemen altına yerleştir
              const otherClanRole = interaction.guild.roles.cache.get(config.ROLES.OTHER_CLAN);
              if (otherClanRole && newRole.position < otherClanRole.position) {
                await newRole.setPosition(Math.max(1, otherClanRole.position - 1)).catch(() => {});
              }

              database.addClanRole({
                roleId: newRole.id,
                name: newRole.name,
                normalized: clanMatcher.normalizeClanName(newRole.name).full,
                compact: normCompact,
                aliases: activeApp.clanTypedName ? [activeApp.clanTypedName] : [],
                source: 'bot',
                createdBy: interaction.user.id,
                createdAt: Date.now(),
              });

              assignedRoleId = newRole.id;
              isRoleCreated = true;
            } finally {
              clanRoleCreationLocks.delete(normCompact);
            }
          }
        }
      }

      if (assignedRoleId) {
        rolesToGive.push(assignedRoleId);
        if (activeApp.clanTypedName) {
          database.addClanAlias(assignedRoleId, activeApp.clanTypedName);
        }
      }
    } else {
      // Piyade Klanı akışı (mevcut APPROVED_ROLES)
      for (const rId of config.ROLES.APPROVED_ROLES || []) {
        if (rId) rolesToGive.push(rId);
      }
    }

    // 2. Rolleri Üyeye Ver (Hata durumunda başvuru aktif kalır, güvenli/idempotent)
    for (const roleId of rolesToGive) {
      if (roleId && interaction.guild.roles.cache.has(roleId)) {
        try {
          await applicantMember.roles.add(roleId, `Kayıt Onaylandı (Yetkili: ${interaction.user.tag})`);
        } catch (roleErr) {
          console.error(`[ROL EKLEME HATASI] Rol (${roleId}) verilemedi:`, roleErr);
          return interaction.editReply({
            content: `❌ <@&${roleId}> rolü verilirken hata oluştu: ${roleErr.message}. Lütfen botun yetki ve rol sırasını kontrol ediniz. Başvuru aktif tutuldu, düzelttikten sonra tekrar Onayla butonuna basabilirsiniz.`,
          });
        }
      }
    }

    // 3. Cinsiyet Rolünü Tanımla
    const { isFemale } = parseGenderInput(activeApp?.gender);
    const genderRoleId = isFemale ? config.ROLES.FEMALE : config.ROLES.MALE;
    if (genderRoleId && interaction.guild.roles.cache.has(genderRoleId)) {
      try {
        await applicantMember.roles.add(
          genderRoleId,
          `Cinsiyet Rolü: ${isFemale ? 'Kız' : 'Erkek'} (Yetkili: ${interaction.user.tag})`
        );
      } catch (gErr) {
        console.warn('[CİNSİYET ROLÜ HATASI]:', gErr.message);
      }
    }

    // 4. Kayıtsız Rolünü Al
    if (config.ROLES.UNREGISTERED && applicantMember.roles.cache.has(config.ROLES.UNREGISTERED)) {
      await applicantMember.roles.remove(config.ROLES.UNREGISTERED, 'Kayıt tamamlandı.').catch(() => {});
    }

    // 5. Sunucu İçi İsmi Güncelle: {Formda yazdığı gerçek adı} | {Roblox Oyuncu Nicki}
    if (activeApp && activeApp.realName) {
      const fullNick = `${activeApp.realName} | ${activeApp.robloxUsername || ''}`.trim();
      const newNick = fullNick.length > 32 ? fullNick.slice(0, 32) : fullNick;
      try {
        await applicantMember.setNickname(newNick, 'Kayıt onaylandı - Otomatik isim güncelleme');
      } catch (nickErr) {
        console.warn(`[NICKNAME GÜNCELLEME HATASI] (${applicantMember.user.tag}):`, nickErr.message);
      }
    }

    // 6. Veritabanına Kayıt Ekle
    database.addRegistration({
      discordId: applicantId,
      robloxId: activeApp ? activeApp.robloxId : null,
      robloxUsername: activeApp ? activeApp.robloxUsername : null,
      realName: activeApp ? activeApp.realName : null,
      gender: activeApp ? activeApp.gender : null,
      registrationType: isOtherClan ? 'other' : 'own',
      clanName: isOtherClan ? activeApp.clanTypedName : null,
      clanRoleId: isOtherClan ? assignedRoleId : null,
      clanRoleCreated: Boolean(isRoleCreated),
      approvedBy: interaction.user.id,
      approvedAt: Date.now(),
    });

    // Aktif başvurudan kaldır
    database.removeActiveApplication(applicantId);
    database.clearRejectedApplication(applicantId);

    // 7. Yetkili Kartını Yeşile Çevir ve Güncelle
    if (interaction.message) {
      try {
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed)
          .setColor(config.COLORS.SUCCESS)
          .setTitle(
            isOtherClan
              ? '✅ Kayıt Başvurusu Onaylandı (Başka Klan)'
              : '✅ Kayıt Başvurusu Onaylandı'
          )
          .addFields({
            name: '👮 Onaylayan Yetkili',
            value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
            inline: false,
          });

        if (isOtherClan && assignedRoleId) {
          updatedEmbed.addFields(
            { name: '🏷️ Klan', value: `<@&${assignedRoleId}>`, inline: true },
            {
              name: '🧩 Rol Durumu',
              value: isRoleCreated ? '`Yeni oluşturuldu`' : '`Mevcut rol kullanıldı`',
              inline: true,
            }
          );
        }

        await interaction.message.edit({
          embeds: [updatedEmbed],
          components: [],
        });
      } catch (msgEditErr) {
        console.warn('[STAFF CARD EDIT ERROR]:', msgEditErr.message);
      }
    }

    // 8. Kullanıcıya DM Gönder (TR/EN)
    try {
      if (isOtherClan) {
        await applicantMember.user.send(
          isApplicantEn
            ? `🎉 Congratulations! Your registration application in **Piyade Team | TSB** has been **approved** by <@${interaction.user.id}>.\n` +
              `Your clan role (${assignedRoleId ? `<@&${assignedRoleId}>` : `**${activeApp.clanTypedName}**`}) and member roles have been assigned. Welcome!`
            : `🎉 Tebrikler! **Piyade Team | TSB** sunucusundaki başka klan kaydınız <@${interaction.user.id}> tarafından **onaylandı**.\n` +
              `Klan rolünüz (${assignedRoleId ? `<@&${assignedRoleId}>` : `**${activeApp.clanTypedName}**`}) ve sunucu rolleriniz hesabınıza tanımlandı. İyi eğlenceler dileriz!`
        );
      } else {
        await applicantMember.user.send(
          isApplicantEn
            ? `🎉 Congratulations! Your registration application in **Piyade Team | TSB** has been **approved** by <@${interaction.user.id}>.\nYour member roles have been assigned. Have fun!`
            : `🎉 Tebrikler! **Piyade Team | TSB** sunucusundaki kayıt başvurunuz <@${interaction.user.id}> tarafından **onaylandı**.\nRolleriniz hesabınıza tanımlandı. İyi eğlenceler dileriz!`
        );
      }
    } catch (e) {}

    // 9. Özel Kayıt Odasını Sil
    if (activeApp && activeApp.threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
        if (thread) {
          await thread.delete('Kayıt işlemi tamamlandı - Özel oda silindi.');
        }
      } catch (threadErr) {
        console.warn(`[THREAD SİLME HATASI] (${activeApp.threadId}):`, threadErr.message);
      }
    }

    return interaction.editReply({
      content: `✅ <@${applicantId}> kullanıcısının kaydı başarıyla onaylandı, rolleri verildi, ismi güncellendi ve kayıt odası silindi!`,
    });
  } catch (err) {
    console.error('[ONAY HATASI] Onaylama sırasında hata:', err);
    return interaction.editReply({
      content: `❌ Kayıt onaylanırken bir hata oluştu: ${err.message}`,
    });
  } finally {
    approvalUserLocks.delete(applicantId);
  }
}

/**
 * Yetkili ✖️ REDDET butonuna bastığında sebep girmesi için Modal açar.
 */
async function handleRejectButton(interaction, applicantId) {
  const isStaff =
    interaction.member.roles.cache.has(config.ROLES.STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isStaff) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece Kayıt Yetkilileri yapabilir!',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_reject_staff_${applicantId}`)
    .setTitle('Başvuruyu Reddet');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reject_reason')
    .setLabel('Reddetme Sebebi')
    .setPlaceholder('Örn: Yanlış Roblox profili, kural ihlali, hatalı isim vb.')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(3)
    .setMaxLength(500)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

/**
 * Yetkili Reddetme Modalını onayladığında çalışan fonksiyon.
 */
async function handleRejectModalSubmit(interaction, applicantId) {
  await interaction.deferReply({ ephemeral: true });

  const rejectReason = interaction.fields.getTextInputValue('reject_reason').trim();
  const activeApp = database.getActiveApplication(applicantId);
  const applicantMember = await interaction.guild.members.fetch(applicantId).catch(() => null);

  database.removeActiveApplication(applicantId);
  database.setRejectedApplication(applicantId, {
    reason: rejectReason,
    rejectedBy: interaction.user.id,
    robloxUsername: activeApp ? activeApp.robloxUsername : null,
  });

  // 1. Yetkili Kartını Kırmızıya Çevir ve Sebebi Ekle
  try {
    if (activeApp && activeApp.staffChannelId && activeApp.staffMessageId) {
      const staffChannel = await interaction.guild.channels.fetch(activeApp.staffChannelId).catch(() => null);
      if (staffChannel) {
        const staffMsg = await staffChannel.messages.fetch(activeApp.staffMessageId).catch(() => null);
        if (staffMsg && staffMsg.embeds.length > 0) {
          const updatedEmbed = EmbedBuilder.from(staffMsg.embeds[0])
            .setColor(config.COLORS.DANGER)
            .setTitle('✖️ Kayıt Başvurusu Reddedildi')
            .addFields(
              {
                name: '👮 Reddeden Yetkili',
                value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
                inline: true,
              },
              {
                name: '📄 Red Sebebi',
                value: `>>> ${rejectReason}`,
                inline: false,
              }
            );

          await staffMsg.edit({
            embeds: [updatedEmbed],
            components: [],
          });
        }
      }
    }
  } catch (cardErr) {
    console.error('[RED KART GÜNCELLEME HATASI]:', cardErr.message);
  }

  // 2. Özel Kayıt Odasına Bilgilendirme Gönder ve 5 Dakika Sonra Sil
  const isApplicantEn = activeApp?.lang === 'en' || resolveLang(applicantMember || applicantId) === 'en';

  if (activeApp && activeApp.threadId) {
    const threadRef = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (threadRef) {
      const rejectedThreadEmbed = new EmbedBuilder()
        .setTitle(isApplicantEn ? '✖️ Registration Application Rejected' : '✖️ Kayıt Başvurunuz Reddedildi')
        .setColor(config.COLORS.DANGER)
        .setDescription(
          isApplicantEn
            ? `❌ <@${applicantId}>, your registration application was **REJECTED** by staff member <@${interaction.user.id}>.\n\n` +
              `**Reason:**\n> ${rejectReason}\n\n` +
              `⚠️ **Notice:** This private thread will be automatically deleted in **5 minutes**.\n` +
              `Please fix the issue above and submit a new application from the registration panel.`
            : `❌ <@${applicantId}>, kayıt başvurunuz yetkili <@${interaction.user.id}> tarafından **REDDEDİLDİ**.\n\n` +
              `**Red Sebebi:**\n> ${rejectReason}\n\n` +
              `⚠️ **Dikkat:** Bu özel oda **5 dakika** içinde otomatik olarak silinecektir.\n` +
              `Hatalarınızı düzelterek kayıt kanalındaki panelden tekrar başvurabilirsiniz.`
        )
        .setTimestamp();

      await threadRef.send({
        content: `<@${applicantId}>`,
        embeds: [rejectedThreadEmbed],
      });

      await threadRef.setName(isApplicantEn ? '✖️・rejected' : '✖️・reddedildi').catch(() => {});

      setTimeout(async () => {
        try {
          const t = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
          if (t) {
            await t.delete('Kayıt başvurusu reddedildi (5 dakika süre doldu)');
          }
        } catch (e) {}
      }, 5 * 60 * 1000);
    }
  }

  // 3. Kullanıcıya DM Gönder
  if (applicantMember) {
    try {
      await applicantMember.user.send(
        isApplicantEn
          ? `✖️ Your registration application in **Piyade Team | TSB** was rejected.\n\n` +
            `**Reviewed By:** <@${interaction.user.id}>\n` +
            `**Reason:**\n> ${rejectReason}\n\n` +
            `Please correct your information and re-apply using the registration panel.`
          : `✖️ **Piyade Team | TSB** sunucusundaki kayıt başvurunuz reddedildi.\n\n` +
            `**Reddeden Yetkili:** <@${interaction.user.id}>\n` +
            `**Red Sebebi:**\n> ${rejectReason}\n\n` +
            `Eksik veya hatalı bilgilerinizi düzelterek kayıt kanalındaki panelden tekrar başvurabilirsiniz.`
      );
    } catch (dmErr) {}
  }

  return interaction.editReply({
    content: `✖️ <@${applicantId}> kullanıcısının başvurusu reddedildi ve kullanıcı bilgilendirildi. Oda 5 dakika içinde silinecek.`,
  });
}
