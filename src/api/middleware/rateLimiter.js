/**
 * Hafif ve Etkili In-Memory Sliding Window Rate Limiter
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // Varsayılan 1 dakika
  const max = options.max || 120; // 1 dakikada max istek
  const message = options.message || 'Çok fazla istek gönderildi. Lütfen bir süre bekleyin (Rate limit aşıldı).';
  const code = options.code || 'RATE_LIMITED';
  const keyGenerator =
    typeof options.keyGenerator === 'function'
      ? options.keyGenerator
      : (req) => req.headers['x-actor-id'] || req.ip || 'anonymous';

  const hits = new Map();

  // Her 5 dakikada bir eski kayıtları temizle
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits.entries()) {
      const active = timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, active);
      }
    }
  }, 5 * 60 * 1000).unref();

  function rateLimiter(req, res, next) {
    const key = String(keyGenerator(req) || 'anonymous');
    const now = Date.now();

    let userHits = hits.get(key) || [];
    userHits = userHits.filter((t) => now - t < windowMs);

    if (userHits.length >= max) {
      const oldestHit = userHits[0];
      const resetInSeconds = Math.ceil((oldestHit + windowMs - now) / 1000);

      res.setHeader('Retry-After', resetInSeconds);
      return res.status(429).json({
        error: message,
        code,
        retryAfter: resetInSeconds,
      });
    }

    userHits.push(now);
    hits.set(key, userHits);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - userHits.length));

    next();
  }

  rateLimiter.reset = () => hits.clear();
  return rateLimiter;
}

module.exports = {
  createRateLimiter,
};
