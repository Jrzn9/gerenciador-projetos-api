const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });

// Valores padrão para a suíte de testes (podem ser sobrescritos no .env.test):
// bcrypt barato para os testes rodarem rápido e limite de tentativas alto,
// já que todos os testes chegam do mesmo IP.
process.env.BCRYPT_ROUNDS ??= '4';
process.env.AUTH_RATE_LIMIT_MAX ??= '1000';
process.env.INVITE_RATE_LIMIT_MAX ??= '1000';
