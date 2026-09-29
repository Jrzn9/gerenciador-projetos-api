// Configurações lidas das variáveis de ambiente e validadas na inicialização.
// Se algo essencial para a segurança estiver faltando, a API nem sobe:
// é melhor falhar cedo do que rodar com um segredo fraco.

const MIN_SECRET_LENGTH = 32;

function readConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET precisa ter pelo menos ${MIN_SECRET_LENGTH} caracteres. ` +
        `Gere um com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    );
  }

  // Custo do bcrypt: cada +1 dobra o tempo do hash. 12 é um bom equilíbrio hoje;
  // nos testes usamos 4 para a suíte rodar rápido.
  const bcryptRounds = Number(env.BCRYPT_ROUNDS || 12);
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 15) {
    throw new Error('BCRYPT_ROUNDS deve ser um número inteiro entre 4 e 15.');
  }

  return {
    jwtSecret,
    // Sessões curtas limitam o estrago se um token vazar
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1d',
    bcryptRounds,
    corsOrigins: (env.CORS_ORIGIN || 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    // Tentativas permitidas por IP nas rotas de login e cadastro
    authRateLimit: Number(env.AUTH_RATE_LIMIT_MAX || 10),
    // Convites que cada pessoa pode criar por hora (e consultas de link por IP)
    inviteRateLimit: Number(env.INVITE_RATE_LIMIT_MAX || 30),
    // Quantos proxies existem na frente da API (Render, Railway...). Sem isso,
    // o limite por IP enxergaria o IP do proxy, e não o do usuário.
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
  };
}

module.exports = readConfig();
