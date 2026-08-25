import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateOpenApiSpec } from './openapi.js';

describe('generateOpenApiSpec', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'openapi-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a valid OpenAPI document to disk without starting a listener', async () => {
    const outputPath = join(dir, 'openapi.json');

    await generateOpenApiSpec(outputPath);

    const contents = await readFile(outputPath, 'utf-8');
    const spec = JSON.parse(contents);

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths).toHaveProperty('/api/health');
  });
});
