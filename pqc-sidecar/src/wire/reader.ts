export class WireParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireParseError";
  }
}

/** Bounds-checked big-endian reader. Every read that would run past the end throws, so a
 *  truncated or hostile message can never produce a wrong value or an out-of-range access. */
export class ByteReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private need(n: number): void {
    if (n < 0 || this.remaining < n) throw new WireParseError(`truncated: need ${n} bytes, have ${this.remaining}`);
  }

  u8(): number {
    this.need(1);
    return this.buf[this.offset++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  u24(): number {
    this.need(3);
    const v = this.buf.readUIntBE(this.offset, 3);
    this.offset += 3;
    return v;
  }

  bytes(n: number): Buffer {
    this.need(n);
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

export function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
}

export function u24(value: number): Buffer {
  const b = Buffer.alloc(3);
  b.writeUIntBE(value, 0, 3);
  return b;
}
