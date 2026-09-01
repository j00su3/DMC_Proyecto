import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';

export async function generateOpenApiSpec(outputPath: string): Promise<void> {
  // S05: resolveCookieSecret now throws without an explicit COOKIE_SECRET
  // (or ALLOW_INSECURE_COOKIES=true) rather than silently falling back to
  // the dev secret. This script never sets or reads a cookie — it only
  // needs @fastify/cookie to register — so it supplies its own fixed,
  // non-sensitive value instead of depending on either env var being set in
  // whichever shell happens to run `pnpm contract`.
  const app = await buildApp({
    cookieSecret: 'openapi-generation-only-never-used-for-a-real-cookie!!',
  });

  await app.ready();
  const spec = app.swagger();

  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf-8');

  await app.close();
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const outputPath = fileURLToPath(
    new URL('../../openapi.json', import.meta.url),
  );
  await generateOpenApiSpec(outputPath);
}
