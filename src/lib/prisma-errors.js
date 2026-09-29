const { Prisma } = require('@prisma/client');

/** P2025: o update/delete não encontrou o registro (ex.: tarefa de outro projeto). */
function isRecordNotFound(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

module.exports = { isRecordNotFound };
