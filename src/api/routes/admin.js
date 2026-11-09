const express = require('express');
const router = express.Router();
const database = require('../../utils/database');
const { requireManagement, getMemberLevel } = require('../middleware/auth');
const {
  checkWarningHierarchy,
  executeVerbalWarning,
  executeOfficialWarning,
  attachEvidenceToWarning,
  RULES,
} = require('../../utils/warningManager');
const { getLevelRoleById } = require('../../utils/tryoutManager');
const { sendWebAuditLog } = require('../utils/auditLogger');

// Tüm admin endpoint'leri Yönetmenlik veya Developer yetkisi gerektirir
router.use(requireManagement);

/**
 * GET /api/admin/members?query=
 * Sunucu üyeleri arasında isim, nick, ID veya Roblox adına göre arama yapar.
 */
router.get('/members', async (req, res) => {
  const query = String(req.query.query || '').trim().toLowerCase();

  try {
    // Sunucu üyelerini getir (önbelleği tazele)
    await req.guild.members.fetch({ limit: 1000 }).catch(() => {});

    let members = Array.from(req.guild.members.cache.values());

    if (query) {
      const allRegs = database.getAllRegistrations();
      const matchedDiscordIdsFromReg = new Set(
        allRegs
          .filter(
            (r) =>
              (r.realName && r.realName.toLowerCase().includes(query)) ||
              (r.robloxUsername && r.robloxUsername.toLowerCase().includes(query)) ||
              (r.robloxId && String(r.robloxId).includes(query))
          )
          .map((r) => String(r.discordId))
      );

      members = members.filter((m) => {
        const idMatch = m.id.includes(query);
        const userMatch = m.user.username.toLowerCase().includes(query);
        const nickMatch = m.displayName.toLowerCase().includes(query);
        const regMatch = matchedDiscordIdsFromReg.has(m.id);
        return idMatch || userMatch || nickMatch || regMatch;
      });
    }

    // Maksimum 50 üye döndür
    const sliced = members.slice(0, 50);

    const results = sliced.map((m) => {
      const reg = database.getRegistrationByDiscordId(m.id);
      const warnStats = database.getUserWarningStats(m.id);
      const level = getMemberLevel(m, req.guild);

      return {
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatarUrl: m.user.displayAvatarURL({ dynamic: true }),
        joinedAt: m.joinedTimestamp,
        createdAt: m.user.createdTimestamp,
        level,
        registration: {
          registered: Boolean(reg),
          realName: reg?.realName || null,
          robloxUsername: reg?.robloxUsername || null,
          robloxId: reg?.robloxId || null,
        },
        warnings: {
          points: warnStats.points || 0,
          tier: warnStats.tier || 0,
          staffWarnings: warnStats.staffWarnings || 0,
          totalWarnings: warnStats.totalWarnings || 0,
          suspendedUntil: warnStats.suspendedUntil || null,
        },
      };
    });

    return res.json({
      total: results.length,
      members: results,
    });
  } catch (err) {
    return res.status(500).json({ error: `Üyeler aranırken hata oluştu: ${err.message}` });
  }
});

/**
 * GET /api/admin/members/:id
 * Kullanıcının Discord bilgileri + sunucu içi tüm kayıtları + sicil geçmişini döndürür.
 */
