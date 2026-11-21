require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const database = require('./src/utils/database');
const activityTracker = require('./src/utils/activityTracker');

/**
 * Discord Bot Intent listesini oluşturur.
 * ÖNEMLİ: Discord Developer Portal > Bot > Privileged Gateway Intents bölümünden
 * "PRESENCE INTENT", "SERVER MEMBERS INTENT" ve "MESSAGE CONTENT INTENT" açık olmalıdır.
 */
function buildClientIntents({ includePresenceIntent = true } = {}) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // Sunucuya katılan üyeleri ve rolleri algılamak için (Server Members Intent)
    GatewayIntentBits.GuildVoiceStates,  // Ses kanalı durumu ve oyun bazlı ses aktarımı için
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,    // !temizle gibi mesaj komutlarını okumak için (Message Content Intent)
  ];

  if (includePresenceIntent) {
    // Üyelerin Discord oyun etkinliğini okumak için (Developer Portal > Presence Intent açık olmalı)
    intents.push(GatewayIntentBits.GuildPresences);
  }

  return intents;
}

/**
 * Hatanın Discord Privileged/Disallowed Intents kaynaklı olup olmadığını kontrol eder.
 */
function isDisallowedIntentsError(err) {
  if (!err) return false;
  if (err.code === 4014) return true;
  const msg = String(err.message || err).toLowerCase();
  return msg.includes('disallowed intents') || msg.includes('privileged intent');
}

/**
 * Yeni Discord Client örneği oluşturur, komutları ve olayları bağlar.
 */
function createConfiguredClient({ includePresenceIntent = true } = {}) {
  const client = new Client({
    intents: buildClientIntents({ includePresenceIntent }),
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
  });

  client.commands = new Collection();
  client.activityPresenceDisabled = !includePresenceIntent;

  // 1. KOMUTLARI YÜKLE
  const commandsPath = path.join(__dirname, 'src', 'commands');
  if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        if (includePresenceIntent) {
          console.log(`[KOMUT YÜKLENDİ] /${command.data.name}`);
        }
      } else if (includePresenceIntent) {
        console.warn(`[UYARI] ${file} geçerli bir data veya execute yapısına sahip değil.`);
      }
    }
  }

  // 2. EVENTLERİ (OLAYLARI) YÜKLE
  const eventsPath = path.join(__dirname, 'src', 'events');
  if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
    for (const file of eventFiles) {
      const filePath = path.join(eventsPath, file);
      const event = require(filePath);
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }
      if (includePresenceIntent) {
        console.log(`[EVENT YÜKLENDİ] ${event.name}`);
      }
    }
  }

  return client;
}

/**
 * Discord'a önce Presence Intent açık şekilde giriş yapar.
 * Eğer Developer Portal'da Presence Intent kapalıysa ('Disallowed intents') çökmez;
 * tek satır net uyarı verip GuildPresences olmadan yeniden giriş yapar ve oyun etkinliği özelliğini kapatır.
 */
async function loginWithPresenceFallback({
  token,
  createClientFn = createConfiguredClient,
  tracker = activityTracker,
  logger = console,
  onClientCreated = null,
}) {
  const primaryClient = createClientFn({ includePresenceIntent: true });
  if (typeof onClientCreated === 'function') onClientCreated(primaryClient);

  try {
    await primaryClient.login(token);
    tracker.setPresenceEnabled(true);
    return { client: primaryClient, presenceEnabled: true };
  } catch (err) {
    if (!isDisallowedIntentsError(err)) {
      throw err;
    }

    logger.warn(
      "[UYARI] Presence Intent kapalı ('Disallowed intents'); oyun etkinliği sistemi devre dışı bırakılıp bot GuildPresences olmadan başlatılıyor. (Developer Portal > Bot > Presence Intent ve Server Members Intent açın.)"
    );

    try {
      primaryClient.destroy?.();
    } catch (destroyErr) {}

    tracker.setPresenceEnabled(false);

    const fallbackClient = createClientFn({ includePresenceIntent: false });
    fallbackClient.activityPresenceDisabled = true;
    if (typeof onClientCreated === 'function') onClientCreated(fallbackClient);

    await fallbackClient.login(token);
    return { client: fallbackClient, presenceEnabled: false };
  }
}

// Uygulama Doğrudan Çalıştırıldığında Başlat (Testlerde require edildiğinde botu ayağa kaldırma)
if (require.main === module) {
  let activeClient = null;
  let apiServer = null;
  let isShuttingDown = false;

  // Çökme Korumaları (Crash Prevention)
  process.on('unhandledRejection', (reason) => {
    console.error('[HATA - Yakalanmamış Rejection]:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[HATA - Yakalanmamış Exception]:', err);
  });

  // Zarif Kapanış (Railway deploy sırasında SIGTERM gönderir; son veriler mutlaka kaydedilir)
  async function handleGracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[KAPANIŞ] ${signal} sinyali alındı. Oyun etkinliği verileri kaydediliyor ve zamanlayıcılar kapatılıyor...`);

    try {
      await activityTracker.shutdown();
    } catch (err) {
      console.error('[KAPANIŞ HATASI] activityTracker.shutdown:', err.message);
    }

    try {
      database.flushDirty();
    } catch (err) {}

    try {
      activeClient?.destroy?.();
    } catch (err) {}

    try {
      apiServer?.close?.();
    } catch (err) {}

    process.exit(0);
  }

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

  // REST API Sunucusunu Başlat (Bot ile aynı süreçte; aktif istemciye dinamik bağlanır)
  const { startApiServer } = require('./src/api/server');
  apiServer = startApiServer(() => activeClient);

  // Botu Başlat
  if (!config.TOKEN) {
    console.error('========================================================================');
    console.error('❌ HATA: Bot tokeni (DISCORD_TOKEN) bulunamadı veya boş!');
    console.error('Railway Variables sekmesinde DISCORD_TOKEN değişkeninin tanımlı olduğundan emin olun.');
    console.error('========================================================================');
    process.exit(1);
  } else {
    console.log('🔄 Discord Gateway bağlantısı kuruluyor...');
    loginWithPresenceFallback({
      token: config.TOKEN,
      onClientCreated: (clientInstance) => {
        activeClient = clientInstance;
      },
    }).catch((err) => {
      console.error('========================================================================');
      console.error("❌ Bot Discord'a bağlanırken hata oluştu:", err.message);
      if (isDisallowedIntentsError(err)) {
        console.error('👉 ÇÖZÜM: Discord Developer Portal > Bot > Privileged Gateway Intents kısmından');
        console.error('   "PRESENCE INTENT", "SERVER MEMBERS INTENT" ve "MESSAGE CONTENT INTENT" seçeneklerini açın!');
      } else if (err.message.includes('An invalid token was provided')) {
        console.error("👉 ÇÖZÜM: Girdiğiniz bot tokeni geçersiz! Developer Portal'dan tokeni kopyalayıp");
        console.error('   Railway Variables kısmına tırnaksız olarak tekrar yapıştırın.');
      }
      console.error('========================================================================');
      process.exit(1);
    });
  }
}

module.exports = {
  buildClientIntents,
  isDisallowedIntentsError,
  createConfiguredClient,
  loginWithPresenceFallback,
};
