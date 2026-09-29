const { Router } = require('express');
const invitationController = require('../controllers/invitation.controller');
const authMiddleware = require('../middlewares/auth');
const { inviteLinkLimiter } = require('../middlewares/rateLimit');

const router = Router();

// Pública: a página do link mostra o convite antes de a pessoa entrar ou criar conta
router.post('/link/preview', inviteLinkLimiter, invitationController.previewLink);

router.use(authMiddleware);

router.get('/', invitationController.listReceived);
router.post('/link/accept', inviteLinkLimiter, invitationController.acceptLink);
router.post('/link/decline', inviteLinkLimiter, invitationController.declineLink);
router.post('/:invitationId/accept', invitationController.accept);
router.post('/:invitationId/decline', invitationController.decline);

module.exports = router;
