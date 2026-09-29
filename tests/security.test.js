const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { createUser } = require('./helpers/auth');

const register = (body) => request(app).post('/auth/register').send(body);

describe('cabeçalhos e corpo das requisições', () => {
  it('envia cabeçalhos de segurança e esconde o Express', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('responde 400 (e não 500) para JSON malformado', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
  });

  it('recusa corpos maiores que 10 kB', async () => {
    const res = await register({ name: 'x'.repeat(20 * 1024), email: 'a@teste.com', password: 'senha-forte-123' });
    expect(res.status).toBe(413);
  });
});

describe('senhas', () => {
  it('exige pelo menos 8 caracteres', async () => {
    const res = await register({ name: 'Ana', email: 'ana@teste.com', password: '1234567' });
    expect(res.status).toBe(400);
  });

  it('recusa senhas acima de 72 bytes (limite do bcrypt)', async () => {
    const res = await register({ name: 'Ana', email: 'ana@teste.com', password: 'a'.repeat(73) });
    expect(res.status).toBe(400);
  });

  it('nunca devolve a senha nem o hash', async () => {
    const res = await register({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });
    expect(JSON.stringify(res.body)).not.toMatch(/senha-forte-123|\$2[aby]\$/);
  });
});

describe('e-mails', () => {
  it('trata maiúsculas e espaços como o mesmo e-mail', async () => {
    await register({ name: 'Ana', email: '  Ana@Teste.COM ', password: 'senha-forte-123' });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'ana@teste.com', password: 'senha-forte-123' });
    expect(login.status).toBe(200);

    const duplicate = await register({ name: 'Outra', email: 'ANA@teste.com', password: 'senha-forte-123' });
    expect(duplicate.status).toBe(409);
  });
});

describe('tokens JWT', () => {
  const me = (token) => request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

  async function validUserId() {
    const { token } = await createUser({ email: 'ana@teste.com' });
    return jwt.decode(token).sub;
  }

  it('recusa token assinado com outro segredo', async () => {
    const sub = await validUserId();
    const forged = jwt.sign({ sub }, 'um-segredo-qualquer-que-nao-e-o-da-api-123');
    expect((await me(forged)).status).toBe(401);
  });

  it('recusa token sem assinatura (alg "none")', async () => {
    const sub = await validUserId();
    const unsigned = jwt.sign({ sub }, null, { algorithm: 'none' });
    expect((await me(unsigned)).status).toBe(401);
  });

  it('recusa token expirado', async () => {
    const sub = await validUserId();
    const expired = jwt.sign({ sub, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    expect((await me(expired)).status).toBe(401);
  });

  it('exige o formato "Bearer <token>"', async () => {
    const { token } = await createUser({ email: 'ana@teste.com' });
    const res = await request(app).get('/auth/me').set('Authorization', token);
    expect(res.status).toBe(401);
  });

  it('emite tokens HS256 com expiração', async () => {
    const { token } = await createUser({ email: 'ana@teste.com' });
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.exp).toBeGreaterThan(decoded.payload.iat);
  });
});
