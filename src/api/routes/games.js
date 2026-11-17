const express = require('express');
const router = express.Router();
const gamesConfig = require('../../../games.config');

/**
 * GET /api/games
 * Etkin (enabled) oyunların yapılandırmasını web sitesi kayıt formu için döndürür.
 * Not: Sunucu rol ID'leri (roleId) dışarıya ASLA döndürülmez.
 */
router.get('/', (req, res) => {
  const enabledGames = gamesConfig.getEnabledGames();

  const games = enabledGames.map((game) => {
    const rawRegex = game.validate?.regex;
    const serializedRegex =
      rawRegex instanceof RegExp ? rawRegex.source : rawRegex ? String(rawRegex) : null;

    return {
      id: game.id,
      emoji: game.emoji,
      name: {
        tr: game.name?.tr || game.id,
        en: game.name?.en || game.name?.tr || game.id,
      },
      buttonLabel: {
        tr: game.buttonLabel?.tr || game.name?.tr || game.id,
        en: game.buttonLabel?.en || game.name?.en || game.id,
      },
      usernameLabel: {
        tr: game.usernameLabel?.tr || '',
        en: game.usernameLabel?.en || '',
      },
      usernamePlaceholder: {
        tr: game.usernamePlaceholder?.tr || '',
        en: game.usernamePlaceholder?.en || '',
      },
      validate: {
        min: game.validate?.min ?? null,
        max: game.validate?.max ?? null,
        regex: serializedRegex,
      },
      verifier: game.verifier || null,
    };
  });

  return res.json({ games });
});

module.exports = router;
