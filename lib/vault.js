function field(obj, ...aliases) {
  if (!obj || typeof obj !== 'object') return undefined;
  const norm = new Map(
    Object.keys(obj).map((k) => [k.toLowerCase().replace(/[_\s]/g, ''), k])
  );
  for (const alias of aliases) {
    const k = norm.get(alias.toLowerCase().replace(/[_\s]/g, ''));
    if (k !== undefined && obj[k] !== null && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

function pluckJwt(value) {
  if (!value) return undefined;
  if (typeof value === 'object') value = field(value, 'token', 'signedtoken', 'value') ?? '';
  value = String(value);
  const decoded = value.replace(/%7C%7C/gi, '||');
  const parts = decoded.split('||');
  const candidate = parts.length > 1 ? parts[parts.length - 1] : decoded;
  return candidate.split('.').length === 3 ? candidate : undefined;
}

export function jwtPayload(jwt) {
  try {
    const body = jwt.split('.')[1];
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function isJwtStale(jwt) {
  const p = jwtPayload(jwt);
  if (!p || !p.exp) return false;
  return p.exp * 1000 < Date.now();
}

function ownerFromJwt(jwt) {
  const p = jwtPayload(jwt);
  return p && p.sub ? String(p.sub) : undefined;
}

export function readVault(input, sourceName = 'unknown') {
  let j;
  try {
    if (typeof input === 'string') {
      const clean = input.replace(/^﻿/, '').trim();
      j = JSON.parse(clean);
    } else {
      j = input;
    }
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }

  const secret = field(j, 'sharedsecret', 'shared_secret', 'shared');
  const identity = field(j, 'identitysecret', 'identity_secret', 'identity');
  const deviceId = field(j, 'deviceid', 'device_id', 'device');

  if (!secret) return { ok: false, error: 'Missing shared_secret' };
  if (!identity) return { ok: false, error: 'Missing identity_secret' };

  const accountName = field(j, 'accountname', 'account_name') ?? '';
  const password = field(j, 'password', 'pass', 'pwd', 'account_password', 'accountpassword') ?? '';
  const revocationCode = field(j, 'revocationcode', 'revocation_code', 'rcode', 'r_code') ?? '';

  const sess = field(j, 'sessiondata', 'session_data', 'session') ?? j;

  const refreshRaw = field(sess, 'refreshtoken', 'refresh_token', 'refresh', 'oauthtoken');
  const accessRaw = field(sess, 'accesstoken', 'access_token', 'access', 'steamloginsecure');
  const refreshToken = pluckJwt(refreshRaw);
  const accessToken = pluckJwt(accessRaw);

  const sessionId = field(sess, 'sessionid', 'session_id', 'session') ?? '';

  let steam64 = field(sess, 'steamid', 'steam_id', 'id') ?? field(j, 'steamid', 'steam_id', 'id');
  if (steam64 && typeof steam64 === 'object') steam64 = field(steam64, 'steam64', 'id');
  steam64 = steam64 ? String(steam64) : undefined;
  if (!steam64 && refreshToken) steam64 = ownerFromJwt(refreshToken);
  if (!steam64 && accessToken) steam64 = ownerFromJwt(accessToken);

  const profile = {
    fileName: sourceName,
    accountName: accountName || (steam64 ? `id${steam64}` : sourceName),
    password: password ? String(password) : null,
    steam64: steam64 || null,
    sharedSecret: String(secret),
    identitySecret: String(identity),
    deviceId: deviceId ? String(deviceId) : null,
    revocationCode: revocationCode || null,
    session: {
      sessionId: sessionId ? String(sessionId) : null,
      refreshToken: refreshToken || null,
      accessToken: accessToken || null,
    },
    hasSession: Boolean(steam64 && (refreshToken || accessToken)),
  };

  return { ok: true, account: profile };
}
