const request = require('supertest');
const app = require('../src/app');
const { createUser } = require('./helpers/auth');
const { inviteAndAccept } = require('./helpers/project');

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const me = async (headers) => (await request(app).get('/auth/me').set(headers)).body;

/** Dono + membro em um projeto. */
async function setup() {
  const owner = bearer((await createUser({ name: 'Dono', email: 'dono@teste.com' })).token);
  const member = bearer((await createUser({ name: 'Membro', email: 'membro@teste.com' })).token);

  const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });
  const projectId = project.body.id;
  await inviteAndAccept({ owner, member, projectId, email: 'membro@teste.com' });

  const tasksUrl = `/projects/${projectId}/tasks`;
  const membersUrl = `/projects/${projectId}/members`;
  return { projectId, owner, member, tasksUrl, membersUrl };
}

describe('listagem de projetos', () => {
  it('traz o papel, o nº de membros e as tarefas por status', async () => {
    const { owner, member, tasksUrl } = await setup();
    await request(app).post(tasksUrl).set(owner).send({ title: 'A fazer' });
    await request(app).post(tasksUrl).set(owner).send({ title: 'Feita', status: 'DONE' });

    const [ownerView] = (await request(app).get('/projects').set(owner)).body;
    const [memberView] = (await request(app).get('/projects').set(member)).body;

    expect(ownerView).toMatchObject({ role: 'OWNER', memberCount: 2, taskCounts: { TODO: 1, IN_PROGRESS: 0, DONE: 1 } });
    expect(memberView.role).toBe('MEMBER');
  });
});

describe('ordem das tarefas no quadro', () => {
  it('cria direto na coluna escolhida e sempre no fim dela', async () => {
    const { owner, tasksUrl } = await setup();

    const first = await request(app).post(tasksUrl).set(owner).send({ title: 'Primeira', status: 'IN_PROGRESS' });
    const second = await request(app).post(tasksUrl).set(owner).send({ title: 'Segunda', status: 'IN_PROGRESS' });

    expect(first.body.status).toBe('IN_PROGRESS');
    expect(second.body.position).toBeGreaterThan(first.body.position);
  });

  it('reordena mudando só a posição da tarefa movida', async () => {
    const { owner, tasksUrl } = await setup();
    const titles = ['Tarefa A', 'Tarefa B', 'Tarefa C'];
    const created = [];
    for (const title of titles) created.push((await request(app).post(tasksUrl).set(owner).send({ title })).body);

    // Move "C" para entre "A" e "B"
    const between = (created[0].position + created[1].position) / 2;
    const moved = await request(app).patch(`${tasksUrl}/${created[2].id}`).set(owner).send({ position: between });
    expect(moved.status).toBe(200);

    const list = await request(app).get(tasksUrl).set(owner);
    expect(list.body.map((t) => t.title)).toEqual(['Tarefa A', 'Tarefa C', 'Tarefa B']);
  });

  it('recusa posição inválida', async () => {
    const { owner, tasksUrl } = await setup();
    const task = (await request(app).post(tasksUrl).set(owner).send({ title: 'Tarefa A' })).body;

    const res = await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ position: 'primeiro' });
    expect(res.status).toBe(400);
  });

  it('compacta respostas grandes com gzip', async () => {
    const { owner, tasksUrl } = await setup();
    for (let i = 0; i < 15; i += 1) {
      await request(app).post(tasksUrl).set(owner).send({ title: `Tarefa ${i}`, description: 'x'.repeat(60) });
    }

    const res = await request(app).get(tasksUrl).set(owner).set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

describe('gestão de membros', () => {
  it('avisa quando a pessoa já faz parte do projeto', async () => {
    const { owner, projectId } = await setup();
    const res = await request(app).post(`/projects/${projectId}/invitations`).set(owner).send({ email: 'membro@teste.com' });
    expect(res.status).toBe(409);
  });

  it('o dono promove e rebaixa outras pessoas', async () => {
    const { owner, member, membersUrl } = await setup();
    const { id: memberId } = await me(member);

    const promoted = await request(app).patch(`${membersUrl}/${memberId}`).set(owner).send({ role: 'OWNER' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('OWNER');

    const demoted = await request(app).patch(`${membersUrl}/${memberId}`).set(owner).send({ role: 'MEMBER' });
    expect(demoted.body.role).toBe('MEMBER');
  });

  it('membro comum não muda papéis e ninguém muda o próprio', async () => {
    const { owner, member, membersUrl } = await setup();
    const { id: ownerId } = await me(owner);
    const { id: memberId } = await me(member);

    expect((await request(app).patch(`${membersUrl}/${ownerId}`).set(member).send({ role: 'MEMBER' })).status).toBe(403);
    expect((await request(app).patch(`${membersUrl}/${ownerId}`).set(owner).send({ role: 'MEMBER' })).status).toBe(400);
    expect((await request(app).patch(`${membersUrl}/${memberId}`).set(owner).send({ role: 'CHEFE' })).status).toBe(400);
  });

  it('o dono remove um membro e as tarefas dele ficam sem responsável', async () => {
    const { owner, member, membersUrl, tasksUrl } = await setup();
    const { id: memberId } = await me(member);
    const task = (await request(app).post(tasksUrl).set(owner).send({ title: 'Do membro', assigneeId: memberId })).body;

    const res = await request(app).delete(`${membersUrl}/${memberId}`).set(owner);
    expect(res.status).toBe(204);

    const tasks = (await request(app).get(tasksUrl).set(owner)).body;
    expect(tasks.find((t) => t.id === task.id).assigneeId).toBeNull();
    expect((await request(app).get(tasksUrl).set(member)).status).toBe(403);
  });

  it('membro comum não remove outras pessoas, mas pode sair', async () => {
    const { owner, member, membersUrl, projectId } = await setup();
    const { id: ownerId } = await me(owner);
    const { id: memberId } = await me(member);

    expect((await request(app).delete(`${membersUrl}/${ownerId}`).set(member)).status).toBe(403);
    expect((await request(app).delete(`${membersUrl}/${memberId}`).set(member)).status).toBe(204);
    expect((await request(app).get(`/projects/${projectId}`).set(member)).status).toBe(403);
  });

  it('o único dono não pode sair; com outro dono, pode', async () => {
    const { owner, member, membersUrl } = await setup();
    const { id: ownerId } = await me(owner);
    const { id: memberId } = await me(member);

    const blocked = await request(app).delete(`${membersUrl}/${ownerId}`).set(owner);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/pelo menos um dono/);

    await request(app).patch(`${membersUrl}/${memberId}`).set(owner).send({ role: 'OWNER' });
    expect((await request(app).delete(`${membersUrl}/${ownerId}`).set(owner)).status).toBe(204);
  });
});
