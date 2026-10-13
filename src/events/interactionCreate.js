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
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config');
const database = require('../utils/database');
const robloxService = require('../services/roblox');

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
        // [A] "✅ Kayıt Ol" Paneli Butonu
        if (interaction.customId === 'btn_kayit_ol') {
          // Kontrol 1: Zaten Üye mi? (1559604702143062016 rolü var mı?)
          if (interaction.member.roles.cache.has(config.ROLES.REGISTERED_CHECK)) {
            return interaction.reply({
              content: '❌ Zaten sunucumuza kayıtlısınız! Tekrar başvuru yapamazsınız.',
              ephemeral: true,
            });
          }

          // Kontrol 2: Aktif Başvurusu Var mı?
          const activeApp = database.getActiveApplication(interaction.user.id);
          if (activeApp && activeApp.threadId) {
            const existingThread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
            if (existingThread) {
              return interaction.reply({
                content: `⚠️ Devam eden bir başvurunuz bulunmaktadır! Lütfen kayıt odanızı kontrol edin: <#${activeApp.threadId}>`,
                ephemeral: true,
              });
            } else {
              // Thread silinmişse aktif başvuruyu temizle, yeni başvuruya izin ver
              database.removeActiveApplication(interaction.user.id);
            }
          }

          // Cinsiyet Seçimi (Açılır Menü / Select Menu) sunuluyor
          const genderSelect = new StringSelectMenuBuilder()
            .setCustomId('select_gender')
            .setPlaceholder('Lütfen Cinsiyetinizi Seçiniz...')
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('Erkek')
                .setEmoji('👨')
                .setValue('gender_erkek')
                .setDescription('Piyade Team bünyesine erkek üye olarak kayıt'),
              new StringSelectMenuOptionBuilder()
                .setLabel('Kız')
                .setEmoji('👩')
                .setValue('gender_kiz')
                .setDescription('Piyade Team bünyesine kadın üye olarak kayıt')
            );

          const row = new ActionRowBuilder().addComponents(genderSelect);

          return interaction.reply({
            content: `👋 Hoş geldin <@${interaction.user.id}>!\nKayıt formunu açmak için lütfen aşağıdan **Cinsiyetinizi** seçiniz:`,
            components: [row],
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
      }

      // 3. AÇILIR MENÜ (STRING SELECT MENU) ETKİLEŞİMLERİ
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_gender') {
          const selectedGender = interaction.values[0]; // 'gender_erkek' veya 'gender_kiz'

          // Kayıt Formu (KayitModal) Açılıyor
          const modal = new ModalBuilder()
            .setCustomId(`modal_kayit_${selectedGender}`)
            .setTitle('Piyade Team | Kayıt Formu');

          const nameInput = new TextInputBuilder()
            .setCustomId('modal_real_name')
            .setLabel('Gerçek Adın Nedir?')
            .setPlaceholder('Örn: Ahmet Yılmaz')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setMaxLength(32)
            .setRequired(true);

          const robloxInput = new TextInputBuilder()
            .setCustomId('modal_roblox_input')
            .setLabel('Roblox Adı, ID\'si veya Profil Linki')
            .setPlaceholder('Örn: Builderman, 156 veya profil linki')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(120)
            .setRequired(true);

          const genderInput = new TextInputBuilder()
            .setCustomId('modal_gender')
            .setLabel('Cinsiyetiniz (Erkek / Kız)')
            .setValue(selectedGender.includes('kiz') ? 'Kız' : 'Erkek')
            .setPlaceholder('Erkek veya Kız')
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

      // 4. MODAL GÖNDERİMLERİ (MODAL SUBMIT)
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

/**
 * Kullanıcı kayıt formunu doldurup gönderdiğinde çalışan ana fonksiyon.
 */
async function handleRegistrationModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const realName = interaction.fields.getTextInputValue('modal_real_name').trim();
  const robloxInput = interaction.fields.getTextInputValue('modal_roblox_input').trim();

  // Formda yazılan cinsiyet okunuyor
  let inputGender = '';
  try {
    inputGender = interaction.fields.getTextInputValue('modal_gender')?.trim() || '';
  } catch (e) {}

  if (!inputGender && interaction.customId.includes('gender_')) {
    inputGender = interaction.customId.includes('kiz') ? 'Kız' : 'Erkek';
  }

  const isFemale =
    inputGender.toLowerCase().includes('kız') ||
    inputGender.toLowerCase().includes('kiz') ||
    inputGender.toLowerCase().includes('kadın') ||
    inputGender.toLowerCase() === 'k' ||
    inputGender.toLowerCase().includes('bayan');

  const gender = isFemale ? '👩 Kız' : '👨 Erkek';

  // Güvenlik & Tekrar Kontrolleri
  if (interaction.member.roles.cache.has(config.ROLES.REGISTERED_CHECK)) {
    return interaction.editReply({
      content: '❌ Zaten sunucumuza kayıtlısınız!',
    });
  }

  // 1. Roblox API Doğrulaması
  const robloxResult = await robloxService.resolveUser(robloxInput);

  if (!robloxResult.success) {
    // Hesap bulunamadıysa DM ile bilgilendir
    if (robloxResult.error === 'NOT_FOUND') {
      try {
        await interaction.user.send(
          `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
          `**Sebep:** Belirtilen Roblox hesabı bulunamadı.\n` +
          `📌 **Önemli Bilgi:** Lütfen Roblox'taki görünen adınızı (Display Name) değil, profilinizdeki asıl **@kullanıcı** adınızı, ID'nizi veya profil linkinizi yazarak tekrar başvurunuz.`
        );
      } catch (e) {}

      return interaction.editReply({
        content: `❌ **Başvuru Reddedildi:** Girilen Roblox hesabı bulunamadı!\nLütfen görünen adınızı değil, **@kullanıcı** adınızı girdiğinizden emin olun. (Detaylar DM kutunuza iletildi.)`,
      });
    }

    // Yasaklı (Banned) hesap
    if (robloxResult.error === 'BANNED') {
      try {
        await interaction.user.send(
          `❌ **Piyade Team | Kayıt Başvurusu Reddedildi**\n\n` +
          `**Sebep:** Belirtilen Roblox hesabı Roblox platformunda kalıcı olarak yasaklanmıştır (Banned). Yasaklı hesaplarla sunucumuza kayıt olunamaz.`
        );
      } catch (e) {}

      return interaction.editReply({
        content: `❌ **Başvuru Reddedildi:** Bu Roblox hesabı platform üzerinde yasaklanmıştır (Banned)!`,
      });
    }

    // Diğer API / Bağlantı hataları
    return interaction.editReply({
      content: `❌ ${robloxResult.message || 'Roblox doğrulaması yapılamadı.'}`,
    });
  }

  const robloxUser = robloxResult.user;

  // 2. Multi-Hesap (Tekil Kimlik) Koruması
  const existingReg = database.getRegistrationByRobloxId(robloxUser.id);
  if (existingReg && String(existingReg.discordId) !== String(interaction.user.id)) {
    return interaction.editReply({
      content:
        `❌ **Multi-Hesap Koruması Devrede!**\n\n` +
        `Bu Roblox hesabı ([${robloxUser.name}](https://www.roblox.com/users/${robloxUser.id}/profile)) sunucumuzda başka bir Discord kullanıcısına (<@${existingReg.discordId}>) zaten kayıtlıdır!\n\n` +
        `⚠️ *Sunucumuzda "1 Roblox Hesabı = 1 Discord Hesabı" kuralı geçerlidir.*`,
    });
  }

  // 3. Özel Kayıt Odası (Thread) Oluşturma
  const registerChannel =
    interaction.guild.channels.cache.get(config.CHANNELS.REGISTER) || interaction.channel;

  let thread;
  try {
    thread = await registerChannel.threads.create({
      name: `🟡・${interaction.user.username}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `Özel Kayıt Odası - ${realName} (${interaction.user.tag})`,
    });
  } catch (err) {
    // Özel thread yetkisi veya sunucu seviyesi yetersizse genel thread aç
    try {
      thread = await registerChannel.threads.create({
        name: `🟡・${interaction.user.username}`,
        autoArchiveDuration: 1440,
        type: ChannelType.PublicThread,
        reason: `Özel Kayıt Odası - ${realName} (${interaction.user.tag})`,
      });
    } catch (createErr) {
      console.error('[THREAD ERROR] Kayıt odası oluşturulamadı:', createErr);
      return interaction.editReply({
        content: '❌ Özel kayıt odası oluşturulurken bir hata meydana geldi. Lütfen yetkililer ile iletişime geçiniz.',
      });
    }
  }

  // Kullanıcıyı odaya ekle
  await thread.members.add(interaction.user.id).catch(() => {});

  // Odaya karşılama ve işleyiş bilgilendirme mesajı gönder
  const threadInfoEmbed = new EmbedBuilder()
    .setTitle('🟡 Başvuru İnceleniyor...')
    .setColor(config.COLORS.PENDING)
    .setDescription(
      `👋 Hoş geldin <@${interaction.user.id}>!\n\n` +
      `📋 **Kayıt İşleyişi Bilgilendirmesi:**\n` +
      `• Bilgileriniz ve Roblox profiliniz başarıyla doğrulandı.\n` +
      `• Başvurunuz yetkili onay kanalına iletildi.\n` +
      `• Yetkililerimiz onayladığında rolleriniz otomatik olarak tanımlanacaktır.\n` +
      `• Başvurunuz reddedilirse, red sebebi bu odadan ve DM üzerinden size bildirilecektir.\n\n` +
      `⏳ *Lütfen yetkili kararını sabırla bekleyiniz.*`
    )
    .setFooter({ text: 'Piyade Team • Kayıt Sistemi' })
    .setTimestamp();

  await thread.send({
    content: `<@${interaction.user.id}>`,
    embeds: [threadInfoEmbed],
  });

  // 4. Yetkili Onay Kartı Gönderme
  const staffChannel = interaction.guild.channels.cache.get(config.CHANNELS.STAFF_APPROVAL);
  if (!staffChannel) {
    console.error(`[ONAY KANALI] Yetkili onay kanalı (${config.CHANNELS.STAFF_APPROVAL}) bulunamadı!`);
  }

  const staffEmbed = new EmbedBuilder()
    .setTitle('📋 Yeni Kayıt Başvurusu')
    .setColor(config.COLORS.PENDING)
    .setThumbnail(robloxUser.avatarUrl)
    .addFields(
      { name: '👤 Discord Kullanıcısı', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
      { name: '🆔 Discord ID', value: `\`${interaction.user.id}\``, inline: true },
      { name: '📝 Gerçek Adı', value: `${realName}`, inline: true },
      { name: '🚻 Cinsiyet', value: `${gender}`, inline: true },
      {
        name: '📅 Discord Hesap Açılış Tarihi',
        value: `<t:${Math.floor(interaction.user.createdTimestamp / 1000)}:F> (<t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>)`,
        inline: false,
      },
      {
        name: '📥 Sunucuya Katılış Tarihi',
        value: `<t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:R>)`,
        inline: false,
      },
      {
        name: '🎮 Roblox Kullanıcı Adı',
        value: `[${robloxUser.name} (@${robloxUser.displayName})](https://www.roblox.com/users/${robloxUser.id}/profile)`,
        inline: true,
      },
      { name: '🆔 Roblox ID', value: `\`${robloxUser.id}\``, inline: true },
      {
        name: '🔗 Profil Linki',
        value: `[Profili Görüntüle](https://www.roblox.com/users/${robloxUser.id}/profile)`,
        inline: true,
      },
      { name: '🧵 Özel Kayıt Odası', value: `<#${thread.id}>`, inline: false }
    )
    .setFooter({ text: 'Piyade Team • Yetkili Onay Sistemi' })
    .setTimestamp();

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_approve_${interaction.user.id}`)
      .setLabel('✅ ONAYLA')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`btn_reject_${interaction.user.id}`)
      .setLabel('✖️ REDDET')
      .setStyle(ButtonStyle.Danger)
  );

  let staffMessage = null;
  if (staffChannel) {
    staffMessage = await staffChannel.send({
      content: `<@&${config.ROLES.STAFF}>`,
      embeds: [staffEmbed],
      components: [buttonsRow],
    });
  }

  // Aktif başvuruyu kaydet
  database.setActiveApplication(interaction.user.id, {
    threadId: thread.id,
    realName,
    gender,
    robloxId: robloxUser.id,
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
    staffMessageId: staffMessage ? staffMessage.id : null,
    staffChannelId: staffChannel ? staffChannel.id : null,
  });

  // Kullanıcıya ephemeral yanıt
  return interaction.editReply({
    content: `✅ Başvurunuz başarıyla alındı! Size özel oluşturulan kayıt odasını takip edebilirsiniz: <#${thread.id}>`,
  });
}

/**
 * Yetkili ✅ ONAYLA butonuna bastığında çalışan fonksiyon.
 */
async function handleApprove(interaction, applicantId) {
  // Yetki Kontrolü
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
    const genderStr = (activeApp?.gender || '').toLowerCase();
    const isFemale =
      genderStr.includes('kız') ||
      genderStr.includes('kiz') ||
      genderStr.includes('kadın') ||
      genderStr === 'k';

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

    // 3. Sunucu İçi İsmi Güncelle (Opsiyonel / Hiyerarşi izin verirse)
    if (activeApp && activeApp.realName) {
      const newNick = `${activeApp.realName} | ${activeApp.robloxUsername || ''}`.trim();
      if (newNick.length <= 32) {
        await applicantMember.setNickname(newNick).catch(() => {});
      }
    }

    // 4. Veritabanına Başarılı Kayıt Olarak Ekle
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

    // 5. Yetkili Kartını Yeşile Çevir ve Güncelle
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
        components: [], // Butonları kaldır
      });
    }

    // 6. Özel Kayıt Odasına Bilgilendirme Gönder
    if (activeApp && activeApp.threadId) {
      const thread = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
      if (thread) {
        const approvedThreadEmbed = new EmbedBuilder()
          .setTitle('✅ Kayıt Başvurunuz Onaylandı!')
          .setColor(config.COLORS.SUCCESS)
          .setDescription(
            `🎉 Tebrikler <@${applicantId}>!\n\n` +
            `Kayıt başvurunuz yetkili <@${interaction.user.id}> tarafından **ONAYLANDI**.\n` +
            `Sunucu rolleriniz başarıyla tanımlandı. Aramıza hoş geldin, iyi oyunlar dileriz!`
          )
          .setTimestamp();

        await thread.send({
          content: `<@${applicantId}>`,
          embeds: [approvedThreadEmbed],
        });

        // Odanın adını güncelle ve kilitle
        await thread.setName(`✅・${activeApp.realName}`).catch(() => {});
        await thread.setLocked(true).catch(() => {});
      }
    }

    // 7. Kullanıcıya DM Gönder
    try {
      await applicantMember.user.send(
        `🎉 Tebrikler! **Piyade Team | TSB** sunucusundaki kayıt başvurunuz <@${interaction.user.id}> tarafından **onaylandı**.\nRolleriniz hesabınıza tanımlandı. İyi eğlenceler dileriz!`
      );
    } catch (e) {}

    return interaction.editReply({
      content: `✅ <@${applicantId}> kullanıcısının kaydı başarıyla onaylandı ve rolleri verildi!`,
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

  // Aktif başvurulardan kaldır (böylece tekrar başvurabilir)
  database.removeActiveApplication(applicantId);

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
            components: [], // Butonları kaldır
          });
        }
      }
    }
  } catch (cardErr) {
    console.error('[RED KART GÜNCELLEME HATASI]:', cardErr.message);
  }

  // 2. Özel Kayıt Odasına Bilgilendirme Gönder ve 5 Dakika Sonra Silinmesi İçin Zamanlayıcı Kur
  let threadRef = null;
  if (activeApp && activeApp.threadId) {
    threadRef = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
    if (threadRef) {
      const rejectedThreadEmbed = new EmbedBuilder()
        .setTitle('✖️ Kayıt Başvurunuz Reddedildi')
        .setColor(config.COLORS.DANGER)
        .setDescription(
          `❌ <@${applicantId}>, kayıt başvurunuz yetkili <@${interaction.user.id}> tarafından **REDDEDİLDİ**.\n\n` +
          `**Red Sebebi:**\n> ${rejectReason}\n\n` +
          `⚠️ **Dikkat:** Bu özel oda **5 dakika** içinde otomatik olarak silinecektir.\n` +
          `Hatalarınızı düzelterek kayıt kanalındaki panelden tekrar başvurabilirsiniz.`
        )
        .setTimestamp();

      await threadRef.send({
        content: `<@${applicantId}>`,
        embeds: [rejectedThreadEmbed],
      });

      await threadRef.setName('✖️・reddedildi').catch(() => {});

      // 5 dakika (300,000 ms) sonra odayı sil
      setTimeout(async () => {
        try {
          const t = await interaction.guild.channels.fetch(activeApp.threadId).catch(() => null);
          if (t) {
            await t.delete('Kayıt başvurusu reddedildi (5 dakika süre doldu)');
            console.log(`[THREAD TEMİZLİK] Reddedilen başvuru odası silindi (${activeApp.threadId}).`);
          }
        } catch (e) {}
      }, 5 * 60 * 1000);
    }
  }

  // 3. Kullanıcıya DM Gönder
  if (applicantMember) {
    try {
      await applicantMember.user.send(
        `✖️ **Piyade Team | TSB** sunucusundaki kayıt başvurunuz reddedildi.\n\n` +
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
