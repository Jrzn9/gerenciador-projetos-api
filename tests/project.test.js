const request = require('supertest');
const app = require('../src/app');
const { createUser } = require('./helpers/auth');

describe('rotas de projetos', () => {
  it('exige autenticação', async () => {
    const res = await request(app).post('/projects').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('cria um projeto e torna o criador OWNER', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });

    const createRes = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Projeto A', description: 'desc' });

    expect(createRes.status).toBe(201);

    const detailRes = await request(app)
      .get(`/projects/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.members).toHaveLength(1);
    expect(detailRes.body.members[0].role).toBe('OWNER');
  });

  it('lista apenas projetos dos quais o usuário é membro', async () => {
    const { token: tokenA } = await createUser({ email: 'a@teste.com' });
    const { token: tokenB } = await createUser({ email: 'b@teste.com' });

    await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Projeto de A' });

    const listRes = await request(app)
      .get('/projects')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });

  it('impede quem não é membro de ver os detalhes do projeto', async () => {
    const { token: tokenA } = await createUser({ email: 'a@teste.com' });
    const { token: tokenB } = await createUser({ email: 'b@teste.com' });

    const project = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Projeto de A' });

    const res = await request(app)
      .get(`/projects/${project.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('permite que o OWNER adicione um membro por e-mail', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    await createUser({ name: 'Membro', email: 'membro@teste.com' });

    const project = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Projeto A' });

    const res = await request(app)
      .post(`/projects/${project.body.id}/members`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ email: 'membro@teste.com' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('MEMBER');
  });

  it('impede que um MEMBER (não-OWNER) adicione outros membros', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const { token: tokenMember } = await createUser({ email: 'membro@teste.com' });
    await createUser({ name: 'Outra', email: 'outra@teste.com' });

    const project = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Projeto A' });

    await request(app)
      .post(`/projects/${project.body.id}/members`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ email: 'membro@teste.com' });

    const res = await request(app)
      .post(`/projects/${project.body.id}/members`)
      .set('Authorization', `Bearer ${tokenMember}`)
      .send({ email: 'outra@teste.com' });

    expect(res.status).toBe(403);
  });

  it('retorna 404 ao adicionar membro com e-mail inexistente', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });

    const project = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Projeto A' });

    const res = await request(app)
      .post(`/projects/${project.body.id}/members`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ email: 'ninguem@teste.com' });

    expect(res.status).toBe(404);
  });
});
