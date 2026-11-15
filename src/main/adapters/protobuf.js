// Minimal protobuf wire-format reader/writer: just enough to find and replace
// a string at a known field path without a schema. Non-length-delimited
// fields keep their raw bytes so re-encoding is byte-identical.
//
// Field = { field: number, wire: 0|1|2|5, bytes: Uint8Array }
//   wire 2: bytes = payload (without length prefix)
//   others: bytes = raw value bytes as they appeared

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error("protobuf: truncated varint");
    const b = buf[pos++];
    if (shift < 49) result += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if ((b & 0x80) === 0) return [result, pos];
    if (shift > 70) throw new Error("protobuf: varint too long");
  }
}

function writeVarint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

export function decodeMessage(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    let start = pos;
    let end;
    if (wire === 0) {
      [, end] = readVarint(buf, pos);
    } else if (wire === 1) {
      end = pos + 8;
    } else if (wire === 5) {
      end = pos + 4;
    } else if (wire === 2) {
      let len;
      [len, start] = readVarint(buf, pos);
      end = start + len;
    } else {
      throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
    if (end > buf.length) throw new Error("protobuf: truncated field");
    fields.push({ field, wire, bytes: buf.subarray(start, end) });
    pos = end;
  }
  return fields;
}

export function encodeMessage(fields) {
  const parts = [];
  for (const { field, wire, bytes } of fields) {
    parts.push(...writeVarint(field * 8 + wire));
    if (wire === 2) parts.push(...writeVarint(bytes.length));
    for (const b of bytes) parts.push(b);
  }
  return Uint8Array.from(parts);
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

// First length-delimited field matching each step of `path`; undefined if
// absent or not valid UTF-8 / not a parseable message along the way.
export function getString(buf, path) {
  try {
    let cur = buf;
    for (const step of path) {
      const f = decodeMessage(cur).find((x) => x.field === step && x.wire === 2);
      if (!f) return undefined;
      cur = f.bytes;
    }
    return utf8Decoder.decode(cur);
  } catch {
    return undefined;
  }
}

// Returns new bytes with the string at `path` replaced and every enclosing
// length prefix rewritten. Assumes getString(buf, path) !== undefined.
export function setString(buf, path, value) {
  const [step, ...rest] = path;
  const fields = decodeMessage(buf);
  const i = fields.findIndex((x) => x.field === step && x.wire === 2);
  if (i < 0) throw new Error(`protobuf: field ${step} not found`);
  const bytes = rest.length === 0 ? utf8Encoder.encode(value) : setString(fields[i].bytes, rest, value);
  fields[i] = { ...fields[i], bytes };
  return encodeMessage(fields);
}
