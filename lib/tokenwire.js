function putVint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function getVint(buf, offset) {
  let acc = 0;
  let shift = 0;
  let i = offset;
  while (true) {
    const byte = buf[i++];
    acc |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [acc >>> 0, i];
}

export function packRenewRequest(refreshToken, steam64) {
  const parts = [];

  const rt = Buffer.from(String(refreshToken), 'utf8');
  parts.push(Buffer.from([0x0a]));
  parts.push(putVint(rt.length));
  parts.push(rt);

  parts.push(Buffer.from([0x11]));
  const sid = Buffer.alloc(8);
  sid.writeBigUInt64LE(BigInt(steam64));
  parts.push(sid);

  return Buffer.concat(parts);
}

export function readAccessToken(buf) {
  let i = 0;
  while (i < buf.length) {
    const key = buf[i++];
    const field = key >> 3;
    const wt = key & 0x07;

    if (field === 1 && wt === 2) {
      const [len, ni] = getVint(buf, i);
      i = ni;
      return buf.subarray(i, i + len).toString('utf8');
    }

    if (wt === 0) {
      [, i] = getVint(buf, i);
    } else if (wt === 2) {
      const [len, ni] = getVint(buf, i);
      i = ni + len;
    } else if (wt === 1) {
      i += 8;
    } else if (wt === 5) {
      i += 4;
    } else {
      break;
    }
  }
  return null;
}
