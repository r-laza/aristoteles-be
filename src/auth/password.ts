import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [scheme, salt, encoded] = hash.split('$');
  if (scheme !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
