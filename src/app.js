const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const { isRecordNotFound, isUniqueViolation } = require('./lib/prisma-errors');
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const invitationRoutes = require('./routes/invitation.routes');
const teamRoutes = require('./routes/team.routes');
const notificationRoutes = require('./routes/notification.routes');

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

// Cabeçalhos de segurança (nosniff, HSTS, bloqueio de iframe...) e sem o "X-Powered-By: Express"
app.use(helmet());

// Respostas grandes (listas de tarefas) vão compactadas com gzip
app.use(compression());

// Só os endereços do front-end configurados podem chamar a API pelo navegador
app.use(cors({ origin: config.corsOrigins }));

// Corpo limitado a 10 kB: nenhuma rota precisa de mais, e isso evita payloads gigantes
app.use(express.json({ limit: '10kb' }));

app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/invitations', invitationRoutes);
app.use('/team', teamRoutes);
app.use('/notifications', notificationRoutes);

// No Express 5, erros lançados dentro de rotas async também chegam aqui,
// em vez de derrubar o processo.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corpo da requisição grande demais' });
  }
  // Duas requisições iguais ao mesmo tempo: a segunda esbarra no @unique do banco
  if (isUniqueViolation(err)) {
    return res.status(409).json({ error: 'Esse registro já existe. Atualize a página e tente novamente.' });
  }
  // O registro sumiu no meio da operação (ex.: o projeto foi excluído por outra pessoa)
  if (isRecordNotFound(err)) {
    return res.status(404).json({ error: 'Registro não encontrado. Ele pode ter sido excluído; atualize a página.' });
  }

  // Detalhes do erro ficam só no log do servidor, nunca na resposta
  console.error(err);
  return res.status(500).json({ error: 'Erro interno do servidor' });
});

module.exports = app;
