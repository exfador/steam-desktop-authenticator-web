const QUERY_TIME = 'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001';

let synced = false;
let skew = 0;

function localSeconds() {
  return Math.floor(Date.now() / 1000);
}

export async function syncOffset() {
  const t0 = Date.now();
  const resp = await fetch(QUERY_TIME, { method: 'POST' });
  if (!resp.ok) throw new Error(`QueryTime failed: HTTP ${resp.status}`);
  const rtt = (Date.now() - t0) / 1000;
  const json = await resp.json();
  const remote = Number(json.response.server_time);
  const here = localSeconds() - rtt;
  skew = Math.round(remote - here);
  synced = true;
  return skew;
}

export async function serverClock() {
  if (!synced) {
    try {
      await syncOffset();
    } catch {
      synced = true;
      skew = 0;
    }
  }
  return localSeconds() + skew;
}

export function clockSkew() {
  return skew;
}

export function isSynced() {
  return synced;
}
