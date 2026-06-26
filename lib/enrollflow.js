import crypto from 'node:crypto';
import { signInMobile } from './signin.js';
import { enrollDevice } from './enroll.js';
import * as registry from './registry.js';

const flows = new Map();
const TTL_MS = 20 * 60 * 1000;

function makePrompts(flow) {
  const ask = (type, extra = {}) =>
    new Promise((resolve, reject) => {
      flow.status = 'awaiting';
      flow.pending = { type, ...extra };
      flow.notice = null;
      flow._resolve = resolve;
      flow._reject = reject;
    });
  return {
    emailCode: () => ask('emailCode'),
    phoneNumber: () => (flow.skipPhone ? Promise.resolve('') : ask('phoneNumber')),
    confirmEmailLink: () => ask('confirmEmailLink'),
    smsCode: (hint) => ask('smsCode', { hint: hint || null }),
    emailAuthCode: () => ask('emailAuthCode'),
    notify: (msg) => { flow.notice = msg; },
  };
}

export function beginEnroll({ username, password, proxy, skipPhone }) {
  const id = crypto.randomBytes(9).toString('hex');
  const flow = {
    id, status: 'running', pending: null, notice: null,
    error: null, result: null, createdAt: Date.now(),
    skipPhone: Boolean(skipPhone),
    _resolve: null, _reject: null,
  };
  flows.set(id, flow);

  const prompts = makePrompts(flow);
  (async () => {
    try {
      const login = await signInMobile(username, password, proxy || null, prompts);
      const enrolled = await enrollDevice(login, proxy || null, prompts);

      if (!enrolled.mafile.account_name) enrolled.mafile.account_name = username;
      enrolled.mafile.password = password;

      const content = JSON.stringify(enrolled.mafile, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
      const saved = registry.saveVault(content, `${enrolled.accountName}.maFile`, enrolled.accountName);

      flow.status = 'done';
      flow.pending = null;
      flow.result = {
        steam64: enrolled.steam64,
        accountName: enrolled.accountName,
        login: enrolled.accountName,
        password,
        revocationCode: enrolled.revocationCode,
        account: saved.ok ? registry.toPublic(saved.account) : null,
      };
    } catch (e) {
      flow.status = 'error';
      flow.pending = null;
      flow.error = e.message || String(e);
    }
  })();

  return flow;
}

export function feedInput(id, value) {
  const flow = flows.get(id);
  if (!flow) return { ok: false, error: 'Сессия не найдена' };
  if (flow.status !== 'awaiting' || !flow._resolve) {
    return { ok: false, error: 'Сессия сейчас не ожидает ввода' };
  }
  const resolve = flow._resolve;
  flow._resolve = null;
  flow._reject = null;
  flow.status = 'running';
  flow.pending = null;
  resolve(value);
  return { ok: true };
}

export function dropEnroll(id) {
  const flow = flows.get(id);
  if (!flow) return false;
  if (flow._reject) {
    const reject = flow._reject;
    flow._reject = null;
    flow._resolve = null;
    reject(new Error('Отменено пользователем'));
  }
  flow.status = 'error';
  flow.error = flow.error || 'Отменено';
  flows.delete(id);
  return true;
}

export function snapshot(id) {
  const f = flows.get(id);
  if (!f) return null;
  return {
    id: f.id,
    status: f.status,
    pending: f.pending,
    notice: f.notice,
    error: f.error,
    result: f.result,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, f] of flows) {
    if (now - f.createdAt > TTL_MS) flows.delete(id);
  }
}, 60 * 1000).unref?.();
