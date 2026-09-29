const { z } = require('zod');
const prisma = require('../lib/prisma');
const { userName } = require('../lib/selects');

const querySchema = z.object({
  // Histórico de uma tarefa só (usado no diálogo da tarefa)
  taskId: z.string().uuid().optional(),
  // Paginação por cursor: o id do último item recebido ("carregar mais")
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** GET /projects/:projectId/activity — do mais recente para o mais antigo. */
async function list(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { taskId, cursor, limit } = parsed.data;

  // Busca um a mais para saber se ainda existe outra página
  const rows = await prisma.activity.findMany({
    where: { projectId: req.params.projectId, ...(taskId ? { taskId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, type: true, meta: true, createdAt: true, taskId: true, actor: { select: userName } },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
}

module.exports = { list };
