const { Router } = require('express');
const projectController = require('../controllers/project.controller');
const taskController = require('../controllers/task.controller');
const invitationController = require('../controllers/invitation.controller');
const commentController = require('../controllers/comment.controller');
const activityController = require('../controllers/activity.controller');
const authMiddleware = require('../middlewares/auth');
const requireProjectMember = require('../middlewares/projectMember');
const { inviteLimiter } = require('../middlewares/rateLimit');

const router = Router();

const member = requireProjectMember();
const owner = requireProjectMember({ ownerOnly: true });

router.use(authMiddleware);

router.post('/', projectController.create);
router.get('/', projectController.listMine);
router.get('/:projectId', member, projectController.getById);
router.patch('/:projectId', owner, projectController.update);
router.delete('/:projectId', owner, projectController.remove);

// Pessoas: da minha equipe entram direto; as outras recebem convite
router.post('/:projectId/members', owner, projectController.addMembers);
router.patch('/:projectId/members/:userId', owner, projectController.updateMemberRole);
// Qualquer membro pode sair; remover outra pessoa é checado no controller (só OWNER)
router.delete('/:projectId/members/:userId', member, projectController.removeMember);

router.get('/:projectId/invitations', owner, invitationController.listForProject);
router.post('/:projectId/invitations', owner, inviteLimiter, invitationController.inviteToProject);
router.post('/:projectId/invitations/:invitationId/renew', owner, inviteLimiter, invitationController.renewForProject);
router.delete('/:projectId/invitations/:invitationId', owner, invitationController.revokeForProject);

router.get('/:projectId/activity', member, activityController.list);

router.post('/:projectId/tasks', member, taskController.create);
router.get('/:projectId/tasks', member, taskController.list);
router.patch('/:projectId/tasks/:taskId', member, taskController.update);
router.delete('/:projectId/tasks/:taskId', member, taskController.remove);

router.get('/:projectId/tasks/:taskId/comments', member, commentController.list);
router.post('/:projectId/tasks/:taskId/comments', member, commentController.create);
router.patch('/:projectId/tasks/:taskId/comments/:commentId', member, commentController.update);
router.delete('/:projectId/tasks/:taskId/comments/:commentId', member, commentController.remove);

module.exports = router;
