const request = require('supertest');
const app = require('../src/app');

describe('POST /auth/register', () => {
  it('cria um usuário e não retorna a senha', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: '123456' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Ana', email: 'ana@teste.com' });
    expect(res.body.password).toBeUndefined();
  });

  it('rejeita dados inválidos', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: '123' });

    expect(res.status).toBe(400);
  });

  it('rejeita e-mail duplicado', async () => {
    await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: '123456' });

    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Outra Ana', email: 'ana@teste.com', password: '123456' });

    expect(res.status).toBe(409);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: '123456' });
  });

  it('retorna um token com credenciais válidas', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ana@teste.com', password: '123456' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('rejeita senha errada', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ana@teste.com', password: 'errada' });

    expect(res.status).toBe(401);
  });

  it('rejeita e-mail inexistente', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ninguem@teste.com', password: '123456' });

    expect(res.status).toBe(401);
  });
});
