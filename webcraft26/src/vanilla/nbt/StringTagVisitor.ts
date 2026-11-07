// Port of net.minecraft.nbt.StringTagVisitor (SNBT serializer) plus a hand-written recursive
// descent parser equivalent to net.minecraft.nbt.TagParser / SnbtGrammar. Supports read + write.
//
// SNBT output matches vanilla: numeric suffixes (b/s/L/f/d), [B;]/[I;]/[L;] typed arrays,
// sorted compound keys, quoted keys only when needed, and StringTag.quoteAndEscape.
import { Tag, setSnbtSerializer } from './Tag.js';
import { ByteTag } from './ByteTag.js';
import { ShortTag } from './ShortTag.js';
import { IntTag } from './IntTag.js';
import { LongTag } from './LongTag.js';
import { FloatTag } from './FloatTag.js';
import { DoubleTag } from './DoubleTag.js';
import { ByteArrayTag } from './ByteArrayTag.js';
import { IntArrayTag } from './IntArrayTag.js';
import { LongArrayTag } from './LongArrayTag.js';
import { StringTag } from './StringTag.js';
import { ListTag } from './ListTag.js';
import { CompoundTag } from './CompoundTag.js';
import { EndTag } from './EndTag.js';

const UNQUOTED_KEY = /^[A-Za-z._]+[A-Za-z0-9._+-]*$/;

/** Vanilla StringTagVisitor: turns any tag into an SNBT string. */
export class StringTagVisitor {
  private readonly builder: string[] = [];

  build(): string { return this.builder.join(''); }

  /** Dispatches on the concrete tag type (visitor pattern without the TagVisitor interface). */
  visit(tag: Tag): void {
    if (tag instanceof EndTag) this.builder.push('END');
    else if (tag instanceof ByteTag) this.builder.push(`${tag.value}b`);
    else if (tag instanceof ShortTag) this.builder.push(`${tag.value}s`);
    else if (tag instanceof IntTag) this.builder.push(`${tag.value}`);
    else if (tag instanceof LongTag) this.builder.push(`${tag.value}L`);
    else if (tag instanceof FloatTag) this.builder.push(floatStr(tag.value) + 'f');
    else if (tag instanceof DoubleTag) this.builder.push(doubleStr(tag.value) + 'd');
    else if (tag instanceof ByteArrayTag) {
      this.builder.push('[B;');
      for (let i = 0; i < tag.value.length; i++) {
        if (i) this.builder.push(',');
        this.builder.push(`${(tag.value[i] << 24) >> 24}B`);
      }
      this.builder.push(']');
    } else if (tag instanceof IntArrayTag) {
      this.builder.push('[I;');
      this.builder.push(Array.from(tag.value).join(','));
      this.builder.push(']');
    } else if (tag instanceof LongArrayTag) {
      this.builder.push('[L;');
      this.builder.push(tag.value.map((v) => `${v}L`).join(','));
      this.builder.push(']');
    } else if (tag instanceof StringTag) {
      this.builder.push(StringTag.quoteAndEscape(tag.value));
    } else if (tag instanceof ListTag) {
      this.builder.push('[');
      for (let i = 0; i < tag.list.length; i++) {
        if (i) this.builder.push(',');
        this.visit(tag.list[i]);
      }
      this.builder.push(']');
    } else if (tag instanceof CompoundTag) {
      this.builder.push('{');
      const entries = [...tag.tags.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (let i = 0; i < entries.length; i++) {
        if (i) this.builder.push(',');
        const [k, v] = entries[i];
        this.key(k);
        this.builder.push(':');
        this.visit(v);
      }
      this.builder.push('}');
    } else {
      this.builder.push(tag.toString());
    }
  }

  private key(k: string): void {
    if (!/^(true|false)$/i.test(k) && UNQUOTED_KEY.test(k)) this.builder.push(k);
    else this.builder.push(StringTag.quoteAndEscape(k));
  }
}

function floatStr(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  let s = `${v}`;
  if (!s.includes('.') && !s.includes('e') && !s.includes('E')) s += '.0';
  return s;
}
function doubleStr(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  let s = `${v}`;
  if (!s.includes('.') && !s.includes('e') && !s.includes('E')) s += '.0';
  return s;
}

/** Serialises a tag to SNBT. */
export function serialize(tag: Tag): string {
  const v = new StringTagVisitor();
  v.visit(tag);
  return v.build();
}

// Install as Tag.toString() backend (called after all tag modules have loaded).
setSnbtSerializer(serialize);

// ---------------------------------------------------------------------------
// SNBT parser (TagParser equivalent)
// ---------------------------------------------------------------------------

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([bBsSlLfFdD])?$/;

export class SnbtParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Tag {
    this.ws();
    const tag = this.value();
    this.ws();
    if (this.i < this.s.length) throw new Error(`SNBT trailing data at ${this.i}: ${this.s.slice(this.i)}`);
    return tag;
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private peek(): string { return this.s[this.i] ?? ''; }
  private expect(c: string): void {
    if (this.peek() !== c) throw new Error(`SNBT expected '${c}' at ${this.i}, got '${this.peek()}'`);
    this.i++;
  }

