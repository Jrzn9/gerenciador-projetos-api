const request = require('supertest');
const app = require('../src/app');
const { createUser } = require('./helpers/auth');
const { inviteAndAccept } = require('./helpers/project');

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

  it('o OWNER convida por e-mail e a pessoa só entra quando aceita', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const { token: tokenMember } = await createUser({ name: 'Membro', email: 'membro@teste.com' });
    const owner = { Authorization: `Bearer ${tokenOwner}` };
    const member = { Authorization: `Bearer ${tokenMember}` };

    const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });

    const invite = await request(app)
      .post(`/projects/${project.body.id}/invitations`)
      .set(owner)
      .send({ email: 'membro@teste.com' });
    expect(invite.status).toBe(201);

    // Antes de aceitar, ainda não é membro
    expect((await request(app).get(`/projects/${project.body.id}`).set(member)).status).toBe(403);

    const accepted = await request(app).post('/invitations/link/accept').set(member).send({ token: invite.body.token });
    expect(accepted.status).toBe(200);

    const detail = await request(app).get(`/projects/${project.body.id}`).set(member);
    expect(detail.status).toBe(200);
    expect(detail.body.members.find((m) => m.user.email === 'membro@teste.com').role).toBe('MEMBER');
  });

  it('impede que um MEMBER (não-OWNER) convide outras pessoas', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const { token: tokenMember } = await createUser({ email: 'membro@teste.com' });
    const owner = { Authorization: `Bearer ${tokenOwner}` };
    const member = { Authorization: `Bearer ${tokenMember}` };

    const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });
    await inviteAndAccept({ owner, member, projectId: project.body.id, email: 'membro@teste.com' });

    const res = await request(app)
      .post(`/projects/${project.body.id}/invitations`)
      .set(member)
      .send({ email: 'outra@teste.com' });

    expect(res.status).toBe(403);
  });

  it('convidar um e-mail sem conta responde igual (não revela quem é cadastrado)', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    await createUser({ email: 'existe@teste.com' });
    const owner = { Authorization: `Bearer ${tokenOwner}` };

    const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });
    const url = `/projects/${project.body.id}/invitations`;

    const withAccount = await request(app).post(url).set(owner).send({ email: 'existe@teste.com' });
    const withoutAccount = await request(app).post(url).set(owner).send({ email: 'ninguem@teste.com' });

    expect(withAccount.status).toBe(201);
    expect(withoutAccount.status).toBe(201);
    expect(Object.keys(withAccount.body).sort()).toEqual(Object.keys(withoutAccount.body).sort());
  });

  it('o OWNER não consegue convidar a si mesmo', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const owner = { Authorization: `Bearer ${tokenOwner}` };

    const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });

    const res = await request(app)
      .post(`/projects/${project.body.id}/invitations`)
      .set(owner)
      .send({ email: 'owner@teste.com', role: 'MEMBER' });

    expect(res.status).toBe(409);

    const detail = await request(app).get(`/projects/${project.body.id}`).set(owner);
    expect(detail.body.members[0].role).toBe('OWNER');
  });
});
