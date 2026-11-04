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
const {
  createVsRoomMessage,
  createEnglishVsGuideEmbed,
  createVsResultAnnouncement,
  updateTop10Message,
  sanitizeChannelName,
} = require('../utils/vsManager');
const { handleHelpRequest, createEnglishHelpGuideEmbed } = require('../utils/helpManager');
const {
  handleTryoutStart,
  handleTryoutUserSelected,
  handleTryoutModalSubmit,
} = require('../utils/tryoutManager');
const { handleColorButton } = require('../utils/colorManager');
const {
  handleWarningButton,
  handleWarningUserSelected,
  handleVerbalWarnModalSubmit,
  handleOfficialWarnModalSubmit,
  handleProofButton,
} = require('../utils/warningManager');
const { createRegistrationApplication } = require('../services/registrationService');
const { resolveLang, setMemberLanguage, parseGenderInput } = require('../utils/i18n');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
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

          // Kontrol 1: Zaten Üye mi? (1559604702143062016 rolü var mı?)
          if (interaction.member.roles.cache.has(config.ROLES.REGISTERED_CHECK)) {
            return interaction.reply({
              content: isEn
                ? '❌ You are already registered on our server! You cannot submit another application.'
                : '❌ Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.',
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

          // Cinsiyet Seçimi (Açılır Menü / Select Menu) sunuluyor
          const genderSelect = new StringSelectMenuBuilder()
            .setCustomId(isEn ? 'select_gender_en' : 'select_gender')
            .setPlaceholder(isEn ? 'Please select your gender...' : 'Lütfen Cinsiyetinizi Seçiniz...')
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Male' : 'Erkek')
                .setEmoji('👨')
                .setValue('gender_erkek')
                .setDescription(
                  isEn
                    ? 'Register as a male member of Piyade Team'
                    : 'Piyade Team bünyesine erkek üye olarak kayıt'
                ),
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Female' : 'Kız')
                .setEmoji('👩')
                .setValue('gender_kiz')
                .setDescription(
                  isEn
                    ? 'Register as a female member of Piyade Team'
                    : 'Piyade Team bünyesine kadın üye olarak kayıt'
                )
            );

          const row = new ActionRowBuilder().addComponents(genderSelect);

          return interaction.reply({
            content: isEn
              ? `👋 Welcome <@${interaction.user.id}>!\nPlease read the guide below and select your **Gender** to open the registration form:`
              : `👋 Hoş geldin <@${interaction.user.id}>!\nKayıt formunu açmak için lütfen aşağıdan **Cinsiyetinizi** seçiniz:`,
            embeds: isEn ? [createEnglishRegisterGuideEmbed()] : [],
            components: [row],
            ephemeral: true,
          });
        }

        // [A2] VS & ACİL YARDIM İNGİLİZCE REHBER BUTONLARI
        if (interaction.customId === 'btn_vs_en_info') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishVsGuideEmbed()],
            ephemeral: true,
          });
        }

        if (interaction.customId === 'btn_help_en_info') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishHelpGuideEmbed()],
            ephemeral: true,
          });
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

        // [D] VS SİSTEMİ: "⚔️ VS Talep Oluştur" Butonu
        if (interaction.customId === 'btn_vs_talep_olustur') {
          return handleVsRequestStart(interaction);
        }

        // [E] VS SİSTEMİ: Karar Butonları: Kazanan Belirleme (btn_vs_win_...)
        if (interaction.customId.startsWith('btn_vs_win_')) {
          const winnerId = interaction.customId.replace('btn_vs_win_', '');
          return handleVsWinnerDecision(interaction, winnerId);
        }

        // [F] VS SİSTEMİ: Karar Butonları: Talep İptal Edildi (btn_vs_cancel)
        if (interaction.customId === 'btn_vs_cancel') {
          return handleVsCancelDecision(interaction);
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
      }

      // 3. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_gender' || interaction.customId === 'select_gender_en') {
          const isEn = interaction.customId === 'select_gender_en' || resolveLang(interaction) === 'en';
          const selectedGender = interaction.values[0]; // 'gender_erkek' veya 'gender_kiz'

          // Kayıt Formu (KayitModal) Açılıyor
          const modal = new ModalBuilder()
            .setCustomId(isEn ? `modal_kayit_en_${selectedGender}` : `modal_kayit_${selectedGender}`)
            .setTitle(isEn ? 'Piyade Team | Registration Form' : 'Piyade Team | Kayıt Formu');

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

          modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(robloxInput),
            new ActionRowBuilder().addComponents(genderInput)
          );

          return interaction.showModal(modal);
        }
      }

      // 4. USER SELECT MENU (VS RAKİP, TRYOUT & UYARI KULLANICI SEÇİMİ)
      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'select_vs_opponent') {
          return handleVsOpponentSelected(interaction);
        }

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

  const isEnModal = interaction.customId.startsWith('modal_kayit_en_');
  const isEn = isEnModal || resolveLang(interaction) === 'en';

  const realName = interaction.fields.getTextInputValue('modal_real_name').trim();
  const robloxInput = interaction.fields.getTextInputValue('modal_roblox_input').trim();

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
 * Yetkili ✅ ONAYLA butonuna bastığında çalışan fonksiyon.
 */
