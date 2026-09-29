const { z } = require('zod');
const prisma = require('../lib/prisma');
const { isRecordNotFound } = require('../lib/prisma-errors');
const { userName } = require('../lib/selects');
const invitations = require('../lib/invitations');

const emailSchema = z.string().trim().toLowerCase().email().max(254);
// Cargo opcional (ex.: "Dev", "Designer"). Texto vazio = sem cargo.
const jobTitleSchema = z
  .string()
  .trim()
  .max(60)
  .transform((value) => value || null);

const projectInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
  jobTitle: jobTitleSchema.optional(),
});

// O token vai no corpo (POST), e não na URL: assim ele não fica gravado em
// logs de servidor e de proxy
const tokenSchema = z.object({
  token: z
    .string()
    .min(20)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const NOT_FOUND = { error: 'Convite não encontrado' };
const LINK_NOT_FOUND = { error: 'Convite não encontrado. Confira se o link está completo.' };

// ---------- Dono do projeto ----------

/** GET /projects/:projectId/invitations — convites pendentes (só OWNER). */
async function listForProject(req, res) {
  const pending = await prisma.invitation.findMany({
    where: { projectId: req.params.projectId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: invitations.invitationSelect,
  });
  return res.json(pending);
}

/**
 * POST /projects/:projectId/invitations — convida por e-mail (só OWNER).
 * A resposta é igual para e-mails com e sem conta: ninguém usa o convite
 * para descobrir quem está cadastrado.
 */
async function inviteToProject(req, res) {
  const parsed = projectInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, role, jobTitle = null } = parsed.data;
  const { projectId } = req.params;

  // Cobre também o próprio dono tentando se convidar
  const alreadyMember = await prisma.projectMember.findFirst({
    where: { projectId, user: { email } },
    select: { id: true },
  });
  if (alreadyMember) {
    return res.status(409).json({ error: 'Essa pessoa já faz parte do projeto' });
  }

  const { invitation, renewed } = await invitations.issueInvitation({
    invitedById: req.userId,
    email,
    projectId,
    role,
    jobTitle,
  });

  return res.status(renewed ? 200 : 201).json({ ...invitation, renewed });
}

/** POST /projects/:projectId/invitations/:invitationId/renew — novo link (só OWNER). */
async function renewForProject(req, res) {
  try {
    const invitation = await invitations.renewInvitation({
      id: req.params.invitationId,
      projectId: req.params.projectId,
    });
    return res.json(invitation);
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json(NOT_FOUND);
    throw err;
  }
}

/** DELETE /projects/:projectId/invitations/:invitationId — cancela (só OWNER). */
async function revokeForProject(req, res) {
  const revoked = await invitations.revokeInvitation({
    id: req.params.invitationId,
    projectId: req.params.projectId,
  });
  return revoked ? res.status(204).send() : res.status(404).json(NOT_FOUND);
}

// ---------- Quem foi convidado ----------

/** GET /invitations — convites pendentes que eu recebi (dentro do app). */
async function listReceived(req, res) {
  const received = await prisma.invitation.findMany({
    where: { inviteeId: req.userId, status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      role: true,
      jobTitle: true,
      expiresAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
      invitedBy: { select: userName },
    },
  });
  return res.json(received);
}

/** POST /invitations/link/preview — pública: o que mostrar na página do link. */
async function previewLink(req, res) {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(LINK_NOT_FOUND);
  }

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: invitations.hashToken(parsed.data.token) },
    select: {
      email: true,
      role: true,
      jobTitle: true,
      status: true,
      expiresAt: true,
      project: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invitation) {
    return res.status(404).json(LINK_NOT_FOUND);
  }

  return res.json({ ...invitation, status: invitations.effectiveStatus(invitation) });
}

async function currentUser(userId) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
}

/** Confere validade e responde ao convite. */
async function finishResponse(res, invitation, user, accept) {
  const status = invitations.effectiveStatus(invitation);
  if (status !== 'PENDING') {
    return res.status(410).json({ error: invitations.UNAVAILABLE_MESSAGES[status], status });
  }

  const result = await invitations.respondToInvitation(invitation, user, accept);
  if (!result) {
    return res.status(410).json({ error: 'Este convite não está mais disponível.' });
  }

  return res.json({ status: accept ? 'ACCEPTED' : 'DECLINED', projectId: result.projectId });
}

/** POST /invitations/link/accept | /link/decline — pelo link, com o e-mail certo. */
function respondByLink(accept) {
  return async (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(LINK_NOT_FOUND);
    }

    const [invitation, user] = await Promise.all([
      prisma.invitation.findUnique({
        where: { tokenHash: invitations.hashToken(parsed.data.token) },
        select: invitations.respondSelect,
      }),
      currentUser(req.userId),
    ]);

    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!invitation) return res.status(404).json(LINK_NOT_FOUND);

    // Um link vazado não serve para outra pessoa: precisa estar logado com o e-mail convidado
    if (invitation.email !== user.email) {
      return res
        .status(403)
        .json({ error: 'Este convite foi enviado para outro e-mail. Entre com a conta certa para responder.' });
    }

    return finishResponse(res, invitation, user, accept);
  };
}

/** POST /invitations/:invitationId/accept | /decline — dentro do app. */
function respondById(accept) {
  return async (req, res) => {
    const [invitation, user] = await Promise.all([
      prisma.invitation.findFirst({
        where: { id: req.params.invitationId, inviteeId: req.userId },
        select: invitations.respondSelect,
      }),
      currentUser(req.userId),
    ]);

    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!invitation) return res.status(404).json(NOT_FOUND);

    return finishResponse(res, invitation, user, accept);
  };
}

module.exports = {
  jobTitleSchema,
  emailSchema,
  listForProject,
  inviteToProject,
  renewForProject,
  revokeForProject,
  listReceived,
  previewLink,
  acceptLink: respondByLink(true),
  declineLink: respondByLink(false),
  accept: respondById(true),
  decline: respondById(false),
};
