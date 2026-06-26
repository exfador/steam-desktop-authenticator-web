const WT = { VARINT: 0, I64: 1, LEN: 2, I32: 5 };
const VARINT_KINDS = new Set(['int32', 'int64', 'uint32', 'uint64', 'enum', 'bool']);
const WIDE_KINDS = new Set(['int64', 'uint64', 'fixed64', 'sfixed64']);

class Builder {
  constructor() { this.chunks = []; }
  push(buf) { this.chunks.push(buf); }
  vint(value) {
    let v = BigInt(value);
    if (v < 0n) v += 1n << 64n;
    const bytes = [];
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) b |= 0x80;
      bytes.push(b);
    } while (v > 0n);
    this.push(Buffer.from(bytes));
  }
  key(id, wt) { this.vint((id << 3) | wt); }
  blob(id, buf) { this.key(id, WT.LEN); this.vint(buf.length); this.push(buf); }
  wide(id, value) {
    this.key(id, WT.I64);
    const b = Buffer.alloc(8);
    let v = BigInt(value);
    if (v < 0n) v += 1n << 64n;
    b.writeBigUInt64LE(v);
    this.push(b);
  }
  done() { return Buffer.concat(this.chunks); }
}

export function packMessage(shape, obj) {
  const out = new Builder();
  for (const [name, f] of Object.entries(shape)) {
    const val = obj[name];
    if (val === undefined || val === null) continue;
    const items = f.repeated ? val : [val];
    for (const item of items) {
      if (item === undefined || item === null) continue;
      if (f.type === 'string') out.blob(f.id, Buffer.from(item, 'utf8'));
      else if (f.type === 'bytes') out.blob(f.id, Buffer.from(item));
      else if (f.type === 'message') out.blob(f.id, packMessage(f.fields, item));
      else if (f.type === 'bool') { out.key(f.id, WT.VARINT); out.vint(item ? 1 : 0); }
      else if (f.type === 'fixed64' || f.type === 'sfixed64') out.wide(f.id, item);
      else if (VARINT_KINDS.has(f.type)) { out.key(f.id, WT.VARINT); out.vint(item); }
      else throw new Error(`wire: unknown field kind ${f.type}`);
    }
  }
  return out.done();
}

function takeVint(buf, offset) {
  let acc = 0n;
  let shift = 0n;
  let i = offset;
  while (true) {
    const byte = buf[i++];
    acc |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [acc, i];
}

export function unpackMessage(shape, buf) {
  const byId = {};
  for (const [name, f] of Object.entries(shape)) byId[f.id] = { name, f };

  const out = {};
  for (const [name, f] of Object.entries(shape)) if (f.repeated) out[name] = [];

  let i = 0;
  while (i < buf.length) {
    const [keyBig, ni] = takeVint(buf, i);
    i = ni;
    const key = Number(keyBig);
    const id = key >> 3;
    const wt = key & 0x07;
    const hit = byId[id];

    let value;
    if (wt === WT.VARINT) {
      const [v, n2] = takeVint(buf, i); i = n2;
      if (hit) {
        const t = hit.f.type;
        if (t === 'bool') value = v !== 0n;
        else if (WIDE_KINDS.has(t)) value = v;
        else value = Number(BigInt.asIntN(64, v));
        if (t === 'uint32') value = Number(v);
      }
    } else if (wt === WT.I64) {
      const v = buf.readBigUInt64LE(i); i += 8;
      if (hit) value = hit.f.type === 'sfixed64' ? BigInt.asIntN(64, v) : v;
    } else if (wt === WT.LEN) {
      const [lenBig, n2] = takeVint(buf, i); i = n2;
      const len = Number(lenBig);
      const slice = buf.subarray(i, i + len); i += len;
      if (hit) {
        const t = hit.f.type;
        if (t === 'string') value = slice.toString('utf8');
        else if (t === 'bytes') value = Buffer.from(slice);
        else if (t === 'message') value = unpackMessage(hit.f.fields, slice);
      }
    } else if (wt === WT.I32) {
      value = buf.readUInt32LE(i); i += 4;
    } else {
      throw new Error(`wire: bad wire type ${wt}`);
    }

    if (hit && value !== undefined) {
      if (hit.f.repeated) out[hit.name].push(value);
      else out[hit.name] = value;
    }
  }
  return out;
}
