const { Router } = require('express');
const projectController = require('../controllers/project.controller');
const taskController = require('../controllers/task.controller');
const authMiddleware = require('../middlewares/auth');
const requireProjectMember = require('../middlewares/projectMember');

const router = Router();

router.use(authMiddleware);

router.post('/', projectController.create);
router.get('/', projectController.listMine);
router.get('/:projectId', requireProjectMember(), projectController.getById);
router.post('/:projectId/members', requireProjectMember({ ownerOnly: true }), projectController.addMember);

router.post('/:projectId/tasks', requireProjectMember(), taskController.create);
router.get('/:projectId/tasks', requireProjectMember(), taskController.list);
router.patch('/:projectId/tasks/:taskId', requireProjectMember(), taskController.update);
router.delete('/:projectId/tasks/:taskId', requireProjectMember(), taskController.remove);

module.exports = router;
