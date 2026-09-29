const request = require('supertest');
const app = require('../../src/app');

/**
 * Convida por e-mail e a pessoa aceita pelo link: o jeito "oficial" de
 * alguém entrar num projeto. `owner` e `member` são os cabeçalhos de auth.
 */
async function inviteAndAccept({ owner, member, projectId, email, role }) {
  const invite = await request(app).post(`/projects/${projectId}/invitations`).set(owner).send({ email, role });
  return request(app).post('/invitations/link/accept').set(member).send({ token: invite.body.token });
}

module.exports = { inviteAndAccept };
