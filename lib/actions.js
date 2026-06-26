import crypto from 'node:crypto';
import { serverClock } from './clock.js';
import { packRenewRequest, readAccessToken } from './tokenwire.js';
import { isJwtStale } from './vault.js';
import { sendVia, pickProxy } from './netgate.js';

const COMMUNITY = 'https://steamcommunity.com';
const API = 'https://api.steampowered.com';
const CLIENT_UA = 'okhttp/3.12.12';

export function signAction(time, identitySecret, tag = 'conf') {
  const key = Buffer.from(identitySecret, 'base64');
  const tagBytes = Buffer.from(tag, 'utf8');
  const size = 8 + Math.min(tagBytes.length, 32);
  const block = Buffer.alloc(size);

  let t = time;
  for (let i = 7; i >= 0; i--) {
    block[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  tagBytes.copy(block, 8, 0, size - 8);

  return crypto.createHmac('sha1', key).update(block).digest('base64');
}

async function renewToken(refreshToken, steam64, proxy) {
  const body = packRenewRequest(refreshToken, steam64);
  const form = new URLSearchParams();
  form.set('input_protobuf_encoded', body.toString('base64'));

  const resp = await sendVia(
    `${API}/IAuthenticationService/GenerateAccessTokenForApp/v1`,
    {
      method: 'POST',
      headers: { 'User-Agent': CLIENT_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
    proxy
  );

  const result = resp.headers.get('x-eresult');
  const buf = Buffer.from(await resp.arrayBuffer());
  if (result && result !== '1') {
    throw new Error(`Не удалось обновить токен (result ${result}). Возможно, нужен повторный вход.`);
  }
  const token = readAccessToken(buf);
  if (!token) throw new Error('Обновление токена не вернуло access token');
  return token;
}

export async function liveToken(profile) {
  const { session, steam64 } = profile;
  if (session.accessToken && !isJwtStale(session.accessToken)) return session.accessToken;
  if (!session.refreshToken) {
    throw new Error('Сессия истекла и нет refresh-токена. Переимпортируйте mafile со свежей сессией.');
  }
  const fresh = await renewToken(session.refreshToken, steam64, pickProxy(profile.proxy));
  session.accessToken = fresh;
  return fresh;
}

function cookieLine(profile, token) {
  const { steam64, session } = profile;
  const loginSecure = `${steam64}%7C%7C${encodeURIComponent(token)}`;
  const parts = [
    'mobileClientVersion=777777 3.6.1',
    'mobileClient=android',
    `steamid=${steam64}`,
    'Steam_Language=english',
    `steamLoginSecure=${loginSecure}`,
  ];
  if (session.sessionId) parts.push(`sessionid=${session.sessionId}`);
  return parts.join('; ');
}

function headers(profile, token) {
  return {
    'User-Agent': CLIENT_UA,
    Accept: 'application/json, text/javascript, text/html, application/xml, text/xml, */*',
    'Accept-Language': 'en-US',
    Origin: COMMUNITY,
    Referer: COMMUNITY,
    Cookie: cookieLine(profile, token),
  };
}

function query(profile, time, tag) {
  return {
    p: profile.deviceId,
    a: profile.steam64,
    k: signAction(time, profile.identitySecret, tag),
    t: String(time),
    m: 'react',
    tag,
  };
}

export async function fetchActions(profile) {
  if (!profile.hasSession) throw new Error('В этом mafile нет сессии — подтверждения недоступны.');
  if (!profile.deviceId) throw new Error('Нет device_id — подтверждения недоступны.');

  const token = await liveToken(profile);
  const time = await serverClock();
  const qs = new URLSearchParams(query(profile, time, 'list'));

  const resp = await sendVia(`${COMMUNITY}/mobileconf/getlist?${qs}`, {
    headers: headers(profile, token),
    redirect: 'manual',
  }, pickProxy(profile.proxy));

  if (resp.status >= 300 && resp.status < 400) throw new Error('Сессия истекла (редирект на вход).');
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Неожиданный ответ Steam (не JSON). Сессия может быть недействительна.');
  }
  if (json.needauth) throw new Error('Сессия недействительна — нужен повторный вход.');
  if (!json.success) throw new Error(json.message || 'Не удалось загрузить подтверждения.');

  return (json.conf || []).map((c) => ({
    id: c.id,
    nonce: c.nonce,
    type: c.type,
    typeName: c.type_name,
    creatorId: c.creator_id,
    headline: c.headline,
    summary: Array.isArray(c.summary) ? c.summary : [],
    icon: c.icon || null,
    creationTime: c.creation_time,
    accept: c.accept,
    cancel: c.cancel,
  }));
}

export async function answerAction(profile, item, allow) {
  const token = await liveToken(profile);
  const op = allow ? 'allow' : 'cancel';
  const time = await serverClock();
  const qs = new URLSearchParams({ op, ...query(profile, time, op), cid: item.id, ck: item.nonce });

  const resp = await sendVia(`${COMMUNITY}/mobileconf/ajaxop?${qs}`, {
    headers: headers(profile, token),
  }, pickProxy(profile.proxy));
  const text = await resp.text();
  try {
    return Boolean(JSON.parse(text).success);
  } catch {
    throw new Error('Неожиданный ответ Steam.');
  }
}

export async function answerMany(profile, items, allow) {
  const token = await liveToken(profile);
  const op = allow ? 'allow' : 'cancel';
  const time = await serverClock();

  const form = new URLSearchParams();
  form.set('op', op);
  for (const [k, v] of Object.entries(query(profile, time, op))) form.set(k, v);
  for (const c of items) {
    form.append('cid[]', c.id);
    form.append('ck[]', c.nonce);
  }

  const resp = await sendVia(`${COMMUNITY}/mobileconf/multiajaxop`, {
    method: 'POST',
    headers: { ...headers(profile, token), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, pickProxy(profile.proxy));
  const text = await resp.text();
  try {
    return Boolean(JSON.parse(text).success);
  } catch {
    throw new Error('Неожиданный ответ Steam.');
  }
}
