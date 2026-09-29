const { z } = require('zod');
const prisma = require('../lib/prisma');
const { userName } = require('../lib/selects');

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: { select: userName },
};

const TASK_NOT_FOUND = { error: 'Tarefa não encontrada' };
const COMMENT_NOT_FOUND = { error: 'Comentário não encontrado' };

/** GET /projects/:projectId/tasks/:taskId/comments — 1 consulta, já confere o projeto. */
async function list(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    select: { comments: { orderBy: { createdAt: 'asc' }, select: commentSelect } },
  });
  if (!task) return res.status(404).json(TASK_NOT_FOUND);

  return res.json(task.comments);
}

/** POST — comenta e avisa o responsável pela tarefa. */
async function create(req, res) {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { projectId, taskId } = req.params;
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    select: { title: true, assigneeId: true },
  });
  if (!task) return res.status(404).json(TASK_NOT_FOUND);

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { body: parsed.data.body, taskId, authorId: req.userId },
      select: commentSelect,
    });
    await tx.activity.create({
      data: { type: 'COMMENT_ADDED', projectId, taskId, actorId: req.userId, meta: { title: task.title } },
    });
    if (task.assigneeId && task.assigneeId !== req.userId) {
      await tx.notification.create({
        data: { type: 'TASK_COMMENTED', userId: task.assigneeId, actorId: req.userId, projectId, taskId },
      });
    }
    return created;
  });

  return res.status(201).json(comment);
}

/** Busca o comentário garantindo que ele é desta tarefa e deste projeto. */
function findComment({ projectId, taskId, commentId }) {
  return prisma.comment.findFirst({
    where: { id: commentId, taskId, task: { projectId } },
    select: { authorId: true },
  });
}

/** PATCH — só quem escreveu pode editar. */
async function update(req, res) {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const comment = await findComment(req.params);
  if (!comment) return res.status(404).json(COMMENT_NOT_FOUND);
  if (comment.authorId !== req.userId) {
    return res.status(403).json({ error: 'Só quem escreveu pode editar o comentário' });
  }

  const updated = await prisma.comment.update({
    where: { id: req.params.commentId },
    data: { body: parsed.data.body },
    select: commentSelect,
  });
  return res.json(updated);
}

/** DELETE — quem escreveu ou o dono do projeto (moderação). */
async function remove(req, res) {
  const comment = await findComment(req.params);
  if (!comment) return res.status(404).json(COMMENT_NOT_FOUND);
  if (comment.authorId !== req.userId && req.membership.role !== 'OWNER') {
    return res.status(403).json({ error: 'Só quem escreveu ou o dono do projeto pode excluir o comentário' });
  }

  await prisma.comment.delete({ where: { id: req.params.commentId } });
  return res.status(204).send();
}

module.exports = { list, create, update, remove };
