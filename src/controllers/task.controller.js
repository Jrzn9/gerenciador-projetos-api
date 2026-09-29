const { z } = require('zod');
const prisma = require('../lib/prisma');
const { isRecordNotFound } = require('../lib/prisma-errors');

const TASK_STATUS = ['TODO', 'IN_PROGRESS', 'DONE'];

// O responsável é opcional, mas quando informado precisa fazer parte do projeto.
// Antes, um id inexistente estourava a chave estrangeira no banco.
async function isProjectMember(userId, projectId) {
  if (!userId) return true;

  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });

  return Boolean(membership);
}

const ASSIGNEE_ERROR = { error: 'O responsável precisa ser membro do projeto' };
const NOT_FOUND_ERROR = { error: 'Tarefa não encontrada' };

// Toda tarefa volta com o nº de comentários (o card mostra o balão 💬)
const taskInclude = { _count: { select: { comments: true } } };
const toTask = ({ _count, assignee, ...task }) => ({ ...task, commentCount: _count.comments });

const titleSchema = z.string().trim().min(2).max(200);
const descriptionSchema = z.string().trim().max(2000);

const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  assigneeId: z.string().uuid().optional(),
  // Criar direto em qualquer coluna (antes era sempre TODO + um PATCH extra)
  status: z.enum(TASK_STATUS).default('TODO'),
});

/** Avisa a pessoa que recebeu a tarefa (a não ser que ela mesma tenha se atribuído). */
function notifyAssignee(tx, { task, actorId }) {
  if (!task.assigneeId || task.assigneeId === actorId) return null;
  return tx.notification.create({
    data: { type: 'TASK_ASSIGNED', userId: task.assigneeId, actorId, projectId: task.projectId, taskId: task.id },
  });
}

async function create(req, res) {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { projectId } = req.params;
  const { status, assigneeId } = parsed.data;

  // As duas consultas são independentes: rodam em paralelo
  const [assigneeOk, last] = await Promise.all([
    isProjectMember(assigneeId, projectId),
    prisma.task.aggregate({ where: { projectId, status }, _max: { position: true } }),
  ]);

  if (!assigneeOk) {
    return res.status(400).json(ASSIGNEE_ERROR);
  }

  const task = await prisma.$transaction(async (tx) => {
    // A tarefa nova entra no fim da coluna
    const created = await tx.task.create({
      data: { ...parsed.data, projectId, position: (last._max.position ?? 0) + 1 },
      include: taskInclude,
    });
    await tx.activity.create({
      data: {
        type: 'TASK_CREATED',
        projectId,
        taskId: created.id,
        actorId: req.userId,
        meta: { title: created.title, status: created.status },
      },
    });
    await notifyAssignee(tx, { task: created, actorId: req.userId });
    return created;
  });

  return res.status(201).json(toTask(task));
}

const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUS).optional(),
});

async function list(req, res) {
  const parsed = listTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { status } = parsed.data;

  // Usa o índice (projectId, status, position): já sai na ordem do quadro
  const tasks = await prisma.task.findMany({
    where: {
      projectId: req.params.projectId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: taskInclude,
  });

  return res.json(tasks.map(toTask));
}

const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  status: z.enum(TASK_STATUS).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  // Nova posição na coluna, calculada pelo front entre as tarefas vizinhas
  position: z.number().finite().optional(),
});

async function update(req, res) {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { projectId, taskId } = req.params;

  if (!(await isProjectMember(parsed.data.assigneeId, projectId))) {
    return res.status(400).json(ASSIGNEE_ERROR);
  }

  const task = await prisma.$transaction(async (tx) => {
    // O estado anterior diz o que mudou (para o histórico). O filtro por
    // projectId impede mexer em tarefa de outro projeto.
    const before = await tx.task.findFirst({
      where: { id: taskId, projectId },
      select: { status: true, assigneeId: true },
    });
    if (!before) return null;

    const updated = await tx.task.update({
      where: { id: taskId },
      data: parsed.data,
      include: { ...taskInclude, assignee: { select: { name: true } } },
    });

    // Reordenar dentro da coluna não entra no histórico: só o que importa
    const events = [];
    if (updated.status !== before.status) {
      events.push({ type: 'TASK_MOVED', meta: { title: updated.title, from: before.status, to: updated.status } });
    }
    if (updated.assigneeId !== before.assigneeId) {
      events.push({
        type: 'TASK_ASSIGNED',
        meta: { title: updated.title, assigneeId: updated.assigneeId, assigneeName: updated.assignee?.name ?? null },
      });
      await notifyAssignee(tx, { task: updated, actorId: req.userId });
    }
    if (events.length) {
      await tx.activity.createMany({
        data: events.map((event) => ({ ...event, projectId, taskId, actorId: req.userId })),
      });
    }
    return updated;
  });

  if (!task) return res.status(404).json(NOT_FOUND_ERROR);
  return res.json(toTask(task));
}

async function remove(req, res) {
  const { projectId, taskId } = req.params;

  try {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.task.delete({ where: { id: taskId, projectId }, select: { title: true } });
      await tx.activity.create({
        data: { type: 'TASK_DELETED', projectId, actorId: req.userId, meta: { title: deleted.title } },
      });
    });
    return res.status(204).send();
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json(NOT_FOUND_ERROR);
    throw err;
  }
}

module.exports = { create, list, update, remove };
