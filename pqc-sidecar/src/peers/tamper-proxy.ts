import net from "node:net";
import { parseClientHello, removeGroup, serializeClientHello } from "../wire/hello.js";
import { HandshakeAssembler, HandshakeType, wrapHandshake, wrapRecord } from "../wire/records.js";

export interface TamperProxyOptions {
  targetHost: string;
  targetPort: number;
  /** The key-agreement group to strip from the peer's ClientHello (supported_groups and key_share). */
  removeGroup: number;
  listenPort?: number;
}

export interface TamperProxy {
  port: number;
  /** ClientHellos rewritten so far. */
  readonly tampered: number;
  close(): Promise<void>;
}

/**
 * A deliberately hostile on-path element for the controlled downgrade experiment (proposal 8.3,
 * experiment C): it rewrites the first ClientHello a peer sends so that the hybrid group is no
 * longer offered, then passes everything else through untouched.
 *
 * Because the ClientHello is part of the TLS 1.3 handshake transcript that both sides hash into
 * their Finished messages, the peer and the sidecar end up with different transcripts and the
 * handshake must fail. This proxy exists to demonstrate and test that property; it is a test
 * tool and is never part of the sidecar's data path.
 */
export async function startTamperProxy(opts: TamperProxyOptions): Promise<TamperProxy> {
  let tampered = 0;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const upstream = net.connect(opts.targetPort, opts.targetHost);
    sockets.add(client);
    sockets.add(upstream);
    const cleanup = (): void => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", cleanup);
    upstream.on("error", cleanup);
    client.on("close", cleanup);
    upstream.on("close", cleanup);
    upstream.on("data", (d) => client.write(d));

    const assembler = new HandshakeAssembler();
    let pending: Buffer = Buffer.alloc(0);
    let rewritten = false;

    client.on("data", (chunk) => {
      if (rewritten) {
        upstream.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const messages = assembler.push(chunk);
      const hello = messages.find((m) => m.type === HandshakeType.clientHello);
      if (!hello) {
        if (assembler.stopped) {
          // Not a ClientHello we can understand: pass it through unchanged.
          rewritten = true;
          upstream.write(pending);
        }
        return;
      }
      const consumed = assembler.handshakeRecordBytes;
      const recordVersion = pending.readUInt16BE(1);
      const modified = removeGroup(parseClientHello(hello.body), opts.removeGroup);
      upstream.write(wrapRecord(22, recordVersion, wrapHandshake(HandshakeType.clientHello, serializeClientHello(modified))));
      if (pending.length > consumed) upstream.write(pending.subarray(consumed));
      pending = Buffer.alloc(0);
      rewritten = true;
      tampered += 1;
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.listenPort ?? 0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    get tampered() {
      return tampered;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
