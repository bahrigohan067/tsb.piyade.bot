const express = require('express');
const cors = require('cors');
const config = require('../../config');
const { apiKeyAuth } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimiter');

// Rotalar
const memberRoutes = require('./routes/member');
const registerRoutes = require('./routes/register');
const adminRoutes = require('./routes/admin');
const feedbackRoutes = require('./routes/feedback');
const gamesRoutes = require('./routes/games');
const robloxRoutes = require('./routes/roblox');

function createApp(clientOrGetter) {
  const app = express();
  const resolveClient = typeof clientOrGetter === 'function' ? clientOrGetter : () => clientOrGetter;

  // Temel Middleware'ler
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Discord Client ve Guild Enjeksiyonu
  app.use((req, res, next) => {
    const activeClient = resolveClient();
    req.client = activeClient;
    req.guild =
      activeClient?.guilds?.cache?.get(config.GUILD_ID) ||
      activeClient?.guilds?.cache?.first() ||
      null;
    next();
  });

  // Global Rate Limiter (1 dakikada max 120 istek)
  app.use(createRateLimiter({ windowMs: 60 * 1000, max: 120 }));

  // Healthcheck (Railway veya dış izleme servisleri için şifresiz uç nokta)
  app.get('/api/health', (req, res) => {
    const activeClient = resolveClient();
    return res.json({
      status: 'ok',
      botReady: Boolean(activeClient?.isReady?.()),
      botTag: activeClient?.user ? activeClient.user.tag : null,
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // Güvenlik Katmanı: Tüm /api endpoint'leri "Authorization: Bearer API_SECRET" zorunlu tutar
  app.use('/api', apiKeyAuth);

  // API Rotaları
  app.use('/api/member', memberRoutes);
  app.use('/api/register', registerRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/games', gamesRoutes);
  app.use('/api/roblox', robloxRoutes);

  // 404 Yakalayıcı (Tüm eşleşmeyen /api rotaları için)
  app.use('/api', (req, res) => {
    return res.status(404).json({ error: 'Endpoint bulunamadı.' });
  });

  // Global Hata Yakalayıcı
  app.use((err, req, res, next) => {
    console.error('[API SUNUCU HATASI]:', err);
    return res.status(500).json({ error: `Sunucu içi hata: ${err.message}` });
  });

  return app;
}

/**
 * REST API Sunucusunu Başlatır
 */
function startApiServer(client) {
  const app = createApp(client);
  const port = config.PORT || 3000;

  const server = app.listen(port, () => {
    console.log(`=========================================`);
    console.log(`🚀 REST API Sunucusu Aktif! Port: ${port}`);
    console.log(`🔒 Güvenlik: Bearer API_SECRET doğrulaması devrede`);
    console.log(`=========================================`);
  });

  server.on('error', (err) => {
    console.error('[API SUNUCU BAŞLATMA HATASI]:', err.message);
  });

  return server;
}

module.exports = {
  createApp,
  startApiServer,
};
