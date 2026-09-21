const { z } = require('zod');
const prisma = require('../lib/prisma');

const createTaskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
});

async function create(req, res) {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const task = await prisma.task.create({
    data: { ...parsed.data, projectId: req.params.projectId },
  });

  return res.status(201).json(task);
}

async function list(req, res) {
  const { status } = req.query;

  const tasks = await prisma.task.findMany({
    where: {
      projectId: req.params.projectId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(tasks);
}

const updateTaskSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

async function update(req, res) {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { count } = await prisma.task.updateMany({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    data: parsed.data,
  });

  if (count === 0) {
    return res.status(404).json({ error: 'Tarefa não encontrada' });
  }

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  return res.json(task);
}

async function remove(req, res) {
  const { count } = await prisma.task.deleteMany({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  });

  if (count === 0) {
    return res.status(404).json({ error: 'Tarefa não encontrada' });
  }

  return res.status(204).send();
}

module.exports = { create, list, update, remove };
