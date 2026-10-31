// Reader for Java object serialization streams (ObjectOutputStream), enough to show Flowable process variables that were
// stored as Groovy/Java maps and lists. It does not run any Java: classes it knows (collections, boxed numbers, BigDecimal,
// Date, strings, arrays) become plain JSON values; any other class becomes { "@class": name, ...fields }.
//
// Stream layout, per the Java Object Serialization Specification: after the magic and version, content is a tagged
// sequence. An object is its class description, then for every class from the topmost superclass down: its field values
// (if the class is Serializable) and, when it has a writeObject method, an "annotation" of block data and objects that
// ends with TC_ENDBLOCKDATA. Collections keep their elements in that annotation.

const TC = {
  NULL: 0x70, REFERENCE: 0x71, CLASSDESC: 0x72, OBJECT: 0x73, STRING: 0x74, ARRAY: 0x75, CLASS: 0x76, BLOCKDATA: 0x77,
  ENDBLOCKDATA: 0x78, RESET: 0x79, BLOCKDATALONG: 0x7a, EXCEPTION: 0x7b, LONGSTRING: 0x7c, PROXYCLASSDESC: 0x7d, ENUM: 0x7e,
};
const SC_WRITE_METHOD = 0x01;
const SC_SERIALIZABLE = 0x02;
const SC_EXTERNALIZABLE = 0x04;
const SC_BLOCK_DATA = 0x08;
const BASE_HANDLE = 0x7e0000;
const MAX_NODES = 20000;

export class JavaSerializationError extends Error {}

class Block {
  constructor(bytes) {
    this.bytes = bytes;
  }
}

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
    this.handles = [];
    this.nodes = 0;
  }

  need(n) {
    if (this.p + n > this.b.length) throw new JavaSerializationError('unexpected end of stream');
  }
  u8() { this.need(1); return this.b[this.p++]; }
  i16() { this.need(2); const v = this.view.getInt16(this.p); this.p += 2; return v; }
  u16() { this.need(2); const v = this.view.getUint16(this.p); this.p += 2; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.p); this.p += 4; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.p); this.p += 8; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.p); this.p += 8; return v; }
  bytes(n) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  utf(len) { return new TextDecoder('utf-8').decode(this.bytes(len)); }
  newHandle(v) { this.handles.push(v); return this.handles.length - 1; }
  peek() { this.need(1); return this.b[this.p]; }

  header() {
    if (this.u16() !== 0xaced) throw new JavaSerializationError('not a Java serialization stream');
    this.u16(); // version
  }

  // One element of the stream: a value, or (inside an annotation) a Block of raw data.
  content() {
    if (++this.nodes > MAX_NODES) throw new JavaSerializationError('value is too large to decode');
    const tag = this.u8();
    switch (tag) {
      case TC.NULL: return null;
      case TC.REFERENCE: {
        const h = this.i32() - BASE_HANDLE;
        if (!(h in this.handles)) throw new JavaSerializationError('bad back reference');
        return this.handles[h];
      }
      case TC.STRING: { const s = this.utf(this.u16()); this.newHandle(s); return s; }
      case TC.LONGSTRING: { const len = Number(this.i64()); const s = this.utf(len); this.newHandle(s); return s; }
      case TC.OBJECT: return this.object();
      case TC.ARRAY: return this.array();
      case TC.ENUM: {
        const desc = this.classDesc();
        const holder = { '@enum': true };
        this.newHandle(holder);
        const name = this.content();
        return { '@class': desc?.name, name };
      }
      case TC.CLASS: { const desc = this.classDesc(); this.newHandle(desc); return { '@class': 'java.lang.Class', name: desc?.name }; }
      case TC.CLASSDESC: case TC.PROXYCLASSDESC: this.p--; return this.classDesc();
      case TC.BLOCKDATA: return new Block(this.bytes(this.u8()));
      case TC.BLOCKDATALONG: return new Block(this.bytes(this.i32()));
      case TC.RESET: this.handles = []; return this.content();
      case TC.EXCEPTION: throw new JavaSerializationError('stream holds a thrown exception');
      default: throw new JavaSerializationError(`unknown tag 0x${tag.toString(16)} at ${this.p - 1}`);
    }
  }

  classDesc() {
    const tag = this.u8();
    if (tag === TC.NULL) return null;
    if (tag === TC.REFERENCE) return this.handles[this.i32() - BASE_HANDLE];
    if (tag === TC.PROXYCLASSDESC) {
      const desc = { name: '$Proxy', flags: SC_SERIALIZABLE, fields: [], superclass: null };
      this.newHandle(desc);
      const n = this.i32();
      for (let i = 0; i < n; i++) this.utf(this.u16());
      this.annotation();
      desc.superclass = this.classDesc();
      return desc;
    }
    if (tag !== TC.CLASSDESC) throw new JavaSerializationError(`expected a class description, got 0x${tag.toString(16)}`);
    const desc = { name: this.utf(this.u16()), flags: 0, fields: [], superclass: null };
    this.i64(); // serialVersionUID
    this.newHandle(desc);
    desc.flags = this.u8();
    const count = this.u16();
    for (let i = 0; i < count; i++) {
      const type = String.fromCharCode(this.u8());
      const name = this.utf(this.u16());
      if (type === 'L' || type === '[') this.content(); // the field's class name, a string
      desc.fields.push({ type, name });
    }
    this.annotation();
    desc.superclass = this.classDesc();
    return desc;
  }

  // Contents up to TC_ENDBLOCKDATA
  annotation() {
    const out = [];
    while (this.peek() !== TC.ENDBLOCKDATA) out.push(this.content());
    this.p++;
    return out;
  }

  fieldValue(type) {
    switch (type) {
      case 'B': return this.b[this.p++] << 24 >> 24;
      case 'C': return String.fromCharCode(this.u16());
      case 'D': return this.f64();
      case 'F': return this.f32();
      case 'I': return this.i32();
      case 'J': return this.i64();
      case 'S': return this.i16();
      case 'Z': return this.u8() !== 0;
      default: return this.content();
    }
  }

  object() {
    const desc = this.classDesc();
    const obj = { '@class': desc?.name, fields: {}, annotations: [] };
    this.newHandle(obj);
    const chain = [];
    for (let d = desc; d; d = d.superclass) chain.unshift(d);
    for (const d of chain) {
      if (d.flags & SC_EXTERNALIZABLE) {
        if (d.flags & SC_BLOCK_DATA) obj.annotations.push(...this.annotation());
        else throw new JavaSerializationError('old-style externalizable object');
        continue;
      }
      if (d.flags & SC_SERIALIZABLE) for (const f of d.fields) obj.fields[f.name] = this.fieldValue(f.type);
      if (d.flags & SC_WRITE_METHOD) obj.annotations.push(...this.annotation());
    }
    return obj;
  }

  array() {
    const desc = this.classDesc();
    const arr = { '@array': true, items: [], type: desc?.name ?? '[' };
    this.newHandle(arr);
    const n = this.i32();
    const kind = arr.type[1] ?? 'L';
    for (let i = 0; i < n; i++) arr.items.push(this.fieldValue(kind === '[' ? 'L' : kind));
    return arr;
  }
}