router.get('/members/:id', async (req, res) => {
  const { id } = req.params;

  if (!id || !/^\d{1,21}$/.test(id)) {
    return res.status(400).json({ error: 'Geçersiz Discord ID formatı.' });
  }

  try {
    const member = await req.guild.members.fetch(id).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Kullanıcı Discord sunucusunda bulunamadı.' });
    }

    // 1. Roller
    const roles = member.roles.cache
      .filter((r) => r.id !== req.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        isHoisted: r.hoist,
      }));

    // 2. Kayıt Bilgisi
    const reg = database.getRegistrationByDiscordId(id);

    // 3. Tryout İstatistikleri & Form Geçmişi
    const tryoutStats = database.getTryoutStats(id);
    let tryoutRole = null;
    if (tryoutStats && tryoutStats.roleId) {
      tryoutRole = getLevelRoleById(tryoutStats.roleId);
    }

    const tryoutForms = Object.values(database.data.tryoutForms || {})
      .filter((f) => String(f.userId) === id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 4. Uyarı / Disiplin Geçmişi
    const warnStats = database.getUserWarningStats(id);
    const warningHistory = Object.values(database.data.warnings || {})
      .filter((w) => String(w.userId) === id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 5. Küfür / Argo İhlal Sayısı
    const profanityCount = database.getProfanityCount(id);

    const level = getMemberLevel(member, req.guild);

    // 6. Denetim Logu (Üye Bilgileri / Sicil Görüntüleme)
    if (req.query.audit === '1' && req.actorUser) {
      console.log(
        `[DENETİM LOGU] Yetkili ${req.actorUser.tag || req.actorUser.username} (${req.actorUser.id}), ${member.displayName} (${member.id}) üyesinin detaylarını görüntüledi. Zaman: ${new Date().toISOString()}`
      );
      sendWebAuditLog(req.guild, {
        actor: req.actorUser,
        target: member.user,
        action: '🔍 Üye Bilgileri / Sicil Görüntülendi',
        details: `**İncelenen Üye:** <@${member.id}> (\`${member.id}\`)\n**Zaman:** <t:${Math.floor(Date.now() / 1000)}:F>`,
      }).catch(() => {});
    }

    return res.json({
      discord: {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarUrl: member.user.displayAvatarURL({ dynamic: true }),
        joinedAt: member.joinedTimestamp,
        createdAt: member.user.createdTimestamp,
        level,
        roles,
      },
      registration: {
        registered: Boolean(reg),
        realName: reg?.realName || null,
        gender: reg?.gender || null,
        robloxUsername: reg?.robloxUsername || null,
        robloxId: reg?.robloxId || null,
        robloxDisplayName: reg?.robloxDisplayName || null,
        robloxProfileUrl: reg?.robloxId ? `https://www.roblox.com/users/${reg.robloxId}/profile` : null,
        registeredAt: reg?.registeredAt || null,
      },
      tryout: {
        current: {
          level: tryoutStats?.level || 0,
          roleId: tryoutStats?.roleId || null,
          roleName: tryoutRole?.name || null,
          canonical: tryoutRole?.canonical || null,
          formCount: tryoutStats?.formCount || 0,
          lastUpdated: tryoutStats?.lastUpdated || null,
        },
        forms: tryoutForms,
      },
      vs: {
        points: 0,
        wins: 0,
        losses: 0,
        kills: 0,
      },
      warnings: {
        stats: {
          points: warnStats.points || 0,
          tier: warnStats.tier || 0,
          staffWarnings: warnStats.staffWarnings || 0,
          totalWarnings: warnStats.totalWarnings || 0,
          suspendedUntil: warnStats.suspendedUntil || null,
        },
        history: warningHistory,
      },
      moderation: {
        profanityViolationCount: profanityCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: `Kullanıcı detayları alınırken hata oluştu: ${err.message}` });
  }
});

/**
 * POST /api/admin/warn
 * warningManager ile birebir aynı sonuçları üreten uyarı verme endpoint'i.
 * Sözlü veya resmi, kural M/D/Y, puan, rol, timeout, ban, askıda ve log kartı oluşturur.
 */
