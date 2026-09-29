const prisma = require('../src/lib/prisma');

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Activity", "Comment", "Notification", "Invitation", "TeamMember", "Task", "ProjectMember", "Project", "User" RESTART IDENTITY CASCADE;'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