// ---- raw tree -> plain JSON value -------------------------------------------------------------------------------------

const asNumber = (big) => (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString());
const inherits = (name, ...names) => names.includes(name);

function bigIntegerOf(obj) {
  const mag = obj?.fields?.magnitude?.items;
  if (!mag) return 0n;
  let v = 0n;
  for (const byte of mag) v = (v << 8n) | BigInt(byte & 0xff);
  return (obj.fields.signum ?? 0) < 0 ? -v : v;
}

function decimalOf(obj) {
  const compact = obj.fields.intCompact;
  const scale = obj.fields.scale ?? 0;
  const unscaled = typeof compact === 'bigint' && compact !== -(2n ** 63n) ? compact : bigIntegerOf(obj.fields.intVal);
  let digits = (unscaled < 0n ? -unscaled : unscaled).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
  } else if (scale < 0) {
    digits += '0'.repeat(-scale);
  }
  return Number(`${unscaled < 0n ? '-' : ''}${digits}`);
}

function plain(v, seen = new Set()) {
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? asNumber(v) : v;
  if (v instanceof Block) return undefined;
  if (v['@array']) {
    if (v.type === '[B') return `[${v.items.length} bytes]`;
    return v.items.map((x) => plain(x, seen));
  }
  if (!('fields' in v)) return v; // enum, class reference
  if (seen.has(v)) return '(circular reference)';
  seen.add(v);
  try {
    const name = v['@class'];
    const objects = v.annotations.filter((a) => !(a instanceof Block));
    if (inherits(name, 'java.lang.Integer', 'java.lang.Long', 'java.lang.Short', 'java.lang.Byte', 'java.lang.Double', 'java.lang.Float', 'java.lang.Boolean', 'java.lang.Character')) return plain(v.fields.value, seen);
    if (name === 'java.math.BigDecimal') return decimalOf(v);
    if (name === 'java.math.BigInteger') return asNumber(bigIntegerOf(v));
    if (inherits(name, 'java.util.Date', 'java.sql.Timestamp', 'java.sql.Date')) {
      const block = v.annotations.find((a) => a instanceof Block);
      if (block && block.bytes.length >= 8) return new Date(Number(new DataView(block.bytes.buffer, block.bytes.byteOffset, 8).getBigInt64(0))).toISOString();
    }
    if (/(^|\.)(HashMap|LinkedHashMap|TreeMap|Hashtable|ConcurrentHashMap|IdentityHashMap|WeakHashMap)$/.test(name) || /Map$/.test(name || '')) {
      const out = {};
      for (let i = 0; i + 1 < objects.length; i += 2) {
        const k = plain(objects[i], seen);
        out[typeof k === 'object' && k !== null ? JSON.stringify(k) : String(k)] = plain(objects[i + 1], seen);
      }
      return out;
    }
    if (/(List|Set|Queue|Deque|Vector|Stack|Collection)$/.test(name || '')) return objects.map((x) => plain(x, seen));
    if (name === 'java.util.UUID') return `${v.fields.mostSigBits}:${v.fields.leastSigBits}`;
    const out = { '@class': name };
    for (const [k, x] of Object.entries(v.fields)) out[k] = plain(x, seen);
    if (objects.length) out['@contents'] = objects.map((x) => plain(x, seen));
    return out;
  } finally {
    seen.delete(v);
  }
}

// bytes: Uint8Array holding a serialized stream. Returns the value as plain JSON, or throws JavaSerializationError.
export function decodeJavaSerialized(bytes) {
  const r = new Reader(bytes);
  r.header();
  return plain(r.content());
}
