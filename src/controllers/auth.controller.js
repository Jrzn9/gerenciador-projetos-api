const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const config = require('../config');

// E-mail sempre sem espaços e em minúsculas: "Ana@Email.com" e "ana@email.com"
// são a mesma conta (evita cadastros duplicados e falhas de login)
const emailSchema = z.string().trim().toLowerCase().email().max(254);

// O bcrypt só usa os primeiros 72 bytes da senha e ignora o resto sem avisar,
// então o limite é explícito
const newPasswordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: newPasswordSchema,
});

async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'E-mail já cadastrado' });
  }

  const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  return res.status(201).json(user);
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

// Hash de uma senha que não pertence a ninguém. Quando o e-mail não existe,
// comparamos com ele mesmo assim: a resposta leva o mesmo tempo nos dois casos
// e ninguém consegue descobrir quais e-mails têm conta medindo o tempo.
const DUMMY_HASH = bcrypt.hashSync('senha-que-nao-pertence-a-ninguem', config.bcryptRounds);

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

  // Mesma mensagem para e-mail inexistente e senha errada
  if (!user || !passwordMatches) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });

  return res.json({ token });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  // Token válido de um usuário que não existe mais: trata como sessão inválida
  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado' });
  }

  return res.json(user);
}

module.exports = { register, login, me };
