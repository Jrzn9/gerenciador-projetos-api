const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const { createUser } = require('./helpers/auth');
const { inviteAndAccept } = require('./helpers/project');

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const me = async (headers) => (await request(app).get('/auth/me').set(headers)).body;

async function user(name, email) {
  return bearer((await createUser({ name, email })).token);
}

/** Dono com um projeto; "ana" já tem conta, mas ainda não participa. */
async function setup() {
  const owner = await user('Dono', 'dono@teste.com');
  const ana = await user('Ana', 'ana@teste.com');
  const project = await request(app).post('/projects').set(owner).send({ name: 'Projeto A' });
  const projectId = project.body.id;
  const invitesUrl = `/projects/${projectId}/invitations`;
  return { owner, ana, projectId, invitesUrl };
}

const notificationsOf = async (headers) => (await request(app).get('/notifications').set(headers)).body;

describe('convites por link', () => {
  it('a página do link é pública e mostra projeto, quem convidou e o status', async () => {
    const { owner, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com', jobTitle: 'Designer' });

    const preview = await request(app).post('/invitations/link/preview').send({ token: invite.body.token });

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      email: 'nova@teste.com',
      role: 'MEMBER',
      jobTitle: 'Designer',
      status: 'PENDING',
      project: { name: 'Projeto A' },
      invitedBy: { name: 'Dono' },
    });
    expect((await request(app).post('/invitations/link/preview').send({ token: 'x'.repeat(43) })).status).toBe(404);
    expect((await request(app).post('/invitations/link/preview').send({ token: '../../etc' })).status).toBe(400);
  });

  it('o banco guarda só o hash do token, nunca o token', async () => {
    const { owner, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });

    const saved = await prisma.invitation.findUnique({ where: { id: invite.body.id } });
    expect(saved.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.tokenHash).not.toContain(invite.body.token);
    // O token só aparece na criação; a listagem não o devolve
    const list = await request(app).get(invitesUrl).set(owner);
    expect(list.body[0].token).toBeUndefined();
  });

  it('quem não tem conta cria a conta e aceita pelo link', async () => {
    const { owner, invitesUrl, projectId } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });

    const nova = await user('Nova', 'nova@teste.com');
    const accepted = await request(app).post('/invitations/link/accept').set(nova).send({ token: invite.body.token });

    expect(accepted.body).toEqual({ status: 'ACCEPTED', projectId });
    expect((await request(app).get(`/projects/${projectId}`).set(nova)).status).toBe(200);
  });

  it('um link vazado não serve para outra conta', async () => {
    const { owner, ana, invitesUrl, projectId } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'outra@teste.com' });

    const res = await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });

    expect(res.status).toBe(403);
    expect((await request(app).get(`/projects/${projectId}`).set(ana)).status).toBe(403);
  });

  it('o link só funciona uma vez', async () => {
    const { owner, ana, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com' });
    const accept = () => request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });

    expect((await accept()).status).toBe(200);
    const again = await accept();
    expect(again.status).toBe(410);
    expect(again.body.status).toBe('ACCEPTED');
  });

  it('convite vencido não pode ser aceito', async () => {
    const { owner, ana, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com' });
    await prisma.invitation.update({ where: { id: invite.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const preview = await request(app).post('/invitations/link/preview').send({ token: invite.body.token });
    const res = await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });

    expect(preview.body.status).toBe('EXPIRED');
    expect(res.status).toBe(410);
  });

  it('recusar pelo link avisa quem convidou', async () => {
    const { owner, ana, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com' });

    const res = await request(app).post('/invitations/link/decline').set(ana).send({ token: invite.body.token });

    expect(res.body.status).toBe('DECLINED');
    const { items } = await notificationsOf(owner);
    expect(items[0]).toMatchObject({ type: 'INVITATION_DECLINED', actor: { name: 'Ana' } });
  });
});

describe('gestão dos convites pelo dono', () => {
  it('lista os pendentes, gera link novo e cancela', async () => {
    const { owner, ana, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com' });

    const list = await request(app).get(invitesUrl).set(owner);
    expect(list.body).toHaveLength(1);

    // Link novo: o antigo para de funcionar
    const renewed = await request(app).post(`${invitesUrl}/${invite.body.id}/renew`).set(owner);
    expect(renewed.body.token).not.toBe(invite.body.token);
    const old = await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });
    expect(old.status).toBe(404);

    // Cancelado: o link novo também para, e o convite some do sininho da Ana
    expect((await request(app).delete(`${invitesUrl}/${invite.body.id}`).set(owner)).status).toBe(204);
    const cancelled = await request(app).post('/invitations/link/accept').set(ana).send({ token: renewed.body.token });
    expect(cancelled.status).toBe(410);
    expect(cancelled.body.status).toBe('REVOKED');
    expect((await notificationsOf(ana)).items).toHaveLength(0);
    expect((await request(app).get(invitesUrl).set(owner)).body).toHaveLength(0);
  });

  it('convidar de novo o mesmo e-mail reenvia (sem duplicar)', async () => {
    const { owner, invitesUrl } = await setup();
    const first = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });
    const second = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com', role: 'OWNER' });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, role: 'OWNER', renewed: true });
    expect((await request(app).get(invitesUrl).set(owner)).body).toHaveLength(1);
  });

  it('um membro comum não vê nem mexe nos convites', async () => {
    const { owner, ana, invitesUrl, projectId } = await setup();
    await inviteAndAccept({ owner, member: ana, projectId, email: 'ana@teste.com' });
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });

    expect((await request(app).get(invitesUrl).set(ana)).status).toBe(403);
    expect((await request(app).delete(`${invitesUrl}/${invite.body.id}`).set(ana)).status).toBe(403);
  });
});

