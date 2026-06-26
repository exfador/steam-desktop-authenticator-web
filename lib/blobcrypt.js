import crypto from 'node:crypto';

const KDF_ROUNDS = 50000;
const KEY_BYTES = 32;

function stretchKey(passphrase, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  return crypto.pbkdf2Sync(passphrase, salt, KDF_ROUNDS, KEY_BYTES, 'sha1');
}

export function unsealBlob(passphrase, saltB64, ivB64, payloadB64) {
  if (!passphrase || !saltB64 || !ivB64 || !payloadB64) return null;
  try {
    const key = stretchKey(passphrase, saltB64);
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(payloadB64, 'base64');
    const dec = crypto.createDecipheriv('aes-256-cbc', key, iv);
    dec.setAutoPadding(true);
    return Buffer.concat([dec.update(data), dec.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sealBlob(passphrase, saltB64, ivB64, plaintext) {
  const key = stretchKey(passphrase, saltB64);
  const iv = Buffer.from(ivB64, 'base64');
  const enc = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([enc.update(plaintext, 'utf8'), enc.final()]).toString('base64');
}

export function isSealedBlob(content) {
  if (!content) return false;
  const t = content.trim();
  if (t.startsWith('{') || t.length < 64) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

export function readManifest(content) {
  try {
    const m = JSON.parse(content);
    if (!m || !m.encrypted || !Array.isArray(m.entries)) return null;
    const map = new Map();
    for (const e of m.entries) {
      const file = String(e.filename || '').split(/[\\/]/).pop();
      if (file) map.set(file, { salt: e.encryption_salt, iv: e.encryption_iv });
    }
    return map;
  } catch {
    return null;
  }
}
