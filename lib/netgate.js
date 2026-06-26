import { ProxyAgent } from 'undici';

const pool = new Map();

function gateFor(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!pool.has(proxyUrl)) pool.set(proxyUrl, new ProxyAgent(proxyUrl));
  return pool.get(proxyUrl);
}

export function pickProxy(profileProxy) {
  return profileProxy || process.env.COXER_PROXY || process.env.STEAM_PROXY || null;
}

export function sendVia(url, opts = {}, proxyUrl) {
  const dispatcher = gateFor(proxyUrl);
  return fetch(url, dispatcher ? { ...opts, dispatcher } : opts);
}
