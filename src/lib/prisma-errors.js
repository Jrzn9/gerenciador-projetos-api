const { Prisma } = require('@prisma/client');

/** P2025: o update/delete não encontrou o registro (ex.: tarefa de outro projeto). */
function isRecordNotFound(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

/**
 * P2002: violou um @unique. Acontece quando duas requisições iguais chegam ao
 * mesmo tempo (ex.: clique duplo em "criar conta" ou "aceitar convite"): a
 * checagem passa nas duas, mas o banco só deixa uma gravar.
 */
function isUniqueViolation(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

module.exports = { isRecordNotFound, isUniqueViolation };