router.post('/warn', async (req, res) => {
  const { targetUserId, type, reason, ruleCode } = req.body;

  if (!targetUserId || !/^\d{1,21}$/.test(String(targetUserId))) {
    return res.status(400).json({ error: 'Geçersiz veya eksik hedef kullanıcı ID ("targetUserId").' });
  }

  const cleanType = String(type || '').trim().toLowerCase();
  if (cleanType !== 'verbal' && cleanType !== 'official') {
    return res.status(400).json({ error: 'Uyarı tipi ("type") sadece "verbal" (sözlü) veya "official" (resmi) olabilir.' });
  }

  try {
    const targetMember = await req.guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember) {
      return res.status(404).json({ error: 'Hedef kullanıcı Discord sunucusunda bulunamadı.' });
    }

    // UYARI HİYERARŞİSİ DOĞRULAMASI
    // Kimse kendine uyarı veremez. Hedefin en yüksek rolü >= aktör ise reddet.
    // Developer istisna: kendisi dışında herkese verebilir.
    const hierarchy = checkWarningHierarchy(req.actorMember, targetMember);
    if (!hierarchy.allowed) {
      return res.status(hierarchy.status || 403).json({ error: hierarchy.message });
    }

    // A) SÖZLÜ UYARI
    if (cleanType === 'verbal') {
      const cleanReason = String(reason || '').trim();
      if (!cleanReason || cleanReason.length < 2) {
        return res.status(400).json({ error: 'Sözlü uyarı için geçerli bir gerekçe ("reason") girilmelidir (en az 2 karakter).' });
      }

      const result = await executeVerbalWarning({
        guild: req.guild,
        targetMember,
        staffUser: req.actorUser,
        staffMember: req.actorMember,
        reason: cleanReason,
        source: 'site',
      });

      // Web Yönetim Paneli Denetim Logu
      await sendWebAuditLog(req.guild, {
        actor: req.actorUser,
        target: targetMember.user,
        action: '🗣️ Sözlü Uyarı Verildi',
        details: `**Gerekçe:** ${cleanReason}\n**Uygulanan Ceza:** 0 Puan, Puansız Sözlü İhtar`,
        warnId: result.warnId,
      });

      return res.json({
        success: true,
        warnId: result.warnId,
        type: 'verbal',
        record: result.record,
        newStats: result.newStats,
      });
    }

    // B) RESMİ UYARI (MADDE NO İLE)
    if (cleanType === 'official') {
      const cleanRuleCode = String(ruleCode || '').trim().toUpperCase();
      if (!cleanRuleCode) {
        return res.status(400).json({
          error: 'Resmi uyarı için kural kodu ("ruleCode") gereklidir (Örn: M1, M2, D1, Y1 vb.).',
        });
      }

      const rule = RULES[cleanRuleCode];
      if (!rule) {
        return res.status(400).json({
          error: `Geçersiz kural kodu ("${cleanRuleCode}"). Geçerli kurallar: Katılımcı: M1-M13, D1-D3 | Yetkili: Y1-Y5`,
        });
      }

      const result = await executeOfficialWarning({
        guild: req.guild,
        targetMember,
        staffUser: req.actorUser,
        staffMember: req.actorMember,
        ruleCode: cleanRuleCode,
        source: 'site',
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Web Yönetim Paneli Denetim Logu
      await sendWebAuditLog(req.guild, {
        actor: req.actorUser,
        target: targetMember.user,
        action: `⚠️ Resmi Uyarı Verildi (${result.rule.code})`,
        details:
          `**Madde:** \`${result.rule.code}\` — ${result.rule.description}\n` +
          `**Ceza:** ${result.record.pointsDisplay}\n` +
          `**Uygulanan İşlem:** ${result.actionTakenText}\n` +
          `**Bitiş Tarihi:** ${result.record.expiresAtText}`,
        warnId: result.warnId,
      });

      return res.json({
        success: true,
        warnId: result.warnId,
        type: 'official',
        ruleCode: result.rule.code,
        ruleDescription: result.rule.description,
        actionTaken: result.actionTakenText,
        record: result.record,
        newStats: result.newStats,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: `Uyarı uygulanırken hata meydana geldi: ${err.message}` });
  }
});

/**
 * POST /api/admin/warn/:id/evidence
 * Önceden verilmiş bir uyarıya kanıt görseli (bellekten Buffer veya URL) ekler ve uyarı log kartını günceller.
 */
router.post('/warn/:id/evidence', async (req, res) => {
  const warnId = req.params.id;
  const { evidenceUrl, evidenceBase64, fileName } = req.body;

  if (!warnId) {
    return res.status(400).json({ error: 'Uyarı ID parametresi zorunludur.' });
  }

  let fileBuffer = null;
  let safeFileName = null;

  if (evidenceBase64 && typeof evidenceBase64 === 'string') {
    fileBuffer = Buffer.from(evidenceBase64, 'base64');
    if (fileBuffer.length === 0 || fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Kanıt görseli boyutu 0 ile 5 MB arasında olmalıdır.' });
    }
    safeFileName = String(fileName || `kanit_${warnId}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
  } else if (!evidenceUrl || !/^https?:\/\/\S+/i.test(String(evidenceUrl))) {
    return res.status(400).json({
      error: 'Geçerli bir kanıt görseli dosyası ("evidenceBase64") veya bağlantısı ("evidenceUrl") gönderilmelidir.',
    });
  }

  try {
    const result = await attachEvidenceToWarning({
      guild: req.guild,
      warnId,
      evidenceUrl: evidenceUrl ? String(evidenceUrl).trim() : null,
      fileBuffer,
      fileName: safeFileName,
      staffUser: req.actorUser,
      staffMember: req.actorMember,
      source: 'site',
    });

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    // Web Yönetim Paneli Denetim Logu
    const targetUser = { id: result.record.userId };
    const finalUrl = result.proofUrl || evidenceUrl || 'Discord Eki';
    await sendWebAuditLog(req.guild, {
      actor: req.actorUser,
      target: targetUser,
      action: '📎 Uyarıya Kanıt Görseli Eklendi',
      details: `**Eklenen Kanıt:** ${/^https?:\/\//i.test(finalUrl) ? `[Görseli Aç](${finalUrl})` : finalUrl}\n**İlgili Uyarı:** #${warnId} (${result.record.reasonDisplay || result.record.ruleCode})`,
      warnId: result.warnId,
    });

    return res.json({
      success: true,
      warnId: result.warnId,
      proofUrl: result.proofUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: `Kanıt görseli eklenirken hata oluştu: ${err.message}` });
  }
});

module.exports = router;
