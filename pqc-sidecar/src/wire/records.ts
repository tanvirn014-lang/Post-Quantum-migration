import { u16, u24 } from "./reader.js";

export const RECORD_HEADER_BYTES = 5;
const MAX_FRAGMENT = 16384 + 256;
const MAX_BUFFERED = 64 * 1024;

export const ContentType = { changeCipherSpec: 20, alert: 21, handshake: 22, applicationData: 23 } as const;
export const HandshakeType = { clientHello: 1, serverHello: 2 } as const;

export interface HandshakeMessage {
  type: number;
  /** Message body, without the 4-byte handshake header. */
  body: Buffer;
}

export interface TlsAlert {
  level: number;
  description: number;
}

/**
 * Reassembles plaintext TLS handshake messages from a raw byte stream, tolerating a message
 * split across records or chunks and several messages in one record. It only ever looks at the
 * unencrypted opening of a TLS 1.3 handshake (ClientHello / ServerHello): it stops at the first
 * encrypted (application_data) record, and never decrypts anything or holds key material.
 */
export class HandshakeAssembler {
  private raw: Buffer = Buffer.alloc(0);
  private handshakeFragment: Buffer = Buffer.alloc(0);
  private sawFirstRecord = false;

  /** Total bytes (headers included) of handshake records consumed so far. */
  handshakeRecordBytes = 0;
  notTls = false;
  stopped = false;
  alerts: TlsAlert[] = [];

  stop(): void {
    this.stopped = true;
    this.raw = Buffer.alloc(0);
    this.handshakeFragment = Buffer.alloc(0);
  }

  /** Feeds a chunk and returns the handshake messages that became complete. */
  push(chunk: Buffer): HandshakeMessage[] {
    if (this.stopped) return [];
    this.raw = this.raw.length === 0 ? chunk : Buffer.concat([this.raw, chunk]);
    if (this.raw.length > MAX_BUFFERED) {
      this.notTls = true;
      this.stop();
      return [];
    }

    const messages: HandshakeMessage[] = [];
    while (!this.stopped && this.raw.length >= RECORD_HEADER_BYTES) {
      const type = this.raw[0]!;
      const length = this.raw.readUInt16BE(3);
      // A conversation opens with a handshake record, or - from a server refusing it - a plaintext alert.
      if (!this.sawFirstRecord && type !== ContentType.handshake && type !== ContentType.alert) {
        this.notTls = true;
        this.stop();
        break;
      }
      if (length > MAX_FRAGMENT || (type !== ContentType.handshake && type !== ContentType.changeCipherSpec && type !== ContentType.alert && type !== ContentType.applicationData)) {
        this.notTls = true;
        this.stop();
        break;
      }
      if (this.raw.length < RECORD_HEADER_BYTES + length) break;
      this.sawFirstRecord = true;

      const fragment = this.raw.subarray(RECORD_HEADER_BYTES, RECORD_HEADER_BYTES + length);
      this.raw = this.raw.subarray(RECORD_HEADER_BYTES + length);

      if (type === ContentType.applicationData) {
        // From here the handshake is encrypted; nothing further is observable on the wire.
        this.stop();
        break;
      }
      if (type === ContentType.alert) {
        if (fragment.length >= 2) this.alerts.push({ level: fragment[0]!, description: fragment[1]! });
        continue;
      }
      if (type === ContentType.changeCipherSpec) continue;

      this.handshakeRecordBytes += RECORD_HEADER_BYTES + length;
      this.handshakeFragment = Buffer.concat([this.handshakeFragment, fragment]);
      while (this.handshakeFragment.length >= 4) {
        const messageLength = this.handshakeFragment.readUIntBE(1, 3);
        if (this.handshakeFragment.length < 4 + messageLength) break;
        messages.push({ type: this.handshakeFragment[0]!, body: Buffer.from(this.handshakeFragment.subarray(4, 4 + messageLength)) });
        this.handshakeFragment = this.handshakeFragment.subarray(4 + messageLength);
      }
    }
    return messages;
  }
}

export function wrapHandshake(type: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), u24(body.length), body]);
}

/** Wraps a handshake message in a single TLS record. Throws if it would not fit in one. */
export function wrapRecord(contentType: number, legacyVersion: number, fragment: Buffer): Buffer {
  if (fragment.length > 16384) throw new Error("fragment exceeds the maximum TLS record size");
  return Buffer.concat([Buffer.from([contentType]), u16(legacyVersion), u16(fragment.length), fragment]);
}
