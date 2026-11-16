const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

const config = require('../../config');
const database = require('../utils/database');

let isResetInProgress = false;

/**
 * Kullanıcının Developer veya Sunucu Sahibi olup olmadığını doğrular
 */
function isDeveloper(member, guild) {
  if (!member) return false;
  if (guild && guild.ownerId === member.id) return true;
  if (config.ROLES.DEVELOPER && member.roles?.cache?.has(config.ROLES.DEVELOPER)) return true;
  return false;
}

/**
 * Kapsam etiketini döner
 */
function getScopeLabel(kapsam) {
  if (kapsam === 'warn') return 'Uyarılar (Ceza & Disiplin)';
  if (kapsam === 'reg') return 'Kayıtlar (Üye & Başvuru)';
  if (kapsam === 'all') return 'Hepsi (Uyarılar ve Kayıtlar)';
  return kapsam;
}

/**
 * Sıfırlama işlemini gerçekleştiren çekirdek fonksiyon (test edilebilir)
 */
async function performReset({ guild, scope, executorId, executorTag }) {
  if (isResetInProgress) {
    return { success: false, code: 'LOCKED', message: 'Şu anda zaten başka bir sıfırlama işlemi devam ediyor.' };
  }

  isResetInProgress = true;
  try {
    // 1. Önce Güvenlik Yedeği Al
    const backupResult = database.backupDatabaseForReset();
    if (!backupResult.success) {
      return {
        success: false,
        code: 'BACKUP_FAILED',
        message: `Güvenlik yedeği oluşturulamadı: ${backupResult.error}. Veri kaybını önlemek için sıfırlama işlemi durduruldu.`,
      };
    }

    const previewBefore = database.getResetPreviewCounts();
    let removedRolesCount = 0;
    let deletedThreadsCount = 0;

    // 2. Kapsama Göre Sıfırlama
    if (scope === 'warn' || scope === 'all') {
      database.resetWarningData();

      // Sunucu üyelerindeki uyarı ve askıda rollerini temizle
      if (guild) {
        const warningRoleIds = [
          ...(config.ROLES.WARNINGS || []),
          ...(config.ROLES.STAFF_WARNINGS || []),
          config.ROLES.SUSPENDED,
        ].filter(Boolean);

        try {
          await guild.members.fetch().catch(() => {});
          const membersWithWarningRoles = guild.members.cache.filter((m) =>
            warningRoleIds.some((rId) => m.roles.cache.has(rId)) ||
            (m.communicationDisabledUntil && m.communicationDisabledUntil > new Date())
          );

          for (const member of membersWithWarningRoles.values()) {
            const hasRolesToRemove = warningRoleIds.filter((rId) => member.roles.cache.has(rId));
            if (hasRolesToRemove.length > 0) {
              await member.roles.remove(hasRolesToRemove, 'Veri Sıfırlama: Uyarı rolleri kaldırıldı').catch(() => {});
              removedRolesCount += hasRolesToRemove.length;
            }
            if (member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()) {
              await member.timeout(null, 'Veri Sıfırlama: Karantina timeout kaldırıldı').catch(() => {});
            }
          }
        } catch (memErr) {
          console.warn('[VERİ SIFIRLA] Üye rolleri temizlenirken hata:', memErr.message);
        }
      }
    }

    if (scope === 'reg' || scope === 'all') {
      // Aktif başvuru odalarını temizle
      if (guild && database.data.activeApplications) {
        const apps = Object.values(database.data.activeApplications);
        for (const app of apps) {
          if (app && app.threadId) {
            try {
              const thread = await guild.channels.fetch(app.threadId).catch(() => null);
              if (thread) {
                await thread.delete('Veri Sıfırlama: Aktif başvuru odası temizlendi').catch(() => {});
                deletedThreadsCount++;
              }
            } catch (e) {}
          }
        }
      }

      database.resetRegistrationData();
    }

    return {
      success: true,
      backupFile: backupResult.fileName,
      scope,
      previewBefore,
      removedRolesCount,
      deletedThreadsCount,
      completedAt: Date.now(),
    };
  } finally {
    isResetInProgress = false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('veri-sifirla')
    .setDescription('Geliştirici için güvenli veri sıfırlama (Uyarılar, Kayıtlar veya Hepsi).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('kapsam')
        .setDescription('Sıfırlanacak veri kategorisini seçin')
        .setRequired(true)
        .addChoices(
          { name: 'Uyarılar (Tüm ceza/disiplin verileri ve uyarı rolleri)', value: 'warn' },
          { name: 'Kayıtlar (Tüm üye kayıtları ve başvuru verileri)', value: 'reg' },
          { name: 'Hepsi (Uyarılar ve Kayıtların tamamı)', value: 'all' }
        )
    ),

  isDeveloper,
  getScopeLabel,
  performReset,
  getResetLockStatus: () => isResetInProgress,

  async execute(interaction) {
    // 1. Yetki Kontrolü: Yalnızca Developer veya Sunucu Sahibi
    if (!isDeveloper(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: `❌ Bu komutu yalnızca Sunucu Sahibi veya <@&${config.ROLES.DEVELOPER}> rolüne sahip Developer kullanabilir!`,
        ephemeral: true,
      });
    }

    if (isResetInProgress) {
      return interaction.reply({
        content: '⚠️ Şu anda devam eden bir sıfırlama işlemi bulunmaktadır. Lütfen işlemin bitmesini bekleyiniz.',
        ephemeral: true,
      });
    }

    const scope = interaction.options.getString('kapsam');
    const scopeLabel = getScopeLabel(scope);
    const counts = database.getResetPreviewCounts();

    // 2. Aşama 1: Önizleme Kartı & Onay Butonları
    const previewEmbed = new EmbedBuilder()
      .setTitle(`⚠️ DİKKAT: Veri Sıfırlama Önizlemesi — ${scopeLabel}`)
      .setColor(config.COLORS.DANGER || 0xED4245)
      .setDescription(
        `Aşağıda sıfırlanacak verilerin listesi ve mevcut kayıt adetleri yer almaktadır.\n` +
        `Bu işlem **geri alınamaz**, ancak işlem başlamadan önce otomatik olarak **tam bir güvenlik yedeği** alınacaktır.\n\n` +
        `Devam etmek için aşağıdaki **"Devam Et"** butonuna basınız ve açılan pencereye **"SIFIRLA"** yazınız.`
      )
      .addFields(
        {
          name: '🎯 Seçilen Kapsam',
          value: `\`${scopeLabel}\``,
          inline: false,
        },
        {
          name: '⚖️ Uyarı Sistemi Verileri',
          value:
            scope === 'reg'
              ? '*(Bu kapsamda uyarı verilerine dokunulmayacak)*'
              : `• Ceza Puanı Olan Üyeler: **${counts.warnedUsersCount}**\n` +
                `• Toplam Uyarı Kaydı: **${counts.totalWarningsCount}**\n` +
                `• Aktif Askıda / Karantina: **${counts.activeTimeoutCount}**\n` +
                `• Sunucudaki Uyarı Rolleri: *Otomatik kaldırılacak*`,
          inline: true,
        },
        {
          name: '🛡️ Kayıt Sistemi Verileri',
          value:
            scope === 'warn'
              ? '*(Bu kapsamda kayıt verilerine dokunulmayacak)*'
              : `• Kayıtlı Üye Sayısı: **${counts.registrationsCount}**\n` +
                `• Bekleyen Aktif Başvuru: **${counts.activeApplicationsCount}**\n` +
                `• Başvuru Odaları (Threads): *Otomatik silinecek*`,
          inline: true,
        }
      )
      .setFooter({ text: `${config.BRAND_NAME} • Güvenli Veri Sıfırlama Protokolü` })
      .setTimestamp();

    const continueBtn = new ButtonBuilder()
      .setCustomId(`btn_reset_continue_${interaction.id}`)
      .setLabel('Devam Et')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`btn_reset_cancel_${interaction.id}`)
      .setLabel('Vazgeç')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(continueBtn, cancelBtn);

    const replyMsg = await interaction.reply({
      embeds: [previewEmbed],
      components: [row],
      ephemeral: true,
    });

    // 3. Buton Etkileşimini Yakala (60 saniye süre)
    let buttonInteraction = null;
    try {
      buttonInteraction = await replyMsg.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 60 * 1000,
      });
    } catch (e) {
      return interaction.editReply({
        content: '⏱️ Süre doldu. Veri sıfırlama işlemi iptal edildi.',
        embeds: [],
        components: [],
      }).catch(() => {});
    }

    if (!buttonInteraction) return;

    if (buttonInteraction.customId === `btn_reset_cancel_${interaction.id}`) {
      return buttonInteraction.update({
        content: '❌ Veri sıfırlama işlemi kullanıcı tarafından iptal edildi.',
        embeds: [],
        components: [],
      });
    }

    // 4. Aşama 2: Modal Onay Penceresi (Büyük harfle SIFIRLA)
    const modal = new ModalBuilder()
      .setCustomId(`modal_reset_confirm_${interaction.id}`)
      .setTitle('Veri Sıfırlama Onayı');

    const confirmInput = new TextInputBuilder()
      .setCustomId('modal_reset_confirm_input')
      .setLabel('Onaylamak için büyük harflerle SIFIRLA yazın:')
      .setPlaceholder('SIFIRLA')
      .setStyle(TextInputStyle.Short)
      .setMinLength(7)
      .setMaxLength(7)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(confirmInput));

    await buttonInteraction.showModal(modal);

    // 5. Modal Gönderimini Yakala (60 saniye süre)
    let modalSubmit = null;
    try {
      modalSubmit = await buttonInteraction.awaitModalSubmit({
        filter: (m) => m.user.id === interaction.user.id,
        time: 60 * 1000,
      });
    } catch (err) {
      return interaction.editReply({
        content: '⏱️ Modal onay süresi doldu. Veri sıfırlama işlemi iptal edildi.',
        embeds: [],
        components: [],
      }).catch(() => {});
    }

    if (!modalSubmit) return;

    const typedText = modalSubmit.fields.getTextInputValue('modal_reset_confirm_input').trim();

    if (typedText !== 'SIFIRLA') {
      return modalSubmit.reply({
        content: `❌ Onay başarısız! Yazılan ifade: \`${typedText}\`. İşlemin gerçekleşmesi için tam olarak **SIFIRLA** yazılmalıdır. İşlem iptal edildi.`,
        ephemeral: true,
      });
    }

    // 6. Sıfırlamayı Yürüt
    await modalSubmit.deferReply({ ephemeral: true });

    const result = await performReset({
      guild: interaction.guild,
      scope,
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
    });

    if (!result.success) {
      return modalSubmit.editReply({
        content: `❌ Sıfırlama başarısız oldu: ${result.message}`,
      });
    }

    // 7. Başarı Kartı (Kullanıcıya Ephemeral)
    const successEmbed = new EmbedBuilder()
      .setTitle(`✅ Veri Sıfırlama Başarıyla Tamamlandı`)
      .setColor(config.COLORS.SUCCESS || 0x57F287)
      .setDescription(
        `Seçilen kapsamdaki tüm veriler başarıyla sıfırlandı ve otomatik yedek oluşturuldu.`
      )
      .addFields(
        { name: '🎯 Sıfırlanan Kapsam', value: `\`${scopeLabel}\``, inline: true },
        { name: '💾 Güvenlik Yedeği Dosyası', value: `\`${result.backupFile}\``, inline: true },
        {
          name: '📊 Sıfırlanan Kayıtlar',
          value:
            scope === 'warn'
              ? `• ${result.previewBefore.totalWarningsCount} adet uyarı kaydı silindi\n• ${result.removedRolesCount} adet uyarı rolü geri alındı`
              : scope === 'reg'
              ? `• ${result.previewBefore.registrationsCount} adet üye kaydı silindi\n• ${result.deletedThreadsCount} adet kayıt odası temizlendi`
              : `• ${result.previewBefore.totalWarningsCount} adet uyarı kaydı silindi\n• ${result.removedRolesCount} adet uyarı rolü geri alındı\n• ${result.previewBefore.registrationsCount} adet üye kaydı silindi\n• ${result.deletedThreadsCount} adet kayıt odası temizlendi`,
          inline: false,
        },
        { name: '👮 İşlemi Yapan Developer', value: `<@${interaction.user.id}>`, inline: true },
        { name: '🕒 Tamamlanma Zamanı', value: `<t:${Math.floor(result.completedAt / 1000)}:F>`, inline: true }
      )
      .setFooter({ text: `${config.BRAND_NAME} • Güvenlik Sistemi` })
      .setTimestamp();

    await modalSubmit.editReply({ embeds: [successEmbed] });

    // 8. Uyarı Log Kanalına Bilgi Gönder
    if (interaction.guild && config.CHANNELS.WARNING_LOG) {
      try {
        const logChannel = interaction.guild.channels.cache.get(config.CHANNELS.WARNING_LOG);
        if (logChannel) {
          const auditEmbed = new EmbedBuilder()
            .setTitle(`🚨 [GÜVENLİK BİLDİRİMİ] Sunucu Veri Sıfırlama Gerçekleştirildi`)
            .setColor(config.COLORS.DANGER || 0xED4245)
            .setDescription(
              `Developer yetkisine sahip bir kullanıcı tarafından sunucu veritabanı sıfırlama işlemi yürütüldü.`
            )
            .addFields(
              { name: '👮 İşlemi Gerçekleştiren', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
              { name: '🎯 Kapsam', value: `\`${scopeLabel}\``, inline: true },
              { name: '💾 Otomatik Alınan Güvenlik Yedeği', value: `\`${result.backupFile}\``, inline: false },
              {
                name: '📊 İşlem Özeti',
                value:
                  scope === 'warn'
                    ? `• Uyarı Kayıtları: ${result.previewBefore.totalWarningsCount} adet silindi\n• Uyarı Rolleri: ${result.removedRolesCount} adet kaldırıldı`
                    : scope === 'reg'
                    ? `• Üye Kayıtları: ${result.previewBefore.registrationsCount} adet silindi\n• Başvuru Odaları: ${result.deletedThreadsCount} adet kapatıldı`
                    : `• Uyarı Kayıtları: ${result.previewBefore.totalWarningsCount} adet silindi\n• Uyarı Rolleri: ${result.removedRolesCount} adet kaldırıldı\n• Üye Kayıtları: ${result.previewBefore.registrationsCount} adet silindi\n• Başvuru Odaları: ${result.deletedThreadsCount} adet kapatıldı`,
                inline: false,
              },
              { name: '🕒 Tarih / Saat', value: `<t:${Math.floor(result.completedAt / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: `${config.BRAND_NAME} • Güvenlik Denetim Kaydı` })
            .setTimestamp();

          await logChannel.send({ embeds: [auditEmbed] });
        }
      } catch (logErr) {
        console.warn('[VERİ SIFIRLA LOG HATASI]:', logErr.message);
      }
    }
  },
};
