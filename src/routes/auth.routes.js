const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth');
const { loginLimiter, registerLimiter } = require('../middlewares/rateLimit');

const router = Router();

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.get('/me', authMiddleware, authController.me);

module.exports = router;