describe('convites dentro do app', () => {
  it('quem já tem conta recebe no sininho e aceita sem link', async () => {
    const { owner, ana, invitesUrl, projectId } = await setup();
    await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com', role: 'OWNER' });

    const received = await request(app).get('/invitations').set(ana);
    expect(received.body).toHaveLength(1);
    expect(received.body[0]).toMatchObject({ role: 'OWNER', project: { id: projectId }, invitedBy: { name: 'Dono' } });

    const notes = await notificationsOf(ana);
    expect(notes.unreadCount).toBe(1);
    expect(notes.items[0]).toMatchObject({ type: 'INVITATION_RECEIVED', invitation: { status: 'PENDING' } });

    const accepted = await request(app).post(`/invitations/${received.body[0].id}/accept`).set(ana);
    expect(accepted.body).toEqual({ status: 'ACCEPTED', projectId });

    // Entrou como dono, a notificação ficou lida e quem convidou foi avisado
    const projects = await request(app).get('/projects').set(ana);
    expect(projects.body[0].role).toBe('OWNER');
    expect((await notificationsOf(ana)).unreadCount).toBe(0);
    expect((await notificationsOf(owner)).items[0].type).toBe('INVITATION_ACCEPTED');
  });

  it('convite feito antes da conta existir só pode ser aceito pelo link', async () => {
    const { owner, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });

    // Sem verificação de e-mail, qualquer um poderia criar a conta "nova@..."
    // e pegar o convite; por isso ele não aparece no app, só com o link
    const nova = await user('Nova', 'nova@teste.com');
    expect((await request(app).get('/invitations').set(nova)).body).toHaveLength(0);
    expect((await request(app).post(`/invitations/${invite.body.id}/accept`).set(nova)).status).toBe(404);
  });

  it('ninguém responde convite de outra pessoa pelo id', async () => {
    const { owner, invitesUrl } = await setup();
    await user('Bia', 'bia@teste.com');
    const intrusa = await user('Intrusa', 'intrusa@teste.com');
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'bia@teste.com' });

    expect((await request(app).post(`/invitations/${invite.body.id}/accept`).set(intrusa)).status).toBe(404);
  });
});

