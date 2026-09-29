const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const { createUser } = require('./helpers/auth');
const { inviteAndAccept } = require('./helpers/project');

/** Dono + membro comum em um projeto com uma tarefa. */
async function setup() {
  const { token: ownerToken } = await createUser({ name: 'Dono', email: 'dono@teste.com' });
  const { token: memberToken } = await createUser({ name: 'Membro', email: 'membro@teste.com' });
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const project = await request(app)
    .post('/projects')
    .set(auth(ownerToken))
    .send({ name: 'Projeto A', description: 'Descrição original' });

  await inviteAndAccept({
    owner: auth(ownerToken),
    member: auth(memberToken),
    projectId: project.body.id,
    email: 'membro@teste.com',
  });

  await request(app)
    .post(`/projects/${project.body.id}/tasks`)
    .set(auth(ownerToken))
    .send({ title: 'Tarefa 1' });

  return { projectId: project.body.id, owner: auth(ownerToken), member: auth(memberToken) };
}

describe('PATCH /projects/:projectId', () => {
  it('permite que o OWNER renomeie o projeto e limpe a descrição', async () => {
    const { projectId, owner } = await setup();

    const res = await request(app)
      .patch(`/projects/${projectId}`)
      .set(owner)
      .send({ name: '  Projeto Renomeado ', description: '' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Projeto Renomeado', description: null });
  });

  it('altera só o que foi enviado', async () => {
    const { projectId, owner } = await setup();

    const res = await request(app).patch(`/projects/${projectId}`).set(owner).send({ name: 'Novo nome' });

    expect(res.body.description).toBe('Descrição original');
  });

  it('rejeita corpo vazio e nome curto demais', async () => {
    const { projectId, owner } = await setup();

    expect((await request(app).patch(`/projects/${projectId}`).set(owner).send({})).status).toBe(400);
    expect((await request(app).patch(`/projects/${projectId}`).set(owner).send({ name: 'A' })).status).toBe(400);
  });

  it('impede que um MEMBER edite o projeto', async () => {
    const { projectId, member } = await setup();

    const res = await request(app).patch(`/projects/${projectId}`).set(member).send({ name: 'Tentativa' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /projects/:projectId', () => {
  it('permite que o OWNER exclua o projeto junto com tarefas e membros', async () => {
    const { projectId, owner, member } = await setup();

    const res = await request(app).delete(`/projects/${projectId}`).set(owner);
    expect(res.status).toBe(204);

    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    expect(await prisma.task.count({ where: { projectId } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId } })).toBe(0);

    // Some da lista de todo mundo
    expect((await request(app).get('/projects').set(owner)).body).toHaveLength(0);
    expect((await request(app).get('/projects').set(member)).body).toHaveLength(0);
  });

  it('impede que um MEMBER exclua o projeto', async () => {
    const { projectId, member } = await setup();

    const res = await request(app).delete(`/projects/${projectId}`).set(member);

    expect(res.status).toBe(403);
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
  });

  it('impede que quem não é do projeto exclua', async () => {
    const { projectId } = await setup();
    const { token } = await createUser({ email: 'estranho@teste.com' });

    const res = await request(app).delete(`/projects/${projectId}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
