/**
 * Dost ve Düşman Klan Paneli Yöneticisi
 * CHANNELS.CLAN_PANEL (1570462108691210432) üzerinde iki embedli kalıcı mesajı yönetir.
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../../config');
const database = require('./database');

/**
 * Mevcut bilinen klanlara göre panel embedlerini üretir.
 * @returns {EmbedBuilder[]}
 */
function buildClanPanelEmbeds() {
  const allClans = database.getKnownClans();

  const allies = allClans
    .filter((c) => c.type === 'ally')
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const enemies = allClans
    .filter((c) => c.type === 'enemy')
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const embeds = [];

  // 1. DOST KLANLAR EMBED(LERİ)
  const allyHeader =
    'Piyade Clan | TSB\'nin dost klanları. • Allied clans of Piyade Clan | TSB.\n\n';
  const allyLines = allies.length
    ? allies.map((c) => `⚪ **${c.name}**`)
    : ['— Henüz klan eklenmedi • No clans yet'];

  // 4096 karakter sınırına göre parçala
  const allyChunks = [];
  let currentChunk = allyHeader;
  for (const line of allyLines) {
    if ((currentChunk + line + '\n').length > 3900) {
      allyChunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += line + '\n';
  }
  if (currentChunk.trim()) {
    allyChunks.push(currentChunk.trim());
  }

  allyChunks.forEach((chunk, idx) => {
    const isMulti = allyChunks.length > 1;
    const embed = new EmbedBuilder()
      .setTitle(
        `⚪ Dost Klanlar • Allied Clans${isMulti ? ` (${idx + 1}/${allyChunks.length})` : ''}`
      )
      .setColor(config.COLORS.ALLY || 0xF2F3F5)
      .setDescription(chunk)
      .setFooter({
        text: `${allies.length} klan • ${allies.length} clans | Piyade Registry`,
      })
      .setTimestamp();
    embeds.push(embed);
  });

  // 2. DÜŞMAN KLANLAR EMBED(LERİ)
  const enemyHeader =
    'Piyade Clan | TSB\'nin düşman klanları. • Enemy clans of Piyade Clan | TSB.\n\n';
  const enemyLines = enemies.length
    ? enemies.map((c) => `⚫ **${c.name}**`)
    : ['— Henüz klan eklenmedi • No clans yet'];

  const enemyChunks = [];
  let currentEnemyChunk = enemyHeader;
  for (const line of enemyLines) {
    if ((currentEnemyChunk + line + '\n').length > 3900) {
      enemyChunks.push(currentEnemyChunk.trim());
      currentEnemyChunk = '';
    }
    currentEnemyChunk += line + '\n';
  }
  if (currentEnemyChunk.trim()) {
    enemyChunks.push(currentEnemyChunk.trim());
  }

  enemyChunks.forEach((chunk, idx) => {
    const isMulti = enemyChunks.length > 1;
    const embed = new EmbedBuilder()
      .setTitle(
        `⚫ Düşman Klanlar • Enemy Clans${isMulti ? ` (${idx + 1}/${enemyChunks.length})` : ''}`
      )
      .setColor(config.COLORS.ENEMY || 0x0D0D0D)
      .setDescription(chunk)
      .setFooter({
        text: `${enemies.length} klan • ${enemies.length} clans | Piyade Registry`,
      })
      .setTimestamp();
    embeds.push(embed);
  });

  // En fazla 10 embed döndür
  return embeds.slice(0, 10);
}

/**
 * Belirtilen veya varsayılan kanaldaki panel mesajını günceller; yoksa yeni mesaj gönderir.
 * @param {import('discord.js').Guild} guild 
 * @param {string} [customChannelId] 
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function updateClanPanel(guild, customChannelId = null) {
  if (!guild) return { success: false, error: 'GUILD_NOT_FOUND' };

  const stored = database.getClanPanelMessage();
  const channelId = customChannelId || stored.channelId || config.CHANNELS.CLAN_PANEL;
  if (!channelId) return { success: false, error: 'CHANNEL_NOT_CONFIGURED' };

  const channel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel) return { success: false, error: 'CHANNEL_NOT_FOUND' };

  const embeds = buildClanPanelEmbeds();

  try {
    let panelMessage = null;
    if (stored.messageId) {
      panelMessage = await channel.messages.fetch(stored.messageId).catch(() => null);
    }

    if (panelMessage) {
      await panelMessage.edit({
        embeds,
        allowedMentions: { parse: [] },
      });
      database.setClanPanelMessage(channelId, panelMessage.id);
      return { success: true, messageId: panelMessage.id };
    }

    // Eski mesaj bulunamadıysa kanaldaki son 15 mesajı tara
    const recentMessages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    if (recentMessages) {
      const adopted = recentMessages.find(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.embeds.some(
            (e) =>
              e.footer?.text &&
              e.footer.text.includes('Piyade Registry')
          )
      );
      if (adopted) {
        await adopted.edit({
          embeds,
          allowedMentions: { parse: [] },
        });
        database.setClanPanelMessage(channelId, adopted.id);
        return { success: true, messageId: adopted.id };
      }
    }

    // Sıfırdan yeni mesaj gönder
    const newMsg = await channel.send({
      embeds,
      allowedMentions: { parse: [] },
    });
    database.setClanPanelMessage(channelId, newMsg.id);
    return { success: true, messageId: newMsg.id };
  } catch (err) {
    console.error('[CLAN PANEL UPDATE ERROR]:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Bot açılışında panel mesajının varlığını doğrular ve günceller.
 */
async function ensureClanPanelMessage(guild) {
  return updateClanPanel(guild);
}

module.exports = {
  buildClanPanelEmbeds,
  updateClanPanel,
  ensureClanPanelMessage,
};