describe('equipe', () => {
  it('quem aceita um convite entra na equipe de quem convidou, com o cargo', async () => {
    const { owner, ana, invitesUrl } = await setup();
    const invite = await request(app).post(invitesUrl).set(owner).send({ email: 'ana@teste.com', jobTitle: 'Dev' });
    await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });

    const team = await request(app).get('/team').set(owner);
    expect(team.body.members).toEqual([
      expect.objectContaining({ jobTitle: 'Dev', user: expect.objectContaining({ name: 'Ana' }) }),
    ]);
    const anaTeam = await request(app).get('/team').set(ana);
    expect(anaTeam.body.memberOf[0].manager.name).toBe('Dono');
  });

  it('convite só para a equipe, sem projeto', async () => {
    const owner = await user('Dono', 'dono@teste.com');
    const ana = await user('Ana', 'ana@teste.com');

    const invite = await request(app).post('/team/invitations').set(owner).send({ email: 'ana@teste.com', jobTitle: 'QA' });
    expect(invite.status).toBe(201);
    expect((await request(app).get('/team').set(owner)).body.invitations).toHaveLength(1);

    const accepted = await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });
    expect(accepted.body).toEqual({ status: 'ACCEPTED', projectId: null });

    const team = (await request(app).get('/team').set(owner)).body;
    expect(team.members[0].jobTitle).toBe('QA');
    expect(team.invitations).toHaveLength(0);

    // Já está na equipe; e ninguém convida a si mesmo
    expect((await request(app).post('/team/invitations').set(owner).send({ email: 'ana@teste.com' })).status).toBe(409);
    expect((await request(app).post('/team/invitations').set(owner).send({ email: 'dono@teste.com' })).status).toBe(400);
  });

  it('muda o cargo, tira da equipe e a pessoa pode sair da equipe', async () => {
    const owner = await user('Dono', 'dono@teste.com');
    const ana = await user('Ana', 'ana@teste.com');
    const invite = await request(app).post('/team/invitations').set(owner).send({ email: 'ana@teste.com' });
    await request(app).post('/invitations/link/accept').set(ana).send({ token: invite.body.token });
    const [{ id: anaId }, { id: ownerId }] = [await me(ana), await me(owner)];

    const updated = await request(app).patch(`/team/members/${anaId}`).set(owner).send({ jobTitle: 'Tech Lead' });
    expect(updated.body.jobTitle).toBe('Tech Lead');
    const cleared = await request(app).patch(`/team/members/${anaId}`).set(owner).send({ jobTitle: '' });
    expect(cleared.body.jobTitle).toBeNull();

    expect((await request(app).delete(`/team/memberships/${ownerId}`).set(ana)).status).toBe(204);
    expect((await request(app).get('/team').set(owner)).body.members).toHaveLength(0);
    expect((await request(app).delete(`/team/members/${anaId}`).set(owner)).status).toBe(404);
  });

  it('o dono adiciona pessoas da equipe ao projeto de uma vez, sem convite', async () => {
    const { owner, projectId } = await setup();
    const people = [];
    for (const name of ['Bia', 'Caio']) {
      const email = `${name.toLowerCase()}@teste.com`;
      const headers = await user(name, email);
      const invite = await request(app).post('/team/invitations').set(owner).send({ email });
      await request(app).post('/invitations/link/accept').set(headers).send({ token: invite.body.token });
      people.push({ headers, id: (await me(headers)).id });
    }

    const res = await request(app)
      .post(`/projects/${projectId}/members`)
      .set(owner)
      .send({ userIds: people.map((p) => p.id) });

    expect(res.status).toBe(201);
    expect(res.body.map((m) => m.user.name).sort()).toEqual(['Bia', 'Caio']);
    const { items } = await notificationsOf(people[0].headers);
    expect(items[0]).toMatchObject({ type: 'ADDED_TO_PROJECT', project: { id: projectId }, actor: { name: 'Dono' } });

    // De novo: já estão no projeto
    const again = await request(app).post(`/projects/${projectId}/members`).set(owner).send({ userIds: [people[0].id] });
    expect(again.status).toBe(409);
  });

  it('não dá para adicionar direto quem não é da sua equipe', async () => {
    const { owner, ana, projectId } = await setup();
    const { id: anaId } = await me(ana);

    const res = await request(app).post(`/projects/${projectId}/members`).set(owner).send({ userIds: [anaId] });

    expect(res.status).toBe(400);
    expect((await request(app).get(`/projects/${projectId}`).set(ana)).status).toBe(403);
  });
});

/** Dono + Ana no projeto, com uma tarefa. */
async function projectWithTask() {
  const base = await setup();
  await inviteAndAccept({ owner: base.owner, member: base.ana, projectId: base.projectId, email: 'ana@teste.com' });
  const tasksUrl = `/projects/${base.projectId}/tasks`;
  const task = await request(app).post(tasksUrl).set(base.owner).send({ title: 'Tarefa 1' });
  const anaId = (await me(base.ana)).id;
  return { ...base, tasksUrl, task: task.body, anaId };
}

