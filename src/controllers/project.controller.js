const { z } = require('zod');
const prisma = require('../lib/prisma');
const { isRecordNotFound } = require('../lib/prisma-errors');
const { userPublic } = require('../lib/selects');

// Limites de tamanho em todo texto: nada de nomes com 100 mil caracteres no banco
const nameSchema = z.string().trim().min(2).max(100);
const descriptionSchema = z.string().trim().max(1000);

const createProjectSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
});

// Edição parcial: basta mandar o que mudou. Descrição vazia ("") limpa o campo.
const updateProjectSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'Informe o nome ou a descrição para alterar',
  });

async function create(req, res) {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const project = await prisma.project.create({
    data: {
      ...parsed.data,
      members: {
        create: { userId: req.userId, role: 'OWNER' },
      },
      // Primeiro item do histórico
      activities: {
        create: { type: 'PROJECT_CREATED', actorId: req.userId, meta: { name: parsed.data.name } },
      },
    },
  });

  return res.status(201).json(project);
}

const emptyTaskCounts = () => ({ TODO: 0, IN_PROGRESS: 0, DONE: 0 });

/**
 * Lista os projetos do usuário já com o papel dele, o nº de membros e as
 * tarefas por status (para a barra de progresso). São só 2 consultas no
 * total, qualquer que seja o número de projetos.
 */
async function listMine(req, res) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.userId },
    orderBy: { project: { createdAt: 'desc' } },
    select: {
      role: true,
      project: {
        select: { id: true, name: true, description: true, createdAt: true, _count: { select: { members: true } } },
      },
    },
  });

  const projectIds = memberships.map((m) => m.project.id);
  const counts = projectIds.length
    ? await prisma.task.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      })
    : [];

  const countsByProject = new Map();
  for (const { projectId, status, _count } of counts) {
    const entry = countsByProject.get(projectId) ?? emptyTaskCounts();
    entry[status] = _count._all;
    countsByProject.set(projectId, entry);
  }

  return res.json(
    memberships.map(({ role, project: { _count, ...project } }) => ({
      ...project,
      role,
      memberCount: _count.members,
      taskCounts: countsByProject.get(project.id) ?? emptyTaskCounts(),
    }))
  );
}

async function getById(req, res) {
  const project = await prisma.project.findUnique({
    where: { id: req.params.projectId },
    include: { members: { orderBy: { createdAt: 'asc' }, include: { user: { select: userPublic } } } },
  });

  if (!project) {
    return res.status(404).json({ error: 'Projeto não encontrado' });
  }

  return res.json(project);
}

const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
});

/**
 * POST /projects/:projectId/members — adiciona pessoas da MINHA equipe, várias
 * de uma vez e sem digitar e-mail. Elas já aceitaram fazer parte da equipe,
 * então entram direto e recebem uma notificação. Quem não é da equipe
 * precisa de convite (POST /projects/:projectId/invitations).
 */