  private value(): Tag {
    this.ws();
    const c = this.peek();
    if (c === '{') return this.compound();
    if (c === '[') return this.arrayOrList();
    if (c === '"' || c === "'") return StringTag.of(this.quoted());
    return this.scalar();
  }

  private quoted(): string {
    const quote = this.peek();
    this.i++;
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c === '\\') {
        const e = this.s[this.i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case '\\': out += '\\'; break;
          case '"': out += '"'; break;
          case "'": out += "'"; break;
          case 'u': out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16)); this.i += 4; break;
          default: out += e;
        }
      } else out += c;
    }
    throw new Error('SNBT unterminated string');
  }

  private compound(): CompoundTag {
    this.expect('{');
    const tag = new CompoundTag();
    this.ws();
    if (this.peek() === '}') { this.i++; return tag; }
    for (;;) {
      this.ws();
      const key = this.peek() === '"' || this.peek() === "'" ? this.quoted() : this.bare();
      this.ws();
      this.expect(':');
      tag.put(key, this.value());
      this.ws();
      const c = this.peek();
      if (c === ',') { this.i++; continue; }
      if (c === '}') { this.i++; break; }
      throw new Error(`SNBT expected ',' or '}' at ${this.i}`);
    }
    return tag;
  }

  private bare(): string {
    const start = this.i;
    while (this.i < this.s.length && !/[\s,\[\]\{\}:]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  private arrayOrList(): Tag {
    this.expect('[');
    const m = /^([BIL]);/i.exec(this.s.slice(this.i, this.i + 2));
    if (m) { this.i += 2; return this.typedArray(m[1].toUpperCase()); }
    const list = new ListTag();
    this.ws();
    if (this.peek() === ']') { this.i++; return list; }
    for (;;) {
      list.add(this.value());
      this.ws();
      const c = this.peek();
      if (c === ',') { this.i++; continue; }
      if (c === ']') { this.i++; break; }
      throw new Error(`SNBT expected ',' or ']' at ${this.i}`);
    }
    return list;
  }

  private typedArray(kind: string): Tag {
    const nums: number[] = [];
    const longs: bigint[] = [];
    this.ws();
    if (this.peek() === ']') { this.i++; return this.buildArray(kind, nums, longs); }
    for (;;) {
      this.ws();
      const token = this.bare();
      const stripped = token.replace(/[bBsSlLfFdD]$/, '');
      if (kind === 'L') longs.push(BigInt(stripped));
      else nums.push(Number(stripped));
      this.ws();
      const c = this.peek();
      if (c === ',') { this.i++; continue; }
      if (c === ']') { this.i++; break; }
      throw new Error(`SNBT expected ',' or ']' at ${this.i}`);
    }
    return this.buildArray(kind, nums, longs);
  }

  private buildArray(kind: string, nums: number[], longs: bigint[]): Tag {
    if (kind === 'B') return new ByteArrayTag(nums.map((v) => v & 0xff));
    if (kind === 'I') return new IntArrayTag(nums.map((v) => v | 0));
    return new LongArrayTag(longs);
  }

  private scalar(): Tag {
    const tok = this.bare();
    if (/^true$/i.test(tok)) return ByteTag.of(1);
    if (/^false$/i.test(tok)) return ByteTag.of(0);
    const m = NUMBER_RE.exec(tok);
    if (m) {
      const suffix = m[1]?.toLowerCase();
      const body = tok.slice(0, tok.length - (m[1] ? 1 : 0));
      switch (suffix) {
        case 'b': return ByteTag.of(parseInt(body, 10));
        case 's': return ShortTag.of(parseInt(body, 10));
        case 'l': return LongTag.of(BigInt(body));
        case 'f': return FloatTag.of(parseFloat(body));
        case 'd': return DoubleTag.of(parseFloat(body));
      }
      if (/[.eE]/.test(body)) return DoubleTag.of(parseFloat(body));
      return IntTag.of(parseInt(body, 10));
    }
    return StringTag.of(tok); // unquoted SNBT string
  }
}

/** Parses an SNBT string into a Tag. */
export function parse(snbt: string): Tag {
  return new SnbtParser(snbt).parse();
}

/** Parses SNBT and requires a CompoundTag root. */
export function parseCompound(snbt: string): CompoundTag {
  const t = parse(snbt);
  if (!(t instanceof CompoundTag)) throw new Error('SNBT root is not a compound tag');
  return t;
}
