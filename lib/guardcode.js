import crypto from 'node:crypto';

const DIGITS = '23456789BCDFGHJKMNPQRTVWXY';

export function buildCode(seed, unixSeconds) {
  const key = Buffer.from(stripEscapes(seed), 'base64');

  let t = Math.floor(unixSeconds / 30);
  const frame = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    frame[i] = t & 0xff;
    t = Math.floor(t / 256);
  }

  const mac = crypto.createHmac('sha1', key).update(frame).digest();
  const off = mac[19] & 0xf;
  let point =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);

  let code = '';
  for (let i = 0; i < 5; i++) {
    code += DIGITS[point % DIGITS.length];
    point = Math.floor(point / DIGITS.length);
  }
  return code;
}

function stripEscapes(s) {
  return String(s).replace(/\\(.)/g, '$1');
}

export function windowLeft(unixSeconds) {
  return 30 - (Math.floor(unixSeconds) % 30);
}
