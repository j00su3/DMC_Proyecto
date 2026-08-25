import argon2 from 'argon2';

// OWASP baseline argon2id parameters (design.md D-series "Key Config Shapes").
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export function verifyPassword(
  hash: string,
  plaintext: string,
): Promise<boolean> {
  return argon2.verify(hash, plaintext);
}

// Fixed dummy hash verified on unknown-email login attempts so the timing
// profile matches a wrong-password attempt (D11) — no user enumeration.
// Generated ahead of time with the same ARGON2_OPTIONS; argon2.verify reads
// its params from the encoded hash, so this stays valid independently of the
// current defaults above.
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Eu9NlYX66nbfgFUltNwnpQ$AoThybUU+nUc3Rgns5knEB4zpwfhA6Tf764VKugthaI';
