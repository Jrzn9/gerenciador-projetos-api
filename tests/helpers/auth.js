const request = require('supertest');
const app = require('../../src/app');

async function createUser({ name = 'Teste', email, password = 'senha-forte-123' }) {
  await request(app).post('/auth/register').send({ name, email, password });

  const loginRes = await request(app).post('/auth/login').send({ email, password });

  return { token: loginRes.body.token };
}

module.exports = { createUser };
