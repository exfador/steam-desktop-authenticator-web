import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as registry from './lib/registry.js';
import * as enrollflow from './lib/enrollflow.js';
import { revokeGuard } from './lib/revoke.js';
import { unsealBlob, isSealedBlob, readManifest } from './lib/blobcrypt.js';
import { buildCode, windowLeft } from './lib/guardcode.js';
import { serverClock, clockSkew } from './lib/clock.js';
import { fetchActions, answerAction, answerMany } from './lib/actions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(here, 'public')));

const route = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(400).json({ error: e.message || String(e) })
  );

app.get('/api/accounts', route(async (_req, res) => {
  res.json({ accounts: registry.allAccounts().map(registry.toPublic) });
}));

app.post('/api/accounts/import', route(async (req, res) => {
  const files = req.body.files || [];
  const passphrase = req.body.password || '';

  let manifest = null;
  for (const f of files) {
    const m = readManifest(f.content);
    if (m) manifest = m;
  }

  const results = [];
  let needPassword = false;

  for (const f of files) {
    const name = f.name || 'import.maFile';
    if (readManifest(f.content)) continue;

    let content = f.content;
    if (isSealedBlob(content)) {
      if (!passphrase) {
        needPassword = true;
        results.push({ name, ok: false, error: 'encrypted', encrypted: true });
        continue;
      }
      const entry = manifest?.get(name) || manifest?.get(name.split(/[\\/]/).pop());
      if (!entry) {
        results.push({ name, ok: false, error: 'Зашифрованный mafile без manifest.json — добавьте manifest в тот же импорт.' });
        continue;
      }
      const clear = unsealBlob(passphrase, entry.salt, entry.iv, content);
      if (!clear) {
        results.push({ name, ok: false, error: 'Неверный пароль или повреждённые данные.' });
        continue;
      }
      content = clear;
    }

    const r = registry.saveVault(content, name);
    results.push(
      r.ok
        ? { name, ok: true, account: registry.toPublic(r.account) }
        : { name, ok: false, error: r.error }
    );
  }

  res.json({ results, needPassword });
}));

app.delete('/api/accounts/:id', route(async (req, res) => {
  res.json({ ok: registry.dropAccount(req.params.id) });
}));

app.get('/api/accounts/:id/file', route(async (req, res) => {
  const file = registry.readSavedFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'Файл аккаунта не найден' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.send(file.content);
}));

app.get('/api/accounts/:id/credentials', route(async (req, res) => {
  const creds = registry.credentials(req.params.id);
  if (!creds) return res.status(404).json({ error: 'Аккаунт не найден' });
  res.json(creds);
}));

app.patch('/api/accounts/:id', route(async (req, res) => {
  const profile = registry.findAccount(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Аккаунт не найден' });
  if ('proxy' in req.body) profile.proxy = req.body.proxy || null;
  res.json({ ok: true, account: registry.toPublic(profile) });
}));

app.get('/api/accounts/:id/code', route(async (req, res) => {
  const profile = registry.findAccount(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Аккаунт не найден' });
  const time = await serverClock();
  res.json({ code: buildCode(profile.sharedSecret, time), secondsRemaining: windowLeft(time), serverTime: time });
}));

app.get('/api/codes', route(async (_req, res) => {
  const time = await serverClock();
  res.json({
    secondsRemaining: windowLeft(time),
    serverTime: time,
    timeDifference: clockSkew(),
    codes: registry.allAccounts().map((a) => ({ id: a.steam64 || a.fileName, code: buildCode(a.sharedSecret, time) })),
  });
}));

app.post('/api/accounts/:id/revoke', route(async (req, res) => {
  const profile = registry.findAccount(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Аккаунт не найден' });
  const result = await revokeGuard(profile);
  if (result.success) registry.dropAccount(req.params.id);
  res.json(result);
}));

app.get('/api/accounts/:id/actions', route(async (req, res) => {
  const profile = registry.findAccount(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Аккаунт не найден' });
  res.json({ actions: await fetchActions(profile) });
}));

app.post('/api/accounts/:id/actions/resolve', route(async (req, res) => {
  const profile = registry.findAccount(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Аккаунт не найден' });
  const { items, allow } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Список действий пуст' });
  }
  const ok = items.length === 1
    ? await answerAction(profile, items[0], allow)
    : await answerMany(profile, items, allow);
  res.json({ ok });
}));

app.post('/api/enroll/start', route(async (req, res) => {
  const { username, password, proxy, skipPhone } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Укажите логин и пароль Steam' });
  const flow = enrollflow.beginEnroll({ username, password, proxy: proxy || null, skipPhone });
  res.json({ id: flow.id, state: enrollflow.snapshot(flow.id) });
}));

app.get('/api/enroll/:id', route(async (req, res) => {
  const state = enrollflow.snapshot(req.params.id);
  if (!state) return res.status(404).json({ error: 'Сессия не найдена' });
  res.json({ state });
}));

app.post('/api/enroll/:id/input', route(async (req, res) => {
  const r = enrollflow.feedInput(req.params.id, req.body.value);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, state: enrollflow.snapshot(req.params.id) });
}));

app.post('/api/enroll/:id/cancel', route(async (req, res) => {
  enrollflow.dropEnroll(req.params.id);
  res.json({ ok: true });
}));

const count = registry.loadVaults();
app.listen(PORT, HOST, () => {
  console.log(`\n  coxerhub — Steam Guard manager`);
  console.log(`  загружено профилей: ${count} (./maFiles)`);
  console.log(`  http://${HOST}:${PORT}\n`);
});
