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
  console.error('❌ HATA: Bot tokeni bulunamadı!');
  console.error('Lütfen .env dosyasına TSB_TOKEN=... ekleyin veya Railway üzerinde');
  console.error('Environment Variables kısmına TSB_TOKEN değişkenini tanımlayın.');
  console.error('========================================================================');
} else {
  client.login(config.TOKEN).catch((err) => {
    console.error('❌ Bot Discord\'a bağlanırken hata oluştu:', err.message);
  });
}
