const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function safeCompare(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function ensureTokenSecret(config) {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }

  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    const existing = (await fs.readFile(config.secretPath, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(48).toString('base64url');
  await fs.writeFile(config.secretPath, `${secret}\n`, { mode: 0o600 });
  return secret;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${key.toString('base64url')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('scrypt$')) return false;

  const [, salt, encoded] = storedHash.split('$');
  if (!salt || !encoded) return false;

  const key = await scryptAsync(password, salt, 64);
  const candidate = key.toString('base64url');
  return safeCompare(candidate, encoded);
}

function signToken(user, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (!safeCompare(signature, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

module.exports = {
  ensureTokenSecret,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  publicUser,
};
