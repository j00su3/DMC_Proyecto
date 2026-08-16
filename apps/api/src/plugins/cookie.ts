import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export default fp(async function cookiePlugin(app: FastifyInstance) {
  await app.register(cookie, {
    hook: 'onRequest',
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
    },
  });
});