describe('notificações', () => {
  it('atribuir tarefa avisa a pessoa (mas não quem se atribui)', async () => {
    const { owner, ana, tasksUrl, task, anaId } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });
    await request(app).post(tasksUrl).set(ana).send({ title: 'Minha', assigneeId: anaId });

    const notes = await notificationsOf(ana);
    const assigned = notes.items.filter((n) => n.type === 'TASK_ASSIGNED');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ task: { id: task.id, title: 'Tarefa 1' }, actor: { name: 'Dono' } });
  });

  it('contador de não lidas, marcar uma e marcar todas', async () => {
    const { owner, ana, tasksUrl, task, anaId } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });
    await request(app).post(`${tasksUrl}/${task.id}/comments`).set(owner).send({ body: 'Olha isso' });

    expect((await request(app).get('/notifications/unread-count').set(ana)).body.count).toBe(2);

    const { items } = await notificationsOf(ana);
    // Outra pessoa não consegue marcar a notificação da Ana
    await request(app).post(`/notifications/${items[0].id}/read`).set(owner);
    expect((await request(app).get('/notifications/unread-count').set(ana)).body.count).toBe(2);

    await request(app).post(`/notifications/${items[0].id}/read`).set(ana);
    expect((await request(app).get('/notifications/unread-count').set(ana)).body.count).toBe(1);

    await request(app).post('/notifications/read-all').set(ana);
    expect((await request(app).get('/notifications/unread-count').set(ana)).body.count).toBe(0);
  });

  it('marcar todas como lidas também apaga as lidas com mais de 30 dias', async () => {
    const { owner, ana, tasksUrl, task, anaId } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });
    await request(app).post(`${tasksUrl}/${task.id}/comments`).set(owner).send({ body: 'Oi' });
    const [old] = (await notificationsOf(ana)).items;
    await prisma.notification.update({ where: { id: old.id }, data: { createdAt: new Date('2020-01-01') } });

    await request(app).post('/notifications/read-all').set(ana);

    const { items } = await notificationsOf(ana);
    expect(items.map((n) => n.id)).not.toContain(old.id);
    // As recentes continuam (agora como lidas)
    expect(items.some((n) => n.type === 'TASK_ASSIGNED' && n.readAt)).toBe(true);
  });

  it('quem sai do projeto perde as notificações dele', async () => {
    const { owner, ana, tasksUrl, task, anaId, projectId } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });

    await request(app).delete(`/projects/${projectId}/members/${anaId}`).set(owner);

    expect((await notificationsOf(ana)).items.filter((n) => n.project?.id === projectId)).toHaveLength(0);
  });

  it('exige login', async () => {
    expect((await request(app).get('/notifications')).status).toBe(401);
  });
});

describe('comentários', () => {
  it('comenta, lista em ordem e conta no card da tarefa', async () => {
    const { owner, ana, tasksUrl, task } = await projectWithTask();
    const url = `${tasksUrl}/${task.id}/comments`;

    const first = await request(app).post(url).set(owner).send({ body: '  Primeiro  ' });
    await request(app).post(url).set(ana).send({ body: 'Segundo' });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ body: 'Primeiro', author: { name: 'Dono' } });
    const list = await request(app).get(url).set(ana);
    expect(list.body.map((c) => c.body)).toEqual(['Primeiro', 'Segundo']);

    const tasks = await request(app).get(tasksUrl).set(owner);
    expect(tasks.body[0].commentCount).toBe(2);
  });

  it('só quem escreveu edita; o dono do projeto pode excluir', async () => {
    const { owner, ana, tasksUrl, task } = await projectWithTask();
    const url = `${tasksUrl}/${task.id}/comments`;
    const comment = await request(app).post(url).set(ana).send({ body: 'Da Ana' });
    const ownerComment = await request(app).post(url).set(owner).send({ body: 'Do dono' });

    expect((await request(app).patch(`${url}/${comment.body.id}`).set(owner).send({ body: 'Mudei' })).status).toBe(403);
    const edited = await request(app).patch(`${url}/${comment.body.id}`).set(ana).send({ body: 'Editado' });
    expect(edited.body.body).toBe('Editado');

    expect((await request(app).delete(`${url}/${ownerComment.body.id}`).set(ana)).status).toBe(403);
    expect((await request(app).delete(`${url}/${comment.body.id}`).set(owner)).status).toBe(204);
  });

  it('valida o texto e não mistura tarefas de outro projeto', async () => {
    const { owner, tasksUrl, task } = await projectWithTask();
    const other = await request(app).post('/projects').set(owner).send({ name: 'Outro' });

    expect((await request(app).post(`${tasksUrl}/${task.id}/comments`).set(owner).send({ body: '   ' })).status).toBe(400);
    const cross = await request(app)
      .post(`/projects/${other.body.id}/tasks/${task.id}/comments`)
      .set(owner)
      .send({ body: 'Oi' });
    expect(cross.status).toBe(404);
  });

  it('quem não é do projeto não lê os comentários', async () => {
    const { tasksUrl, task } = await projectWithTask();
    const intrusa = await user('Intrusa', 'intrusa@teste.com');
    expect((await request(app).get(`${tasksUrl}/${task.id}/comments`).set(intrusa)).status).toBe(403);
  });
});