async function handleApprove(interaction, applicantId) {
  const isStaff =
    interaction.member.roles.cache.has(config.ROLES.STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isStaff) {
    return interaction.reply({
      content: '❌ Bu işlemi sadece Kayıt Yetkilileri yapabilir!',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const activeApp = database.getActiveApplication(applicantId);
  const applicantMember = await interaction.guild.members.fetch(applicantId).catch(() => null);

  if (!applicantMember) {
    return interaction.editReply({
      content: '❌ Başvuru sahibi kullanıcı sunucuda bulunamadı!',
    });
  }

  try {
    // 1. Genel Rolleri Tanımla (1559604645821812896 ve 1559604702143062016)
    for (const roleId of config.ROLES.APPROVED_ROLES) {
      if (roleId && interaction.guild.roles.cache.has(roleId)) {
        await applicantMember.roles.add(roleId, `Kayıt Onaylandı (Yetkili: ${interaction.user.tag})`);
      }
    }

    // 2. Cinsiyet Rolünü Tanımla (Erkek: 1559637360558350356 | Kız: 1559637300042797096)
    const { isFemale } = parseGenderInput(activeApp?.gender);
    const isApplicantEn = activeApp?.lang === 'en' || resolveLang(applicantMember || applicantId) === 'en';
    if (isApplicantEn) {
      await setMemberLanguage(applicantMember, 'en').catch(() => {});
    }

    const genderRoleId = isFemale ? config.ROLES.FEMALE : config.ROLES.MALE;
    if (genderRoleId && interaction.guild.roles.cache.has(genderRoleId)) {
      await applicantMember.roles.add(
        genderRoleId,
        `Cinsiyet Rolü: ${isFemale ? 'Kız' : 'Erkek'} (Yetkili: ${interaction.user.tag})`
      );
    }

    // 3. Kayıtsız Rolünü Al (1559604540997636147)
    if (config.ROLES.UNREGISTERED && applicantMember.roles.cache.has(config.ROLES.UNREGISTERED)) {
      await applicantMember.roles.remove(config.ROLES.UNREGISTERED, 'Kayıt tamamlandı.');
    }

    // 4. Sunucu İçi İsmi Güncelle: {Formda yazdığı gerçek adı} | {Roblox Oyuncu Nicki}
    if (activeApp && activeApp.realName) {
      const fullNick = `${activeApp.realName} | ${activeApp.robloxUsername || ''}`.trim();
      const newNick = fullNick.length > 32 ? fullNick.slice(0, 32) : fullNick;
      try {
        await applicantMember.setNickname(newNick, 'Kayıt onaylandı - Otomatik isim güncelleme');
      } catch (nickErr) {
        console.warn(`[NICKNAME GÜNCELLEME HATASI] (${applicantMember.user.tag}):`, nickErr.message);
      }
    }

    // 5. Veritabanına Başarılı Kayıt Olarak Ekle
    database.addRegistration({
      discordId: applicantId,
      robloxId: activeApp ? activeApp.robloxId : null,
      robloxUsername: activeApp ? activeApp.robloxUsername : null,
      realName: activeApp ? activeApp.realName : null,
      gender: activeApp ? activeApp.gender : null,
      approvedBy: interaction.user.id,
      approvedAt: Date.now(),
    });

    // Aktif başvurudan kaldır
    database.removeActiveApplication(applicantId);
    database.clearRejectedApplication(applicantId);

    // 6. Yetkili Kartını Yeşile Çevir ve Güncelle
    if (interaction.message) {
      const oldEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor(config.COLORS.SUCCESS)
        .setTitle('✅ Kayıt Başvurusu Onaylandı')
        .addFields({
          name: '👮 Onaylayan Yetkili',
          value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
          inline: false,
        });

      await interaction.message.edit({
        embeds: [updatedEmbed],
        components: [],
      });
    }

    // 7. Kullanıcıya DM Gönder
    try {
      await applicantMember.user.send(
        isApplicantEn
          ? `🎉 Congratulations! Your registration application in **Piyade Team | TSB** has been **approved** by <@${interaction.user.id}>.\nYour member roles have been assigned. Have fun!`
          : `🎉 Tebrikler! **Piyade Team | TSB** sunucusundaki kayıt başvurunuz <@${interaction.user.id}> tarafından **onaylandı**.\nRolleriniz hesabınıza tanımlandı. İyi eğlenceler dileriz!`
      );
    } catch (e) {}

    // 8. Özel Kayıt Odasını (Alt Başlığı) Sil
    if (activeApp && activeApp.threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
        if (thread) {
          await thread.delete('Kayıt işlemi tamamlandı - Özel oda silindi.');
          console.log(`[THREAD SİLİNDİ] Onaylanan kayıt odası silindi: ${activeApp.threadId}`);
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

// =========================================================================
// VS (KAPIŞMA) SİSTEMİ FONKSİYONLARI
// =========================================================================

/**
 * Kullanıcı "⚔️ VS Talep Oluştur" butonuna bastığında çalışan fonksiyon.
 */
async function handleVsRequestStart(interaction) {
  const isEn = resolveLang(interaction) === 'en';

  // Aktif Talep Kontrolü: Oyuncunun açık VS kanalı var mı?
  const existingVs = database.getActiveVsByUser(interaction.user.id);
  if (existingVs) {
    const existingChannel = await interaction.guild.channels.fetch(existingVs.channelId).catch(() => null);
    if (existingChannel) {
      return interaction.reply({
        content: isEn
          ? `❌ You already have an open VS challenge channel: <#${existingVs.channelId}>`
          : `❌ Zaten açık bir VS talebiniz bulunuyor: <#${existingVs.channelId}>`,
        ephemeral: true,
      });
    } else {
      database.removeActiveVs(existingVs.channelId);
    }
  }

  // Rakip Seçimi için UserSelectMenu
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('select_vs_opponent')
    .setPlaceholder(isEn ? 'Select the opponent you want to 1v1...' : 'Kapışmak istediğin rakibini seç...')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(userSelect);

  return interaction.reply({
    content: isEn
      ? `⚔️ **Start a 1v1 (VS) Challenge**\nPlease select the opponent you want to challenge from the menu below:`
      : `⚔️ **VS Talep Başlatma**\nLütfen aşağıdan kapışmak istediğiniz rakibi seçiniz:`,
    components: [row],
    ephemeral: true,
  });
}

/**
 * Kullanıcı rakibini menüden seçtiğinde çalışan fonksiyon.
 */
async function handleVsOpponentSelected(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const isEn = resolveLang(interaction) === 'en';

  const opponentId = interaction.values[0];

  // Kontrol 1: Kendisiyle kapışamaz
  if (opponentId === interaction.user.id) {
    return interaction.editReply({
      content: isEn ? '❌ You cannot challenge yourself!' : '❌ Kendinle kapışamazsın!',
    });
  }

  // Kontrol 2: Rakip üye bulunabiliyor mu ve bot mu?
  const opponentMember = await interaction.guild.members.fetch(opponentId).catch(() => null);
  if (!opponentMember || opponentMember.user.bot) {
    return interaction.editReply({
      content: isEn
        ? '❌ You cannot challenge a bot or a user who is not in the server!'
        : '❌ Bir bot veya sunucuda bulunmayan bir kullanıcı ile kapışamazsınız!',
    });
  }

  // Kontrol 3: Açan kişinin aktif talebi var mı?
  const challengerActive = database.getActiveVsByUser(interaction.user.id);
  if (challengerActive) {
    return interaction.editReply({
      content: isEn
        ? `❌ You already have an open VS challenge channel: <#${challengerActive.channelId}>`
        : `❌ Zaten açık bir VS talebiniz bulunuyor: <#${challengerActive.channelId}>`,
    });
  }

  // Kontrol 4: Rakibin aktif talebi var mı?
  const opponentActive = database.getActiveVsByUser(opponentId);
  if (opponentActive) {
    return interaction.editReply({
      content: isEn
        ? `❌ Your selected opponent (<@${opponentId}>) already has an active VS match in progress!`
        : `❌ Seçtiğiniz kullanıcının (<@${opponentId}>) halihazırda devam eden açık bir VS maçı bulunuyor!`,
    });
  }

  // Adım 4: Özel VS Kanalının Oluşturulması
  try {
    const parentCategory = interaction.channel.parentId || null;
    const challengerNick = interaction.member.displayName || interaction.user.username;
    const opponentNick = opponentMember.displayName || opponentMember.user.username;

    const channelName = `vs-${sanitizeChannelName(challengerNick)}-vs-${sanitizeChannelName(opponentNick)}`;

    // Kanal İzinleri
    const permissionOverwrites = [
      {
        id: interaction.guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id, // Açan kişi
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: opponentId, // Rakip
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: interaction.client.user.id, // Bot
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ];

    // Yetkili rolü izni ekle
    if (config.ROLES.VS_STAFF && interaction.guild.roles.cache.has(config.ROLES.VS_STAFF)) {
      permissionOverwrites.push({
        id: config.ROLES.VS_STAFF,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }

    const vsChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentCategory,
      topic: `vs|${interaction.user.id}|${opponentId}|standard|${Date.now()}`,
      permissionOverwrites: permissionOverwrites,
      reason: `VS Talebi: ${challengerNick} vs ${opponentNick}`,
    });

    // Kanal içi karar mesajı
    const roomPayload = createVsRoomMessage(interaction.member, opponentMember);
    const pinnedMsg = await vsChannel.send(roomPayload);
    await pinnedMsg.pin().catch(() => {});

    // Veritabanına kaydet
    database.setActiveVs(vsChannel.id, {
      channelId: vsChannel.id,
      challengerId: interaction.user.id,
      opponentId: opponentId,
      createdAt: Date.now(),
      warned5Hours: false,
      messageId: pinnedMsg.id,
    });

    return interaction.editReply({
      content: isEn
        ? `✅ Your VS match channel has been created! Click here to go to the match channel: <#${vsChannel.id}>`
        : `✅ VS odanız başarıyla açıldı! Maç kanalına gitmek için tıklayın: <#${vsChannel.id}>`,
    });
  } catch (err) {
    console.error('[VS ODA AÇMA HATASI]:', err);
    return interaction.editReply({
      content: isEn
        ? `❌ An error occurred while creating the VS channel: ${err.message}`
        : `❌ VS kanalı oluşturulurken bir hata meydana geldi: ${err.message}`,
    });
  }
}

/**
 * Kapışma Talep Yetkilisi Kazanan Belirlediğinde çalışan fonksiyon.
 */
async function handleVsWinnerDecision(interaction, winnerId) {
  // Yetki Kontrolü
  const isVsStaff =
    interaction.member.roles.cache.has(config.ROLES.VS_STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isVsStaff) {
    return interaction.reply({
      content: '❌ Bu butonlara sadece Kapışma Talep Yetkilisi basabilir!',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const vsData = database.getActiveVsByChannel(interaction.channel.id);
  let challengerId = vsData ? vsData.challengerId : null;
  let opponentId = vsData ? vsData.opponentId : null;

  // Veritabanında bulunamadıysa topic'ten kurtar
  if (!challengerId && interaction.channel.topic && interaction.channel.topic.startsWith('vs|')) {
    const parts = interaction.channel.topic.split('|');
    challengerId = parts[1];
    opponentId = parts[2];
  }

  // Kaybeden kim?
  const loserId = String(winnerId) === String(challengerId) ? opponentId : challengerId;

  // 1. İstatistikleri Güncelle (Kill ve Galibiyet)
  const winnerStats = database.addVsWin(winnerId);
  if (loserId) {
    database.addVsLoss(loserId);
  }

  // 2. Resmi Sonuç Kanalına Duyuru Gönder ([vs sonuç])
  const resultChannel = interaction.guild.channels.cache.get(config.CHANNELS.VS_RESULT);
  if (resultChannel) {
    try {
      const announcementPayload = createVsResultAnnouncement(winnerId, loserId, winnerStats.kills);
      await resultChannel.send(announcementPayload);
      console.log(`[VS SONUÇ] Sonuç duyuruldu: Kazanan ${winnerId}, Kill: ${winnerStats.kills}`);
    } catch (sendErr) {
      console.error('[VS SONUÇ DUYURU HATASI]:', sendErr.message);
    }
  }

  // 3. Top 10 Sıralama Tablosunu Güncelle ([top 10])
  await updateTop10Message(interaction.guild);

  // 4. Odaya Bitiş Mesajı Gönder
  await interaction.channel.send({
    content:
      `🏆 **VS Sonuçlandı!**\n` +
      `**Kazanan:** <@${winnerId}>\n` +
      `Yetkili: <@${interaction.user.id}>\n\n` +
      `📌 Resmi duyuru <#${config.CHANNELS.VS_RESULT}> kanalına iletildi ve Top 10 sıralaması güncellendi.\n` +
      `⏳ Bu oda **5 saniye** içinde kalıcı olarak silinecektir.`,
  });

  // Veritabanından aktif VS'i kaldır
  database.removeActiveVs(interaction.channel.id);

  // 5. Odayı 5 Saniye Sonra Kalıcı Olarak Sil
  setTimeout(async () => {
    try {
      await interaction.channel.delete(`VS maçı sonuçlandı (Kazanan: ${winnerId})`);
      console.log(`[VS KANAL SİLİNDİ] ${interaction.channel.id} kanalı başarıyla kapatıldı.`);
    } catch (delErr) {}
  }, 5000);

  return interaction.editReply({
    content: `✅ Maç başarıyla sonuçlandırıldı! Kazanan <@${winnerId}> olarak kaydedildi ve oda siliniyor.`,
  });
}

/**
 * Kapışma Talep Yetkilisi Talebi İptal Ettiğinde çalışan fonksiyon.
 */
async function handleVsCancelDecision(interaction) {
  const isVsStaff =
    interaction.member.roles.cache.has(config.ROLES.VS_STAFF) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isVsStaff) {
    return interaction.reply({
      content: '❌ Bu butonlara sadece Kapışma Talep Yetkilisi basabilir!',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content: '🔴 Bu VS talebi yetkili tarafından iptal edildi. Oda siliniyor...',
  });

  database.removeActiveVs(interaction.channel.id);

  setTimeout(async () => {
    try {
      await interaction.channel.delete(`VS yetkili tarafından iptal edildi (${interaction.user.tag})`);
    } catch (e) {}
  }, 3000);
}
