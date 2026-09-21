const prisma = require('../lib/prisma');

function requireProjectMember({ ownerOnly = false } = {}) {
  return async function (req, res, next) {
    const { projectId } = req.params;

    const membership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: req.userId, projectId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Você não faz parte deste projeto' });
    }

    if (ownerOnly && membership.role !== 'OWNER') {
      return res.status(403).json({ error: 'Apenas o dono do projeto pode fazer isso' });
    }

    req.membership = membership;
    return next();
  };
}

module.exports = requireProjectMember;
