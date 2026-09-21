const { z } = require('zod');
const prisma = require('../lib/prisma');

const createProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
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
    },
  });

  return res.status(201).json(project);
}

async function listMine(req, res) {
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: req.userId } } },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(projects);
}

async function getById(req, res) {
  const project = await prisma.project.findUnique({
    where: { id: req.params.projectId },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  if (!project) {
    return res.status(404).json({ error: 'Projeto não encontrado' });
  }

  return res.json(project);
}

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
});

async function addMember(req, res) {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, role } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  const membership = await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: user.id, projectId: req.params.projectId } },
    update: { role },
    create: { userId: user.id, projectId: req.params.projectId, role },
  });

  return res.status(201).json(membership);
}

module.exports = { create, listMine, getById, addMember };
