const request = require('supertest');
const app = require('../src/app');

describe('POST /auth/register', () => {
  it('cria um usuário e não retorna a senha', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });

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
      .send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });

    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Outra Ana', email: 'ana@teste.com', password: 'senha-forte-123' });

    expect(res.status).toBe(409);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });
  });

  it('retorna um token com credenciais válidas', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ana@teste.com', password: 'senha-forte-123' });

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
      .send({ email: 'ninguem@teste.com', password: 'senha-forte-123' });

    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('retorna o usuário logado sem a senha', async () => {
    await request(app)
      .post('/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123' });
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'ana@teste.com', password: 'senha-forte-123' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Ana', email: 'ana@teste.com' });
    expect(res.body.password).toBeUndefined();
  });

  it('exige autenticação', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('CORS', () => {
  it('libera o front-end local por padrão', async () => {
    const res = await request(app).get('/auth/me').set('Origin', 'http://localhost:4200');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  });

  it('não libera origens desconhecidas', async () => {
    const res = await request(app).get('/auth/me').set('Origin', 'https://site-qualquer.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
