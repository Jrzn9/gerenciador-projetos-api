# Gerenciador de Projetos API

API REST para gerenciamento de projetos e tarefas, no estilo de um quadro Kanban simplificado. Permite que usuários criem projetos, adicionem outros membros e organizem tarefas por status.

Desenvolvida com Node.js, Express e Prisma ORM sobre PostgreSQL, como projeto de estudo e portfólio.

## Funcionalidades

- Cadastro e autenticação de usuários com JWT
- Criação de projetos, com o criador assumindo automaticamente o papel de administrador (OWNER)
- Adição de novos membros a um projeto por e-mail
- Controle de permissões por papel (OWNER e MEMBER)
- Criação, listagem, atualização e remoção de tarefas
- Filtro de tarefas por status
- Validação de dados de entrada em todas as rotas

## Tecnologias utilizadas

- Node.js e Express
- Prisma ORM e PostgreSQL
- JSON Web Token (jsonwebtoken) para autenticação
- bcryptjs para hash de senhas
- Zod para validação de dados
- Jest e Supertest para testes automatizados

## Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL instalado e em execução

## Instalação e configuração

1. Clone o repositório e instale as dependências:

   ```bash
   git clone <url-do-repositorio>
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
   | `JWT_SECRET`   | Chave secreta usada para assinar os tokens de autenticação |
   | `PORT`         | Porta em que o servidor será executado (padrão: 3000)    |

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

Todas as rotas, exceto as de autenticação, exigem o cabeçalho `Authorization: Bearer <token>`.

### Autenticação

| Método | Rota             | Descrição                                    |
| ------ | ---------------- | ---------------------------------------------- |
| POST   | `/auth/register` | Cria um novo usuário                           |
| POST   | `/auth/login`    | Autentica um usuário e retorna um token JWT    |

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
| GET    | `/projects`                     | Lista os projetos dos quais o usuário é membro       |
| GET    | `/projects/:projectId`          | Retorna os detalhes e os membros de um projeto       |
| POST   | `/projects/:projectId/members`  | Adiciona um membro ao projeto por e-mail (apenas OWNER) |

**POST /projects**

```json
{
  "name": "Trabalho de Banco de Dados",
  "description": "Projeto da disciplina de Banco de Dados"
}
```

**POST /projects/:projectId/members**

```json
{
  "email": "membro@email.com",
  "role": "MEMBER"
}
```

### Tarefas

| Método | Rota                                         | Descrição                                           |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| POST   | `/projects/:projectId/tasks`                  | Cria uma tarefa no projeto                              |
| GET    | `/projects/:projectId/tasks`                  | Lista as tarefas do projeto (aceita `?status=TODO`)     |
| PATCH  | `/projects/:projectId/tasks/:taskId`          | Atualiza título, descrição, status ou responsável       |
| DELETE | `/projects/:projectId/tasks/:taskId`          | Remove uma tarefa                                       |

**POST /projects/:projectId/tasks**

```json
{
  "title": "Modelar o banco de dados",
  "description": "Criar o diagrama entidade-relacionamento",
  "assigneeId": "id-do-usuario"
}
```

**PATCH /projects/:projectId/tasks/:taskId**

```json
{
  "status": "IN_PROGRESS"
}
```

Status possíveis para uma tarefa: `TODO`, `IN_PROGRESS`, `DONE`.

## Testes

Os testes automatizados utilizam um banco de dados PostgreSQL separado do banco de desenvolvimento.

1. Crie o banco de testes e configure o arquivo `.env.test` (mesmas variáveis do `.env.example`, apontando para um banco diferente, por exemplo `gerenciador_projetos_test`).

2. Aplique as migrações nesse banco:

   ```bash
   set DATABASE_URL=<connection-string-do-banco-de-teste>
   npx prisma migrate deploy
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
- Notificação em tempo real (WebSocket) quando uma tarefa muda de status
- Upload de anexos em tarefas
- Deploy em um serviço de hospedagem (Render, Railway ou Fly.io)
