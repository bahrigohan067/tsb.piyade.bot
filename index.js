require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Bot İstemcisi ve Intent Tanımları
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // Sunucuya katılan üyeleri ve rolleri algılamak için
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

client.commands = new Collection();

// 1. KOMUTLARI YÜKLE
const commandsPath = path.join(__dirname, 'src', 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`[KOMUT YÜKLENDİ] /${command.data.name}`);
    } else {
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
    console.log(`[EVENT YÜKLENDİ] ${event.name}`);
  }
}

// Çökme Korumaları (Crash Prevention)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[HATA - Yakalanmamış Rejection]:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error('[HATA - Yakalanmamış Exception]:', err);
});

// Botu Başlat
if (!config.TOKEN) {
  console.error('========================================================================');
  console.error('❌ HATA: Bot tokeni (TSB_TOKEN) bulunamadı veya boş!');
  console.error('Railway Variables sekmesinde TSB_TOKEN değişkeninin tanımlı olduğundan emin olun.');
  console.error('========================================================================');
  process.exit(1);
} else {
  console.log('🔄 Discord Gateway bağlantısı kuruluyor...');
  client.login(config.TOKEN).catch((err) => {
    console.error('========================================================================');
    console.error('❌ Bot Discord\'a bağlanırken hata oluştu:', err.message);
    if (err.message.includes('disallowed intents') || err.message.includes('Privileged intent')) {
      console.error('👉 ÇÖZÜM: Discord Developer Portal > Bot > Privileged Gateway Intents kısmından');
      console.error('   "SERVER MEMBERS INTENT" ve "MESSAGE CONTENT INTENT" seçeneklerini açın!');
    } else if (err.message.includes('An invalid token was provided')) {
      console.error('👉 ÇÖZÜM: Girdiğiniz TSB_TOKEN geçersiz! Developer Portal\'dan tokeni kopyalayıp');
      console.error('   Railway Variables kısmına tırnaksız olarak tekrar yapıştırın.');
    }
    console.error('========================================================================');
    process.exit(1);
  });
}
