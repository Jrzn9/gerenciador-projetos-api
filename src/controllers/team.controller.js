const { z } = require('zod');
const prisma = require('../lib/prisma');
const { isRecordNotFound } = require('../lib/prisma-errors');
const { userPublic } = require('../lib/selects');
const invitations = require('../lib/invitations');
const { emailSchema, jobTitleSchema } = require('./invitation.controller');

const teamInviteSchema = z.object({
  email: emailSchema,
  jobTitle: jobTitleSchema.optional(),
});

const updateMemberSchema = z.object({
  jobTitle: jobTitleSchema,
});

const NOT_IN_TEAM = { error: 'Essa pessoa não está na sua equipe' };

/**
 * GET /team — a minha equipe, os convites de equipe pendentes e as equipes
 * de outras pessoas das quais eu faço parte. 3 consultas em paralelo.
 */
async function overview(req, res) {
  const [members, pending, memberOf] = await Promise.all([
    prisma.teamMember.findMany({
      where: { managerId: req.userId },
      orderBy: { user: { name: 'asc' } },
      select: { jobTitle: true, createdAt: true, user: { select: userPublic } },
    }),
    prisma.invitation.findMany({
      where: { invitedById: req.userId, projectId: null, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: invitations.invitationSelect,
    }),
    prisma.teamMember.findMany({
      where: { userId: req.userId },
      orderBy: { manager: { name: 'asc' } },
      select: { jobTitle: true, createdAt: true, manager: { select: userPublic } },
    }),
  ]);

  return res.json({ members, invitations: pending, memberOf });
}

/** POST /team/invitations — convida alguém para a minha equipe. */
async function invite(req, res) {
  const parsed = teamInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, jobTitle = null } = parsed.data;

  const [me, alreadyInTeam] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } }),
    prisma.teamMember.findFirst({ where: { managerId: req.userId, user: { email } }, select: { id: true } }),
  ]);

  if (me?.email === email) {
    return res.status(400).json({ error: 'Você não pode convidar a si mesmo' });
  }
  if (alreadyInTeam) {
    return res.status(409).json({ error: 'Essa pessoa já está na sua equipe' });
  }

  const { invitation, renewed } = await invitations.issueInvitation({ invitedById: req.userId, email, jobTitle });
  return res.status(renewed ? 200 : 201).json({ ...invitation, renewed });
}

/** POST /team/invitations/:invitationId/renew */
async function renewInvitation(req, res) {
  try {
    const invitation = await invitations.renewInvitation({
      id: req.params.invitationId,
      invitedById: req.userId,
      projectId: null,
    });
    return res.json(invitation);
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json({ error: 'Convite não encontrado' });
    throw err;
  }
}

/** DELETE /team/invitations/:invitationId */
async function revokeInvitation(req, res) {
  const revoked = await invitations.revokeInvitation({
    id: req.params.invitationId,
    invitedById: req.userId,
    projectId: null,
  });
  return revoked ? res.status(204).send() : res.status(404).json({ error: 'Convite não encontrado' });
}

/** PATCH /team/members/:userId — muda o cargo. */
async function updateMember(req, res) {
  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const member = await prisma.teamMember.update({
      where: { managerId_userId: { managerId: req.userId, userId: req.params.userId } },
      data: { jobTitle: parsed.data.jobTitle },
      select: { jobTitle: true, createdAt: true, user: { select: userPublic } },
    });
    return res.json(member);
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json(NOT_IN_TEAM);
    throw err;
  }
}

/** DELETE /team/members/:userId — tira da equipe (a pessoa continua nos projetos). */
async function removeMember(req, res) {
  try {
    await prisma.teamMember.delete({
      where: { managerId_userId: { managerId: req.userId, userId: req.params.userId } },
    });
    return res.status(204).send();
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json(NOT_IN_TEAM);
    throw err;
  }
}

/** DELETE /team/memberships/:managerId — saio da equipe de outra pessoa. */
async function leave(req, res) {
  try {
    await prisma.teamMember.delete({
      where: { managerId_userId: { managerId: req.params.managerId, userId: req.userId } },
    });
    return res.status(204).send();
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json({ error: 'Você não faz parte dessa equipe' });
    throw err;
  }
}

module.exports = { overview, invite, renewInvitation, revokeInvitation, updateMember, removeMember, leave };
