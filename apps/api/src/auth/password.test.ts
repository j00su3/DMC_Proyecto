import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword / verifyPassword', () => {
  it('hashes a password and verifies the same plaintext against it', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(
      verifyPassword(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
  });

  it('rejects verification when the password does not match the hash', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('never stores the plaintext password inside the produced hash', async () => {
    const plaintext = 'super-secret-value-123';
    const hash = await hashPassword(plaintext);

    expect(hash).not.toContain(plaintext);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });
});
