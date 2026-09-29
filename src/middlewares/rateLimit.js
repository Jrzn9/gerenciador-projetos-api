const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const MINUTE = 60 * 1000;

// Proteção contra força bruta: sem limite, um script poderia testar
// milhares de senhas por minuto contra a mesma conta.

// Login: conta só as tentativas que FALHARAM (senha errada) por IP
const loginLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: config.authRateLimit,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' },
});

// Cadastro: evita a criação de contas em massa a partir do mesmo endereço
const registerLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  limit: config.authRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitos cadastros a partir deste endereço. Tente novamente mais tarde.' },
});

// Criar/reenviar convites: por PESSOA (e não por IP), para ninguém usar
// a API para disparar convites em massa. Roda depois da autenticação.
const inviteLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  limit: config.inviteRateLimit,
  keyGenerator: (req) => req.userId,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Você enviou muitos convites em pouco tempo. Tente novamente mais tarde.' },
});

// Abrir/aceitar um link de convite: por IP. O token tem 256 bits e não dá
// para adivinhar, mas limitar tentativas é uma camada a mais.
const inviteLinkLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: config.inviteRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas com links de convite. Aguarde alguns minutos.' },
});

module.exports = { loginLimiter, registerLimiter, inviteLimiter, inviteLinkLimiter };