async function addMembers(req, res) {
  const parsed = addMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { projectId } = req.params;
  const { role } = parsed.data;
  const userIds = [...new Set(parsed.data.userIds)];

  const [team, existing] = await Promise.all([
    prisma.teamMember.findMany({
      where: { managerId: req.userId, userId: { in: userIds } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.projectMember.findMany({ where: { projectId, userId: { in: userIds } }, select: { userId: true } }),
  ]);

  if (team.length !== userIds.length) {
    return res.status(400).json({ error: 'Só dá para adicionar direto quem é da sua equipe. Para outras pessoas, envie um convite.' });
  }

  const already = new Set(existing.map((m) => m.userId));
  const people = team.map((t) => t.user).filter((user) => !already.has(user.id));
  if (people.length === 0) {
    return res.status(409).json({ error: 'Essas pessoas já fazem parte do projeto' });
  }

  const ids = people.map((user) => user.id);
  const memberships = await prisma.$transaction(async (tx) => {
    await tx.projectMember.createMany({ data: ids.map((userId) => ({ userId, projectId, role })) });
    await tx.notification.createMany({
      data: ids.map((userId) => ({ type: 'ADDED_TO_PROJECT', userId, actorId: req.userId, projectId })),
    });
    await tx.activity.createMany({
      data: people.map((user) => ({ type: 'MEMBER_ADDED', projectId, actorId: req.userId, meta: { name: user.name } })),
    });

    // Quem já tinha convite pendente para este projeto acabou de entrar: o convite
    // passa a valer como aceito (senão continuaria "pendente" na lista do dono e
    // com o botão "Aceitar" no sininho da pessoa)
    const now = new Date();
    for (const user of people) {
      const { count } = await tx.invitation.updateMany({
        where: { projectId, email: user.email, status: 'PENDING' },
        data: { status: 'ACCEPTED', respondedAt: now, inviteeId: user.id },
      });
      if (count > 0) {
        await tx.notification.updateMany({
          where: { userId: user.id, projectId, type: 'INVITATION_RECEIVED', readAt: null },
          data: { readAt: now },
        });
      }
    }

    return tx.projectMember.findMany({
      where: { projectId, userId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: userPublic } },
    });
  });

  return res.status(201).json(memberships);
}

const updateRoleSchema = z.object({
  role: z.enum(['OWNER', 'MEMBER']),
});

/**
 * Trava a linha do projeto até o fim da transação. Mudanças nos membros do
 * mesmo projeto entram em fila: sem isso, dois donos removendo (ou rebaixando)
 * um ao outro ao mesmo tempo passariam pela checagem e o projeto ficaria sem dono.
 */
function lockProject(tx, projectId) {
  return tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
}

const NOT_OWNER = { error: 'Apenas o dono do projeto pode fazer isso' };

/** PATCH /projects/:projectId/members/:userId — só OWNER. */
async function updateMemberRole(req, res) {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { projectId, userId } = req.params;

  // Quem pede é dono; mexer no próprio papel poderia deixar o projeto sem dono
  if (userId === req.userId) {
    return res.status(400).json({ error: 'Você não pode alterar o seu próprio papel no projeto' });
  }

  try {
    const membership = await prisma.$transaction(async (tx) => {
      await lockProject(tx, projectId);

      // Quem pede ainda é dono? Outro dono pode tê-lo rebaixado agora há pouco
      const requester = await tx.projectMember.findUnique({
        where: { userId_projectId: { userId: req.userId, projectId } },
        select: { role: true },
      });
      if (requester?.role !== 'OWNER') return null;

      const updated = await tx.projectMember.update({
        where: { userId_projectId: { userId, projectId } },
        data: { role: parsed.data.role },
        include: { user: { select: userPublic } },
      });
      await tx.activity.create({
        data: {
          type: 'MEMBER_ROLE_CHANGED',
          projectId,
          actorId: req.userId,
          meta: { name: updated.user.name, role: updated.role },
        },
      });
      return updated;
    });
    if (!membership) return res.status(403).json(NOT_OWNER);
    return res.json(membership);
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json({ error: 'Essa pessoa não faz parte do projeto' });
    throw err;
  }
}

/**
 * DELETE /projects/:projectId/members/:userId
 * O dono remove qualquer pessoa; um membro só pode remover a si mesmo (sair).
 * O projeto nunca fica sem dono, e as tarefas da pessoa ficam sem responsável.
 */
async function removeMember(req, res) {
  const { projectId, userId } = req.params;
  const isSelf = userId === req.userId;

  if (!isSelf && req.membership.role !== 'OWNER') {
    return res.status(403).json({ error: 'Apenas o dono do projeto pode remover pessoas' });
  }

  // As checagens rodam DENTRO da transação, com o projeto travado (ver lockProject)
  const outcome = await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);

    if (!isSelf) {
      // Quem pede ainda é dono? Outro dono pode tê-lo removido agora há pouco
      const requester = await tx.projectMember.findUnique({
        where: { userId_projectId: { userId: req.userId, projectId } },
        select: { role: true },
      });
      if (requester?.role !== 'OWNER') return { status: 403, body: NOT_OWNER };
    }

    const target = await tx.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { role: true, user: { select: { name: true } } },
    });
    if (!target) {
      return { status: 404, body: { error: 'Essa pessoa não faz parte do projeto' } };
    }

    if (target.role === 'OWNER') {
      const owners = await tx.projectMember.count({ where: { projectId, role: 'OWNER' } });
      if (owners <= 1) {
        return {
          status: 400,
          body: { error: 'O projeto precisa de pelo menos um dono. Promova outra pessoa a dono antes.' },
        };
      }
    }

    await tx.task.updateMany({ where: { projectId, assigneeId: userId }, data: { assigneeId: null } });
    await tx.projectMember.delete({ where: { userId_projectId: { userId, projectId } } });
    // Notificações de um projeto que a pessoa não acessa mais só levariam a um erro 403
    await tx.notification.deleteMany({ where: { userId, projectId } });
    await tx.activity.create({
      data: {
        type: isSelf ? 'MEMBER_LEFT' : 'MEMBER_REMOVED',
        projectId,
        actorId: req.userId,
        meta: { name: target.user.name },
      },
    });
    return { status: 204 };
  });

  if (outcome.status === 204) return res.status(204).send();
  return res.status(outcome.status).json(outcome.body);
}

async function update(req, res) {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, description } = parsed.data;

  const project = await prisma.project.update({
    where: { id: req.params.projectId },
    data: {
      name,
      ...(description !== undefined ? { description: description || null } : {}),
    },
  });

  return res.json(project);
}

async function remove(req, res) {
  const { projectId } = req.params;

  // O schema não tem exclusão em cascata, então apagamos na ordem certa
  // e dentro de uma transação: ou sai tudo (tarefas, membros e projeto), ou nada.
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { projectId } }),
    prisma.projectMember.deleteMany({ where: { projectId } }),
    prisma.project.delete({ where: { id: projectId } }),
  ]);

  return res.status(204).send();
}

module.exports = { create, listMine, getById, addMembers, updateMemberRole, removeMember, update, remove };
