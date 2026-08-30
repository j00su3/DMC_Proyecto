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

  // `argon2.verify` throws on a hash it cannot parse rather than returning
  // false, which surfaced as a 500 on login. SEC-001's reorder put this on
  // the path for locked accounts too, and a 500 for one specific email is
  // itself a signal an attacker can read. An unverifiable hash is a failed
  // verification.
  it('fails closed on an unparseable stored hash instead of throwing', async () => {
    await expect(
      verifyPassword('not-an-argon2-hash', 'any-password'),
    ).resolves.toBe(false);
    await expect(verifyPassword('', 'any-password')).resolves.toBe(false);
  });

  it('never stores the plaintext password inside the produced hash', async () => {
    const plaintext = 'super-secret-value-123';
    const hash = await hashPassword(plaintext);

    expect(hash).not.toContain(plaintext);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });
});
