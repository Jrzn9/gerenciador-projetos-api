const { Router } = require('express');
const notificationController = require('../controllers/notification.controller');
const authMiddleware = require('../middlewares/auth');

const router = Router();

router.use(authMiddleware);

router.get('/', notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.post('/read-all', notificationController.markAllRead);
router.post('/:notificationId/read', notificationController.markRead);

module.exports = router;
