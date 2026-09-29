const request = require('supertest');
const app = require('../src/app');
const { createUser } = require('./helpers/auth');

async function createProject(token, name = 'Projeto A') {
  const res = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });

  return res.body;
}

describe('rotas de tarefas', () => {
  it('exige que o usuário seja membro do projeto', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const { token: tokenOther } = await createUser({ email: 'other@teste.com' });

    const project = await createProject(tokenOwner);

    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${tokenOther}`)
      .send({ title: 'Tarefa 1' });

    expect(res.status).toBe(403);
  });

  it('cria e lista tarefas, com filtro por status', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });
    const project = await createProject(token);

    await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tarefa TODO' });

    const doneTask = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tarefa DONE' });

    await request(app)
      .patch(`/projects/${project.id}/tasks/${doneTask.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DONE' });

    const listAll = await request(app)
      .get(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${token}`);
    expect(listAll.body).toHaveLength(2);

    const listDone = await request(app)
      .get(`/projects/${project.id}/tasks?status=DONE`)
      .set('Authorization', `Bearer ${token}`);
    expect(listDone.body).toHaveLength(1);
    expect(listDone.body[0].title).toBe('Tarefa DONE');
  });

  it('remove uma tarefa e retorna 404 em uma segunda tentativa', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });
    const project = await createProject(token);

    const task = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tarefa 1' });

    const firstDelete = await request(app)
      .delete(`/projects/${project.id}/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(firstDelete.status).toBe(204);

    const secondDelete = await request(app)
      .delete(`/projects/${project.id}/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(secondDelete.status).toBe(404);
  });

  it('não permite atualizar/apagar uma tarefa através do id de outro projeto (IDOR)', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });
    const projectA = await createProject(token, 'Projeto A');
    const projectB = await createProject(token, 'Projeto B');

    const task = await request(app)
      .post(`/projects/${projectA.id}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tarefa de A' });

    const updateViaB = await request(app)
      .patch(`/projects/${projectB.id}/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DONE' });
    expect(updateViaB.status).toBe(404);

    const deleteViaB = await request(app)
      .delete(`/projects/${projectB.id}/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteViaB.status).toBe(404);

    const stillThere = await request(app)
      .get(`/projects/${projectA.id}/tasks`)
      .set('Authorization', `Bearer ${token}`);
    expect(stillThere.body).toHaveLength(1);
    expect(stillThere.body[0].status).toBe('TODO');
  });

  it('rejeita filtro de status inválido com 400 (antes derrubava o servidor)', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });
    const project = await createProject(token);

    const res = await request(app)
      .get(`/projects/${project.id}/tasks?status=QUALQUER`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('rejeita responsável inexistente com 400 (antes derrubava o servidor)', async () => {
    const { token } = await createUser({ email: 'owner@teste.com' });
    const project = await createProject(token);

    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tarefa', assigneeId: '00000000-0000-4000-8000-000000000000' });

    expect(res.status).toBe(400);
  });

  it('só aceita como responsável quem é membro do projeto', async () => {
    const { token: tokenOwner } = await createUser({ email: 'owner@teste.com' });
    const { token: tokenOutsider } = await createUser({ email: 'fora@teste.com' });
    const project = await createProject(tokenOwner);

    const outsider = await request(app).get('/auth/me').set('Authorization', `Bearer ${tokenOutsider}`);
    const owner = await request(app).get('/auth/me').set('Authorization', `Bearer ${tokenOwner}`);

    const withOutsider = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Tarefa', assigneeId: outsider.body.id });
    expect(withOutsider.status).toBe(400);

    const withOwner = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Tarefa', assigneeId: owner.body.id });
    expect(withOwner.status).toBe(201);

    const unassign = await request(app)
      .patch(`/projects/${project.id}/tasks/${withOwner.body.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ assigneeId: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.assigneeId).toBeNull();
  });
});
