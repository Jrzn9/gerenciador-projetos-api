# Gerenciador de Projetos API

API REST para gerenciamento de projetos e tarefas, no estilo de um quadro Kanban simplificado. Permite que usuários criem projetos, adicionem outros membros e organizem tarefas por status.

Desenvolvida com Node.js, Express e Prisma ORM sobre PostgreSQL, como projeto de estudo e portfólio.

## Funcionalidades

- Cadastro e autenticação de usuários com JWT
- Criação de projetos, com o criador assumindo automaticamente o papel de administrador (OWNER)
- **Convites com aceite**: o dono convida por e-mail e a pessoa só entra quando aceita (dentro do app ou por um link seguro, que também serve para quem ainda não tem conta)
- **Equipe ("funcionários")**: quem aceita um convite entra na equipe de quem convidou, com cargo; depois o dono coloca a equipe nos projetos com um clique, sem convite
- **Notificações**: convite recebido/aceito/recusado, "te adicionaram a um projeto", "tarefa atribuída a você" e "comentaram na sua tarefa", com contador de não lidas
- **Comentários** nas tarefas (editar e excluir) e **histórico** do projeto e de cada tarefa (quem criou, moveu, concluiu, atribuiu...)
- Troca de papel, remoção de membros e "sair do projeto" (o projeto nunca fica sem dono)
- Controle de permissões por papel (OWNER e MEMBER)
- Criação, listagem, atualização e remoção de tarefas, com **ordem personalizada** dentro de cada coluna
- Filtro de tarefas por status
- Listagem de projetos já com o papel do usuário, nº de membros e tarefas por status (para barras de progresso)
- Validação de dados de entrada em todas as rotas
- Responsável pela tarefa precisa ser membro do projeto
- CORS configurável para o front-end ([gerenciador-projetos-web](https://github.com/Jrzn9/gerenciador-projetos-web))

## Tecnologias utilizadas

- Node.js e Express 5
- Prisma ORM e PostgreSQL
- JSON Web Token (jsonwebtoken) para autenticação
- bcryptjs para hash de senhas
- Zod para validação de dados
- Helmet e express-rate-limit para segurança
- Jest e Supertest para testes automatizados

## Segurança

| Proteção | Como funciona |
| --- | --- |
| **Senhas com bcrypt** | Hash com custo 12 (configurável). Mínimo de 8 caracteres e máximo de 72 bytes, o limite real do bcrypt. A senha e o hash nunca aparecem nas respostas. |
| **JWT** | Assinado com HS256 e algoritmo fixado na verificação (tokens `alg: none` ou de outro algoritmo são recusados). Expira em 1 dia (configurável). |
| **Segredo forte obrigatório** | A API não sobe se o `JWT_SECRET` tiver menos de 32 caracteres. |
| **Força bruta** | Limite de tentativas por IP: 10 logins errados a cada 15 minutos e 10 cadastros por hora (configurável). Depois disso a API responde `429`. |
| **Enumeração de contas** | O login responde a mesma mensagem e leva o mesmo tempo para e-mail inexistente e senha errada (compara com um hash "falso"). |
| **Autorização** | Cada rota de projeto confere se o usuário é membro; convidar e gerenciar pessoas é só para OWNER. Tarefas e comentários são sempre buscados junto com o id do projeto (sem IDOR). Comentário só é editado por quem escreveu. |
| **Convites** | O token do link tem 256 bits aleatórios e o banco guarda **só o hash SHA-256** dele (como uma senha). O link vale 7 dias, funciona uma única vez e só para quem estiver logado com o e-mail convidado. O token vai no corpo das requisições e, no front, fica depois do `#` da URL (a parte que nunca é enviada a servidor nenhum). Convites feitos antes de a conta existir só podem ser aceitos pelo link, porque sem verificação de e-mail qualquer um poderia criar a conta com aquele e-mail. Convidar responde igual para e-mails com e sem conta (não revela quem é cadastrado), e há limite de convites por pessoa por hora. |
| **Validação** | Zod em todos os corpos e no filtro de status, com limite de tamanho em todos os textos. E-mails são normalizados (minúsculas, sem espaços). Campos desconhecidos são descartados. |
| **Cabeçalhos HTTP** | Helmet (nosniff, HSTS, bloqueio de iframe, CSP) e sem o `X-Powered-By`. |
| **CORS** | Só as origens em `CORS_ORIGIN` podem chamar a API pelo navegador. |
| **Erros** | JSON malformado → `400`; corpo acima de 10 kB → `413`; erros inesperados → `500` genérico (detalhes só no log). Com o Express 5, nenhum erro derruba o processo. |
| **SQL injection** | Todas as consultas passam pelo Prisma, que usa parâmetros. |

Em produção, rode a API atrás de HTTPS (Render, Railway e Fly.io já fazem isso) e defina `TRUST_PROXY=1` para o limite por IP enxergar o IP real do usuário.

## Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL instalado e em execução

## Instalação e configuração

1. Clone o repositório e instale as dependências:

   ```bash
   git clone https://github.com/Jrzn9/gerenciador-projetos-api.git
   cd gerenciador-projetos-api
   npm install
   ```

2. Copie o arquivo de exemplo de variáveis de ambiente e preencha com os seus dados:

   ```bash
   cp .env.example .env
   ```

   | Variável       | Descrição                                              |
   | -------------- | ------------------------------------------------------- |
   | `DATABASE_URL` | String de conexão do PostgreSQL                          |
   | `JWT_SECRET`   | Chave secreta que assina os tokens. **Obrigatória, com 32+ caracteres.** Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `PORT`         | Porta em que o servidor será executado (padrão: 3000)    |
   | `CORS_ORIGIN`  | Endereços do front-end autorizados a chamar a API, separados por vírgula (padrão: `http://localhost:4200`) |
   | `JWT_EXPIRES_IN` | Validade do token de login (padrão: `1d`) |
   | `BCRYPT_ROUNDS` | Custo do hash de senha, entre 4 e 15 (padrão: 12) |
   | `AUTH_RATE_LIMIT_MAX` | Tentativas de login/cadastro por IP em cada janela (padrão: 10) |
   | `INVITE_RATE_LIMIT_MAX` | Convites que cada pessoa pode criar por hora e consultas de link de convite por IP a cada 15 min (padrão: 30) |
   | `TRUST_PROXY`  | Número de proxies na frente da API; use `1` em Render/Railway (padrão: nenhum) |

3. Execute as migrações do Prisma para criar as tabelas no banco de dados:

   ```bash
   npm run prisma:migrate
   ```

## Executando o projeto

```bash
npm run dev
```

O servidor será iniciado em `http://localhost:3000`.

## Documentação da API

Todas as rotas, exceto cadastro e login, exigem o cabeçalho `Authorization: Bearer <token>`.

### Autenticação

| Método | Rota             | Descrição                                    |
| ------ | ---------------- | ---------------------------------------------- |
| POST   | `/auth/register` | Cria um novo usuário                           |
| POST   | `/auth/login`    | Autentica um usuário e retorna um token JWT    |
| GET    | `/auth/me`       | Retorna os dados do usuário logado             |

**POST /auth/register**

```json
{
  "name": "Maria Silva",
  "email": "maria@email.com",
  "password": "senha123"
}
```

**POST /auth/login**

```json
{
  "email": "maria@email.com",
  "password": "senha123"
}
```

Resposta:

```json
{
  "token": "<jwt>"
}
```

### Projetos

| Método | Rota                            | Descrição                                          |
| ------ | ------------------------------- | ---------------------------------------------------- |
| POST   | `/projects`                     | Cria um projeto (o criador se torna OWNER)           |
| GET    | `/projects`                     | Lista os projetos do usuário, com `role`, `memberCount` e `taskCounts` |
| GET    | `/projects/:projectId`          | Retorna os detalhes e os membros de um projeto       |
| PATCH  | `/projects/:projectId`          | Edita nome e/ou descrição (apenas OWNER; descrição `""` limpa o campo) |
| DELETE | `/projects/:projectId`          | Exclui o projeto com todas as tarefas e membros, numa transação (apenas OWNER) |
| POST   | `/projects/:projectId/members`  | Adiciona pessoas **da sua equipe**, várias de uma vez (apenas OWNER). As demais entram por convite |
| PATCH  | `/projects/:projectId/members/:userId` | Muda o papel de alguém (apenas OWNER; ninguém muda o próprio papel) |
| DELETE | `/projects/:projectId/members/:userId` | O OWNER remove alguém; com o próprio id, o membro sai do projeto. O único dono não pode sair, e as tarefas da pessoa ficam sem responsável |

**GET /projects** (resposta)

```json
[
  {
    "id": "…",
    "name": "Trabalho de Banco de Dados",
    "description": null,
    "createdAt": "2026-09-28T00:00:00.000Z",
    "role": "OWNER",
    "memberCount": 3,
    "taskCounts": { "TODO": 4, "IN_PROGRESS": 2, "DONE": 6 }
  }
]
```

**POST /projects**

```json
{
  "name": "Trabalho de Banco de Dados",
  "description": "Projeto da disciplina de Banco de Dados"
}
```

**POST /projects/:projectId/members** (pessoas da sua equipe)

```json
{
  "userIds": ["id-da-ana", "id-do-bruno"],
  "role": "MEMBER"
}
```

### Convites

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET    | `/projects/:projectId/invitations` | Convites pendentes do projeto (apenas OWNER) |
| POST   | `/projects/:projectId/invitations` | Convida por e-mail (`{ email, role, jobTitle? }`). Devolve o `token` do link **uma única vez**. Se já havia convite pendente, reenvia (link novo) e responde `200` |
| POST   | `/projects/:projectId/invitations/:id/renew` | Gera um link novo (o anterior para de funcionar) e renova a validade |
| DELETE | `/projects/:projectId/invitations/:id` | Cancela o convite |
| GET    | `/invitations` | Convites que eu recebi e ainda posso responder |
| POST   | `/invitations/:id/accept` e `/decline` | Responde dentro do app |
| POST   | `/invitations/link/preview` | **Pública.** `{ token }` → projeto, quem convidou, papel, validade e status |
| POST   | `/invitations/link/accept` e `/link/decline` | Responde pelo link (`{ token }`), logado com o e-mail convidado |

Erros: `403` (link de outro e-mail), `404` (link inválido) e `410` (convite expirado, já usado ou cancelado, com o `status` no corpo).

### Equipe

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET    | `/team` | `{ members, invitations, memberOf }`: minha equipe, convites de equipe pendentes e as equipes de que faço parte |
| POST   | `/team/invitations` | Convida para a equipe (`{ email, jobTitle? }`), sem projeto |
| POST   | `/team/invitations/:id/renew` | Link novo |
| DELETE | `/team/invitations/:id` | Cancela o convite |
| PATCH  | `/team/members/:userId` | Muda o cargo (`{ jobTitle }`; `""` remove) |
| DELETE | `/team/members/:userId` | Tira da minha equipe (a pessoa continua nos projetos) |
| DELETE | `/team/memberships/:managerId` | Saio da equipe de outra pessoa |

Quem aceita qualquer convite (de projeto ou de equipe) entra automaticamente na equipe de quem convidou.

### Notificações

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET    | `/notifications` | As 30 mais recentes e o total de não lidas |
| GET    | `/notifications/unread-count` | Só o contador (consulta leve, para o sininho) |
| POST   | `/notifications/:id/read` | Marca uma como lida |
| POST   | `/notifications/read-all` | Marca todas como lidas e apaga as lidas com mais de 30 dias |

### Comentários e histórico

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET    | `/projects/:projectId/tasks/:taskId/comments` | Lista os comentários da tarefa |
| POST   | `/projects/:projectId/tasks/:taskId/comments` | Comenta (`{ body }`, até 2000 caracteres) e avisa o responsável pela tarefa |
| PATCH  | `/projects/:projectId/tasks/:taskId/comments/:id` | Edita (só quem escreveu) |
| DELETE | `/projects/:projectId/tasks/:taskId/comments/:id` | Exclui (quem escreveu ou o OWNER) |
| GET    | `/projects/:projectId/activity` | Histórico, do mais recente para o mais antigo. Aceita `?taskId=`, `?limit=` (até 100) e `?cursor=` (o `nextCursor` da resposta anterior) |

O histórico guarda um "retrato" de cada evento (título da tarefa, nome da pessoa, colunas de origem e destino), então continua legível mesmo depois que a tarefa é renomeada ou excluída. Reordenar dentro da mesma coluna não entra no histórico.

### Tarefas

| Método | Rota                                         | Descrição                                           |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| POST   | `/projects/:projectId/tasks`                  | Cria uma tarefa (em qualquer coluna, sempre no fim dela) |
| GET    | `/projects/:projectId/tasks`                  | Lista as tarefas na ordem do quadro (aceita `?status=TODO`) |
| PATCH  | `/projects/:projectId/tasks/:taskId`          | Atualiza título, descrição, status, responsável ou posição |
| DELETE | `/projects/:projectId/tasks/:taskId`          | Remove uma tarefa                                       |

**POST /projects/:projectId/tasks**

```json
{
  "title": "Modelar o banco de dados",
  "description": "Criar o diagrama entidade-relacionamento",
  "assigneeId": "id-do-usuario",
  "status": "IN_PROGRESS"
}
```

**PATCH /projects/:projectId/tasks/:taskId** (mover para outra coluna, entre duas tarefas)

```json
{
  "status": "IN_PROGRESS",
  "position": 1.5
}
```

Status possíveis para uma tarefa: `TODO`, `IN_PROGRESS`, `DONE`.

A `position` é decimal: para colocar uma tarefa entre outras de posição 1 e 2, basta mandar `1.5`. Assim, reordenar altera **só a tarefa movida**, sem renumerar a coluna inteira.

## Desempenho

- **Índices** em `Task(projectId, status, position)`, `Task(assigneeId)` e `ProjectMember(projectId)`. No PostgreSQL, chaves estrangeiras não ganham índice sozinhas.
- `GET /projects` usa **2 consultas no total**, qualquer que seja o número de projetos (sem o problema de "N+1").
- Editar e excluir tarefa usam **1 consulta** cada (o filtro por projeto vai no próprio `update`/`delete`).
- Respostas compactadas com **gzip**.
- Índices para o sininho (`Notification(userId, readAt)` e `(userId, createdAt)`), para o histórico (`Activity(projectId, createdAt)` e `(taskId, createdAt)`) e para os comentários (`Comment(taskId, createdAt)`).
- O front consulta só o **contador** de notificações a cada 30 s, e só com a aba visível; a lista completa é buscada quando o painel abre.
- Cada tarefa já vem com `commentCount` na mesma consulta do quadro.
- Aceitar convite, criar tarefa com responsável, comentar etc. rodam em **transação**: ou salva tudo (membro, equipe, histórico e notificação), ou nada.

## Testes

Os testes automatizados utilizam um banco de dados PostgreSQL separado do banco de desenvolvimento.

1. Crie o banco de testes e configure o arquivo `.env.test` (mesmas variáveis do `.env.example`, apontando para um banco diferente, por exemplo `gerenciador_projetos_test`).

2. Aplique as migrações nesse banco:

   ```bash
   DATABASE_URL="<connection-string-do-banco-de-teste>" npx prisma migrate deploy
   ```

3. Execute a suíte de testes:

   ```bash
   npm test
   ```

## Estrutura do projeto

```
src/
  controllers/     Regras de negócio de cada recurso
  middlewares/      Autenticação e verificação de permissões
  routes/           Definição das rotas da API
  lib/              Configuração do cliente Prisma
  app.js            Configuração do Express
  server.js         Ponto de entrada da aplicação
prisma/
  schema.prisma     Modelos do banco de dados
  migrations/        Histórico de migrações
tests/               Testes automatizados (Jest e Supertest)
```

## Possíveis melhorias futuras

- Paginação e busca por texto na listagem de tarefas
- Notificação em tempo real (WebSocket ou SSE) em vez de consultar o contador a cada 30 s
- Envio de e-mail de verdade para os convites (hoje o dono compartilha o link por WhatsApp ou e-mail)
- Verificação de e-mail no cadastro
- Upload de anexos em tarefas
- Deploy em um serviço de hospedagem (Render, Railway ou Fly.io)
