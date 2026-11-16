const {
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const database = require('../utils/database');
const { createEnglishRegisterGuideEmbed } = require('../utils/panel');
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

// Eşzamanlı işlem kilitleri (Bellek içi kilitler)
const approvalUserLocks = new Set();

/**
 * Kaldırılan eski sistemlerin (Tryout, Acil Yardım, Klan Eşleştirme, VS) customId kontrolü
 */
function isLegacyInteraction(customId) {
  if (!customId || typeof customId !== 'string') return false;
  const legacyPatterns = [
    'tryout',
    'btn_tryout',
    'modal_tryout',
    'select_tryout',
    'help',
    'btn_help',
    'yardim',
    'btn_acil_yardim',
    'clan',
    'klan',
    'btn_clan',
    'modal_clan',
    'btn_reg_type',
    'select_gender_other',
    'select_gender_own',
    'modal_kayit_other',
    'modal_kayit_own',
    'vs_',
    'btn_vs',
    'modal_vs',
    'select_vs',
  ];

  return legacyPatterns.some((pattern) => customId.toLowerCase().includes(pattern));
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      // 0. AUTOCOMPLETE ETKİLEŞİMLERİ
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

      // 2. KALDIRILAN ESKİ SİSTEMLERİN ETKİLEŞİM YAKALAYICISI (GÜVENLİ GERİ DÖNÜŞ)
      if (interaction.customId && isLegacyInteraction(interaction.customId)) {
        const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
        return interaction.reply({
          content: isEn
            ? '⚠️ This feature has been removed. / Bu özellik kaldırıldı.'
            : '⚠️ Bu özellik kaldırıldı. / This feature has been removed.',
          ephemeral: true,
        }).catch(() => {});
      }

      // 3. BUTON ETKİLEŞİMLERİ
      if (interaction.isButton()) {
        // [A] "✅ Kayıt Ol" ve "🇬🇧 Register (English)" Paneli Butonları
        if (interaction.customId === 'btn_kayit_ol' || interaction.customId === 'btn_kayit_ol_en') {
          const isEnClick = interaction.customId === 'btn_kayit_ol_en';
          if (isEnClick) {
            await setMemberLanguage(interaction.member, 'en').catch(() => {});
          }
          const isEn = isEnClick || resolveLang(interaction) === 'en';

          // Kontrol 1: Zaten Kayıtlı mı?
          if (config.isRegisteredMember(interaction.member)) {
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

          // Cinsiyet Seçim Menüsü
          const genderSelect = new StringSelectMenuBuilder()
            .setCustomId(isEn ? 'select_gender_en' : 'select_gender')
            .setPlaceholder(isEn ? 'Please select your gender...' : 'Lütfen Cinsiyetinizi Seçiniz...')
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Male' : 'Erkek')
                .setEmoji('👨')
                .setValue('gender_erkek')
                .setDescription(isEn ? 'Register as male member' : 'Erkek üye olarak kayıt'),
              new StringSelectMenuOptionBuilder()
                .setLabel(isEn ? 'Female' : 'Kız')
                .setEmoji('👩')
                .setValue('gender_kiz')
                .setDescription(isEn ? 'Register as female member' : 'Kadın üye olarak kayıt')
            );

          const row = new ActionRowBuilder().addComponents(genderSelect);

          return interaction.reply({
            content: isEn
              ? `👋 Welcome <@${interaction.user.id}>! Please select your **Gender** to open the registration form:`
              : `👋 Hoş geldin <@${interaction.user.id}>! Kayıt formunu açmak için lütfen aşağıdan **Cinsiyetinizi** seçiniz:`,
            embeds: isEn ? [createEnglishRegisterGuideEmbed()] : [],
            components: [row],
            ephemeral: true,
          });
        }

        // [B] İSİM RENGİ İNGİLİZCE REHBER BUTONU
        if (interaction.customId === 'btn_color_en_info') {
          await setMemberLanguage(interaction.member, 'en').catch(() => {});
          return interaction.reply({
            embeds: [createEnglishColorGuideEmbed()],
            ephemeral: true,
          });
        }

        // [C] YETKİLİ KART BUTONU: ✅ ONAYLA
        if (interaction.customId.startsWith('btn_approve_')) {
          const applicantId = interaction.customId.replace('btn_approve_', '');
          return handleApprove(interaction, applicantId);
        }

        // [D] YETKİLİ KART BUTONU: ✖️ REDDET
        if (interaction.customId.startsWith('btn_reject_')) {
          const applicantId = interaction.customId.replace('btn_reject_', '');
          return handleRejectButton(interaction, applicantId);
        }

        // [E] İSİM RENGİ SEÇİM BUTONLARI (btn_color_...)
        if (interaction.customId.startsWith('btn_color_')) {
          const roleId = interaction.customId.replace('btn_color_', '');
          return handleColorButton(interaction, roleId);
        }

        // [F] UYARI SİSTEMİ: SÖZLÜ UYARI & RESMİ UYARI BUTONLARI
        if (interaction.customId === 'btn_warn_verbal') {
          return handleWarningButton(interaction, 'verbal');
        }
        if (interaction.customId === 'btn_warn_official') {
          return handleWarningButton(interaction, 'official');
        }

        // [G] UYARI SİSTEMİ: KANIT GÖRSELİ YÜKLE / PAS GEÇ BUTONLARI
        if (interaction.customId.startsWith('btn_warn_proof_upload_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_upload_', '');
          return handleProofButton(interaction, 'upload', warnId);
        }
        if (interaction.customId.startsWith('btn_warn_proof_skip_')) {
          const warnId = interaction.customId.replace('btn_warn_proof_skip_', '');
          return handleProofButton(interaction, 'skip', warnId);
        }

        // [H] UYARI LOG KANALINDAKİ "🇬🇧 English" ÇEVİRİ BUTONU
        if (interaction.customId.startsWith('btn_warn_log_en_')) {
          const warnId = interaction.customId.replace('btn_warn_log_en_', '');
          return handleWarningLogEnglishButton(interaction, warnId);
        }
      }

      // 4. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
      if (interaction.isStringSelectMenu()) {
        if (
          interaction.customId === 'select_gender' ||
          interaction.customId === 'select_gender_en' ||
          interaction.customId === 'select_kayit_cinsiyet'
        ) {
          const isEn = interaction.customId.endsWith('_en') || resolveLang(interaction) === 'en';
          const selectedGender = interaction.values[0]; // 'gender_erkek' veya 'gender_kiz'

          const modalCustomId = isEn
            ? `modal_kayit_${selectedGender}_en`
            : `modal_kayit_${selectedGender}`;

          const modalTitle = isEn
            ? `${config.BRAND_NAME} | Registration Form`
            : `${config.BRAND_NAME} | Kayıt Formu`;

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

          modal.addComponents(rows);
          return interaction.showModal(modal);
        }
      }

      // 5. USER SELECT MENU (UYARI KULLANICI SEÇİMİ)
      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'select_warn_verbal_user') {
          return handleWarningUserSelected(interaction, 'verbal');
        }

        if (interaction.customId === 'select_warn_official_user') {
          return handleWarningUserSelected(interaction, 'official');
        }
      }

      // 6. MODAL GÖNDERİMLERİ (MODAL SUBMIT)
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

        // [C] Sözlü Uyarı Formu Gönderimi
        if (interaction.customId.startsWith('modal_warn_verbal_')) {
          const targetUserId = interaction.customId.replace('modal_warn_verbal_', '');
          return handleVerbalWarnModalSubmit(interaction, targetUserId);
        }

        // [D] Resmi Uyarı (Madde No) Formu Gönderimi
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

    const isApplicantEn = activeApp?.lang === 'en' || resolveLang(applicantMember || applicantId) === 'en';
    if (isApplicantEn) {
      await setMemberLanguage(applicantMember, 'en').catch(() => {});
    }

    // 1. Rolleri Belirleme (APPROVED_ROLES)
    const rolesToGive = [];
    for (const rId of config.ROLES.APPROVED_ROLES || []) {
      if (rId) rolesToGive.push(rId);
    }

    // 2. Rolleri Üyeye Ver (Hata durumunda başvuru aktif kalır)
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
      } catch (msgEditErr) {
        console.warn('[STAFF CARD EDIT ERROR]:', msgEditErr.message);
      }
    }

    // 8. Kullanıcıya DM Gönder (TR/EN)
    try {
      await applicantMember.user.send(
        isApplicantEn
          ? `🎉 Congratulations! Your registration application in **${config.BRAND_NAME}** has been **approved** by <@${interaction.user.id}>.\nYour member roles have been assigned. Have fun!`
          : `🎉 Tebrikler! **${config.BRAND_NAME}** sunucusundaki kayıt başvurunuz <@${interaction.user.id}> tarafından **onaylandı**.\nRolleriniz hesabınıza tanımlandı. İyi eğlenceler dileriz!`
      );
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
          ? `✖️ Your registration application in **${config.BRAND_NAME}** was rejected.\n\n` +
            `**Reviewed By:** <@${interaction.user.id}>\n` +
            `**Reason:**\n> ${rejectReason}\n\n` +
            `Please correct your information and re-apply using the registration panel.`
          : `✖️ **${config.BRAND_NAME}** sunucusundaki kayıt başvurunuz reddedildi.\n\n` +
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
