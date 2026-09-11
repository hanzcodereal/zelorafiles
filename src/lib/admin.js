// Minimal, dependency-free admin auth: credentials live in admin.json at
// the project root (see README "Admin Panel"), and the session is a signed
// cookie — no server-side session store needed.
//
// The signing secret is derived from the credentials themselves
// (username + password), which has a useful side effect: changing the
// password in admin.json instantly invalidates every existing session.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'zf_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Re-reading the file on every request is cheap and means an updated
// admin.json takes effect immediately, with no redeploy — but we still
// cache for a couple of seconds so a login page under heavy refresh
// doesn't hit the filesystem constantly.
let cached = null;
let cachedAt = 0;
const CACHE_MS = 2000;

async function readCredentials() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;

  const filePath = join(process.cwd(), 'admin.json');
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed.username !== 'string' || typeof parsed.password !== 'string' || !parsed.username || !parsed.password) {
    throw new Error('admin.json must contain non-empty "username" and "password" fields.');
  }

  cached = parsed;
  cachedAt = now;
  return parsed;
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeStringEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    // Still do a same-length comparison so a length mismatch doesn't return
    // measurably faster than a same-length mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function verifyLogin(username, password) {
  const creds = await readCredentials();
  return safeStringEqual(username, creds.username) && safeStringEqual(password, creds.password);
}

export async function createSessionToken() {
  const creds = await readCredentials();
  const secret = `${creds.username}:${creds.password}`;
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS });
  const encodedPayload = Buffer.from(payload, 'utf-8').toString('base64url');
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;

  let creds;
  try {
    creds = await readCredentials();
  } catch {
    return false;
  }

  const secret = `${creds.username}:${creds.password}`;
  const expected = sign(encodedPayload, secret);

  if (!safeStringEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
    return typeof payload.exp === 'number' && Date.now() < payload.exp;
  } catch {
    return false;
  }
}
