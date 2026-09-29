const prisma = require('../lib/prisma');
const { userName } = require('../lib/selects');

const PAGE_SIZE = 30;
// Notificações lidas mais antigas que isso são apagadas (o sininho só mostra as 30 últimas)
const KEEP_READ_DAYS = 30;

const notificationSelect = {
  id: true,
  type: true,
  readAt: true,
  createdAt: true,
  actor: { select: userName },
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
  // O status do convite diz se ainda dá para aceitar direto pela notificação
  invitation: { select: { id: true, status: true, role: true, expiresAt: true } },
};

const unread = (userId) => ({ userId, readAt: null });

/** GET /notifications — as mais recentes e o total de não lidas. */
async function list(req, res) {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: notificationSelect,
    }),
    prisma.notification.count({ where: unread(req.userId) }),
  ]);
  return res.json({ items, unreadCount });
}

/** GET /notifications/unread-count — leve, para o sininho consultar de tempos em tempos. */
async function unreadCount(req, res) {
  const count = await prisma.notification.count({ where: unread(req.userId) });
  return res.json({ count });
}

/** POST /notifications/:notificationId/read — idempotente. */
async function markRead(req, res) {
  await prisma.notification.updateMany({
    where: { id: req.params.notificationId, ...unread(req.userId) },
    data: { readAt: new Date() },
  });
  return res.status(204).send();
}

/** POST /notifications/read-all — e aproveita para limpar as lidas antigas (a tabela não cresce para sempre). */
async function markAllRead(req, res) {
  const cutoff = new Date(Date.now() - KEEP_READ_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.notification.updateMany({ where: unread(req.userId), data: { readAt: new Date() } }),
    prisma.notification.deleteMany({ where: { userId: req.userId, readAt: { not: null }, createdAt: { lt: cutoff } } }),
  ]);
  return res.status(204).send();
}

module.exports = { list, unreadCount, markRead, markAllRead };
