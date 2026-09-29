// Limite baixo só neste arquivo (o Jest carrega os módulos de novo para cada arquivo de teste)
process.env.AUTH_RATE_LIMIT_MAX = '3';

const request = require('supertest');
const app = require('../src/app');

describe('limite de tentativas de login', () => {
  const login = (password) => request(app).post('/auth/login').send({ email: 'ana@teste.com', password });

  beforeEach(async () => {
    await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });
  });

  it('bloqueia com 429 depois de várias senhas erradas', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await login('senha-errada')).status).toBe(401);
    }

    const blocked = await login('senha-errada');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Muitas tentativas/);

    // Durante o bloqueio, nem a senha certa passa: o atacante não descobre se acertou
    expect((await login('senha-forte-123')).status).toBe(429);
  });
});
