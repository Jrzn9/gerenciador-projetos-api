const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const [scheme, token] = authHeader ? authHeader.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  try {
    // Fixar o algoritmo impede tokens forjados com outro algoritmo (ex.: "none")
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    if (typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    req.userId = payload.sub;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = authMiddleware;
