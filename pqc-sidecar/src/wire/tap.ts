import { Duplex } from "node:stream";
import type net from "node:net";
import type { HandshakeObserver } from "./observer.js";

export type TapRole = "server" | "client";

/**
 * A pass-through stream placed between a TCP socket and a TLSSocket. Bytes flow unchanged in
 * both directions; a copy of each chunk is shown to the HandshakeObserver, which only inspects
 * the plaintext handshake opening. `role` says which side of the TLS connection we are on so
 * "inbound" and "outbound" map to the right observer direction.
 */
export class TapDuplex extends Duplex {
  /** Bytes received from / sent to the underlying socket (wire bytes, TLS records included). */
  bytesIn = 0;
  bytesOut = 0;

  constructor(
    private readonly raw: net.Socket,
    private readonly observer: HandshakeObserver,
    private readonly role: TapRole,
  ) {
    super();
    raw.on("data", (chunk: Buffer) => {
      this.bytesIn += chunk.length;
      if (this.role === "server") this.observer.feedClientToServer(chunk);
      else this.observer.feedServerToClient(chunk);
      if (!this.push(chunk)) raw.pause();
    });
    raw.on("end", () => this.push(null));
    raw.on("error", (err) => this.destroy(err));
    raw.on("close", () => {
      if (!this.destroyed) this.destroy();
    });
  }

  override _read(): void {
    this.raw.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.bytesOut += chunk.length;
    if (this.role === "server") this.observer.feedServerToClient(chunk);
    else this.observer.feedClientToServer(chunk);
    this.raw.write(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.raw.end();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.raw.destroy(error ?? undefined);
    callback(error);
  }
}
