const { Router } = require('express');
const teamController = require('../controllers/team.controller');
const authMiddleware = require('../middlewares/auth');
const { inviteLimiter } = require('../middlewares/rateLimit');

const router = Router();

router.use(authMiddleware);

router.get('/', teamController.overview);
router.post('/invitations', inviteLimiter, teamController.invite);
router.post('/invitations/:invitationId/renew', inviteLimiter, teamController.renewInvitation);
router.delete('/invitations/:invitationId', teamController.revokeInvitation);
router.patch('/members/:userId', teamController.updateMember);
router.delete('/members/:userId', teamController.removeMember);
router.delete('/memberships/:managerId', teamController.leave);

module.exports = router;
