import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVault } from './vault.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.COXER_VAULT_DIR || path.join(here, '..', 'maFiles');

const profiles = new Map();

function keyOf(profile) {
  return profile.steam64 || profile.fileName;
}

const TRASH_DIR = path.join(VAULT_DIR, '.trash');

function safe(name) {
  return String(name).replace(/[^\w.-]/g, '_') || 'account';
}

function ensureDir() {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function freeName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (fs.existsSync(path.join(dir, `${stem}-${i}${ext}`))) i++;
  return `${stem}-${i}${ext}`;
}

function writeAtomic(dir, name, content) {
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, path.join(dir, name));
}

export function loadVaults() {
  ensureDir();
  const files = fs
    .readdirSync(VAULT_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((f) => f.endsWith('.maFile') || f.endsWith('.mafile') || f.endsWith('.json'));
  let count = 0;
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(VAULT_DIR, file), 'utf8');
      const res = readVault(content, file);
      if (res.ok) {
        res.account.savedFile = file;
        profiles.set(keyOf(res.account), res.account);
        count++;
      }
    } catch (e) {
      console.error(`vault: не удалось прочитать ${file}: ${e.message}`);
    }
  }
  return count;
}

export function saveVault(content, sourceName, saveAs) {
  const res = readVault(content, sourceName);
  if (!res.ok) return res;
  const profile = res.account;

  const key = keyOf(profile);
  const existing = profiles.get(key);
  const base = safe(saveAs || profile.accountName || profile.steam64 || 'account');

  try {
    ensureDir();
    const onDisk = existing?.savedFile || freeName(VAULT_DIR, `${base}.maFile`);
    profile.savedFile = onDisk;
    writeAtomic(VAULT_DIR, onDisk, content);
  } catch (e) {
    profile.savedFile = profile.savedFile || `${base}.maFile`;
    console.error(`vault: не удалось сохранить ${profile.savedFile}: ${e.message}`);
  }

  profiles.set(key, profile);
  return { ok: true, account: profile };
}

export function allAccounts() {
  return [...profiles.values()];
}

export function findAccount(key) {
  return profiles.get(key);
}

export function dropAccount(key) {
  const profile = profiles.get(key);
  if (!profile) return false;
  profiles.delete(key);
  try {
    const file = profile.savedFile || `${safe(profile.steam64 || profile.accountName)}.maFile`;
    const src = path.join(VAULT_DIR, file);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
      fs.renameSync(src, path.join(TRASH_DIR, freeName(TRASH_DIR, file)));
    }
  } catch (e) {
    console.error(`vault: не удалось переместить файл аккаунта в корзину: ${e.message}`);
  }
  return true;
}

export function readSavedFile(key) {
  const profile = profiles.get(key);
  if (!profile || !profile.savedFile) return null;
  const p = path.join(VAULT_DIR, profile.savedFile);
  if (!fs.existsSync(p)) return null;
  return { name: profile.savedFile, content: fs.readFileSync(p, 'utf8') };
}

export function credentials(key) {
  const profile = profiles.get(key);
  if (!profile) return null;
  return { login: profile.accountName || '', password: profile.password || '' };
}

export function toPublic(profile) {
  return {
    id: profile.steam64 || profile.fileName,
    accountName: profile.accountName,
    steam64: profile.steam64,
    hasSession: profile.hasSession,
    hasDeviceId: Boolean(profile.deviceId),
    hasRevocationCode: Boolean(profile.revocationCode),
    hasPassword: Boolean(profile.password),
    proxy: profile.proxy || null,
  };
}
