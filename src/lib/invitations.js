const crypto = require('crypto');
const prisma = require('./prisma');
const { userName } = require('./selects');

const DAY = 24 * 60 * 60 * 1000;
const INVITE_TTL_DAYS = 7;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Token do link: 32 bytes aleatórios (256 bits) em base64url, que cabe numa URL. */
function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

const newExpiry = () => new Date(Date.now() + INVITE_TTL_DAYS * DAY);

// O que quem convidou enxerga de um convite
const invitationSelect = {
  id: true,
  email: true,
  role: true,
  jobTitle: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: userName },
};

// O mínimo para responder a um convite
const respondSelect = {
  id: true,
  email: true,
  role: true,
  jobTitle: true,
  status: true,
  expiresAt: true,
  projectId: true,
  invitedById: true,
};

/** Um convite PENDING com a validade vencida é tratado como EXPIRED. */
function effectiveStatus(invitation) {
  if (invitation.status === 'PENDING' && invitation.expiresAt <= new Date()) return 'EXPIRED';
  return invitation.status;
}

const UNAVAILABLE_MESSAGES = {
  EXPIRED: 'Este convite expirou. Peça um novo link a quem convidou você.',
  ACCEPTED: 'Este convite já foi aceito.',
  DECLINED: 'Este convite já foi recusado.',
  REVOKED: 'Este convite foi cancelado por quem convidou.',
};

/**
 * Cria o convite. Se já existe um pendente para o mesmo e-mail e destino,
 * "reenvia": gera um link novo (o antigo para de funcionar), atualiza papel e
 * cargo e renova a validade. O token volta UMA vez; o banco guarda só o hash.
 */
async function issueInvitation({ invitedById, email, projectId = null, role = 'MEMBER', jobTitle = null }) {
  const [invitee, existing] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.invitation.findFirst({
      // Convite de projeto: um pendente por e-mail no projeto.
      // Convite de equipe: um pendente por e-mail na equipe de quem convida.
      where: { email, projectId, status: 'PENDING', ...(projectId ? {} : { invitedById }) },
      select: { id: true, inviteeId: true },
    }),
  ]);

  const { token, tokenHash } = newToken();
  const data = { tokenHash, role, jobTitle, invitedById, inviteeId: invitee?.id ?? null, expiresAt: newExpiry() };

  const invitation = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.invitation.update({ where: { id: existing.id }, data, select: invitationSelect })
      : await tx.invitation.create({ data: { ...data, email, projectId }, select: invitationSelect });

    if (invitee && existing?.inviteeId) {
      // Reenvio: a notificação que já existia volta a aparecer como nova
      await tx.notification.updateMany({
        where: { invitationId: saved.id, type: 'INVITATION_RECEIVED' },
        data: { readAt: null, createdAt: new Date() },
      });
    } else if (invitee) {
      // A pessoa já tem conta: o convite aparece no sininho dela
      await tx.notification.create({
        data: { type: 'INVITATION_RECEIVED', userId: invitee.id, actorId: invitedById, projectId, invitationId: saved.id },
      });
    }
    return saved;
  });

  return { invitation: { ...invitation, token }, renewed: Boolean(existing) };
}

/** Gera um link novo para um convite pendente (o antigo deixa de funcionar). Lança P2025 se não achar. */
async function renewInvitation(where) {
  const { token, tokenHash } = newToken();
  const invitation = await prisma.invitation.update({
    where: { ...where, status: 'PENDING' },
    data: { tokenHash, expiresAt: newExpiry() },
    select: invitationSelect,
  });
  return { ...invitation, token };
}

/** Cancela um convite pendente e tira a notificação dele do sininho da pessoa. */
function revokeInvitation(where) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { ...where, status: 'PENDING' },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });
    if (count > 0) {
      await tx.notification.deleteMany({ where: { invitationId: where.id, type: 'INVITATION_RECEIVED' } });
    }
    return count > 0;
  });
}

/**
 * Aceita ou recusa um convite, tudo numa transação. O convite só sai de
 * PENDING uma vez: dois cliques (ou duas abas) não criam nada em dobro.
 * Retorna null se o convite deixou de estar pendente no meio do caminho.
 */
function respondToInvitation(invitation, user, accept) {
  const now = new Date();
  const { projectId, invitedById } = invitation;

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: now, inviteeId: user.id },
    });
    if (count === 0) return null;

    if (accept) {
      if (projectId) {
        const membership = { userId_projectId: { userId: user.id, projectId } };
        if (!(await tx.projectMember.findUnique({ where: membership }))) {
          await tx.projectMember.create({ data: { userId: user.id, projectId, role: invitation.role } });
          await tx.activity.create({
            data: { type: 'MEMBER_JOINED', projectId, actorId: user.id, meta: { name: user.name } },
          });
        }
      }

      // Quem aceita um convite passa a fazer parte da equipe de quem convidou
      await tx.teamMember.upsert({
        where: { managerId_userId: { managerId: invitedById, userId: user.id } },
        create: { managerId: invitedById, userId: user.id, jobTitle: invitation.jobTitle },
        update: invitation.jobTitle ? { jobTitle: invitation.jobTitle } : {},
      });
    }

    await tx.notification.create({
      data: {
        type: accept ? 'INVITATION_ACCEPTED' : 'INVITATION_DECLINED',
        userId: invitedById,
        actorId: user.id,
        projectId,
        invitationId: invitation.id,
      },
    });
    // Respondido: a notificação do convite sai das "não lidas" de quem respondeu
    await tx.notification.updateMany({
      where: { invitationId: invitation.id, userId: user.id, readAt: null },
      data: { readAt: now },
    });

    return { projectId };
  });
}

module.exports = {
  hashToken,
  invitationSelect,
  respondSelect,
  effectiveStatus,
  UNAVAILABLE_MESSAGES,
  issueInvitation,
  renewInvitation,
  revokeInvitation,
  respondToInvitation,
};
