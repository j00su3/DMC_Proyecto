import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';

export async function generateOpenApiSpec(outputPath: string): Promise<void> {
  const app = await buildApp();

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