describe('histórico do projeto', () => {
  it('registra quem criou, moveu, concluiu, atribuiu, comentou e excluiu', async () => {
    const { owner, ana, tasksUrl, task, anaId, projectId } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(ana).send({ status: 'IN_PROGRESS' });
    await request(app).patch(`${tasksUrl}/${task.id}`).set(ana).send({ status: 'DONE' });
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });
    // Reordenar na mesma coluna não entra no histórico
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ position: 42 });
    await request(app).post(`${tasksUrl}/${task.id}/comments`).set(ana).send({ body: 'Feito!' });
    await request(app).delete(`${tasksUrl}/${task.id}`).set(owner);

    const { body } = await request(app).get(`/projects/${projectId}/activity`).set(ana);

    expect(body.items.map((a) => a.type)).toEqual([
      'TASK_DELETED',
      'COMMENT_ADDED',
      'TASK_ASSIGNED',
      'TASK_MOVED',
      'TASK_MOVED',
      'TASK_CREATED',
      'MEMBER_JOINED',
      'PROJECT_CREATED',
    ]);
    expect(body.items[3]).toMatchObject({ actor: { name: 'Ana' }, meta: { title: 'Tarefa 1', from: 'IN_PROGRESS', to: 'DONE' } });
    expect(body.items[2].meta.assigneeName).toBe('Ana');
    // A tarefa foi excluída, mas o histórico continua legível
    expect(body.items[0].meta.title).toBe('Tarefa 1');
    expect(body.nextCursor).toBeNull();
  });

  it('pagina com cursor e filtra por tarefa', async () => {
    const { owner, tasksUrl, task, projectId } = await projectWithTask();
    for (const status of ['IN_PROGRESS', 'DONE', 'TODO']) {
      await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ status });
    }
    const url = `/projects/${projectId}/activity`;

    const page1 = await request(app).get(`${url}?limit=2`).set(owner);
    const page2 = await request(app).get(`${url}?limit=2&cursor=${page1.body.nextCursor}`).set(owner);
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[1].id);

    const onlyTask = await request(app).get(`${url}?taskId=${task.id}`).set(owner);
    expect(onlyTask.body.items.every((a) => a.taskId === task.id)).toBe(true);
    expect(onlyTask.body.items).toHaveLength(4);
  });

  it('registra entradas, saídas e mudanças de papel', async () => {
    const { owner, ana, projectId, anaId } = await projectWithTask();
    await request(app).patch(`/projects/${projectId}/members/${anaId}`).set(owner).send({ role: 'OWNER' });
    await request(app).delete(`/projects/${projectId}/members/${anaId}`).set(ana);

    const { body } = await request(app).get(`/projects/${projectId}/activity?limit=2`).set(owner);
    expect(body.items[0]).toMatchObject({ type: 'MEMBER_LEFT', actor: { name: 'Ana' }, meta: { name: 'Ana' } });
    expect(body.items[1]).toMatchObject({ type: 'MEMBER_ROLE_CHANGED', meta: { name: 'Ana', role: 'OWNER' } });
  });

  it('excluir o projeto apaga convites, comentários, notificações e histórico', async () => {
    const { owner, ana, tasksUrl, task, anaId, projectId, invitesUrl } = await projectWithTask();
    await request(app).patch(`${tasksUrl}/${task.id}`).set(owner).send({ assigneeId: anaId });
    await request(app).post(`${tasksUrl}/${task.id}/comments`).set(ana).send({ body: 'Oi' });
    await request(app).post(invitesUrl).set(owner).send({ email: 'nova@teste.com' });

    expect((await request(app).delete(`/projects/${projectId}`).set(owner)).status).toBe(204);

    const counts = await Promise.all([
      prisma.invitation.count({ where: { projectId } }),
      prisma.comment.count(),
      prisma.notification.count({ where: { projectId } }),
      prisma.activity.count({ where: { projectId } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });
});
