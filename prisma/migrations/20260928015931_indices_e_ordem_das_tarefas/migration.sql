-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Tarefas que já existiam: numera na ordem de criação, coluna por coluna,
-- para o quadro manter a mesma ordem de antes
UPDATE "Task" AS t
SET "position" = ordered.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId", "status" ORDER BY "createdAt") AS rn
  FROM "Task"
) AS ordered
WHERE t.id = ordered.id;

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId", "status", "position");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
