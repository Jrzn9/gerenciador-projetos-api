const prisma = require('../src/lib/prisma');

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "ProjectMember", "Project", "User" RESTART IDENTITY CASCADE;'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
