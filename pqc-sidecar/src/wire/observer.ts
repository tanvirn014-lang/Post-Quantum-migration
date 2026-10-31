import { clientKeyShares, clientServerName, clientSupportedVersions, offeredGroups, parseClientHello, parseServerHello } from "./hello.js";
import { HandshakeAssembler, HandshakeType, type HandshakeMessage } from "./records.js";

export interface ObservedClientHello {
  /** Groups offered in supported_groups, preference order, GREASE removed. */
  offeredGroups: number[];
  /** Key shares actually sent (group + key-exchange length in bytes). */
  keyShares: { group: number; bytes: number }[];
  supportedVersions: number[];
  serverName: string | undefined;
  /** Size on the wire of the record(s) carrying this ClientHello, headers included. */
  recordBytes: number;
}

export interface ObservedServerHello {
  selectedGroup: number | undefined;
  /** Length of the server's key-exchange value (ML-KEM ciphertext + X25519 share for the hybrid group). */
  keyShareBytes: number | undefined;
  cipherSuite: number;
  selectedVersion: number | undefined;
  recordBytes: number;
}

export interface Observation {
  clientHello: ObservedClientHello | undefined;
  serverHello: ObservedServerHello | undefined;
  helloRetryRequests: number;
  alerts: { from: "client" | "server"; level: number; description: number }[];
  notTls: boolean;
  parseError: string | undefined;
}

/**
 * Passively reads the plaintext opening of a TLS 1.3 handshake from both directions of a
 * connection. This is the sidecar's "verified handshake trace": Node's TLS API cannot report the
 * negotiated group for hybrid key agreement, but the ServerHello's key_share names it on the
 * wire. Nothing here influences the connection and no secret material is ever visible.
 */
export class HandshakeObserver {
  private readonly clientSide = new HandshakeAssembler();
  private readonly serverSide = new HandshakeAssembler();
  private clientHello: ObservedClientHello | undefined;
  private serverHello: ObservedServerHello | undefined;
  private helloRetryRequests = 0;
  private parseError: string | undefined;
  private clientBytesAtLastMessage = 0;
  private serverBytesAtLastMessage = 0;

  feedClientToServer(chunk: Buffer): void {
    this.handle(this.clientSide, chunk, "client");
  }

  feedServerToClient(chunk: Buffer): void {
    this.handle(this.serverSide, chunk, "server");
  }

  private handle(assembler: HandshakeAssembler, chunk: Buffer, side: "client" | "server"): void {
    let messages: HandshakeMessage[];
    try {
      messages = assembler.push(chunk);
    } catch (err) {
      this.parseError = (err as Error).message;
      assembler.stop();
      return;
    }
    for (const message of messages) {
      try {
        if (side === "client" && message.type === HandshakeType.clientHello) {
          const bytes = assembler.handshakeRecordBytes - this.clientBytesAtLastMessage;
          this.clientBytesAtLastMessage = assembler.handshakeRecordBytes;
          const ch = parseClientHello(message.body);
          this.clientHello = {
            offeredGroups: offeredGroups(ch),
            keyShares: clientKeyShares(ch).map((k) => ({ group: k.group, bytes: k.keyExchange.length })),
            supportedVersions: clientSupportedVersions(ch),
            serverName: clientServerName(ch),
            recordBytes: bytes,
          };
        } else if (side === "server" && message.type === HandshakeType.serverHello) {
          const bytes = assembler.handshakeRecordBytes - this.serverBytesAtLastMessage;
          this.serverBytesAtLastMessage = assembler.handshakeRecordBytes;
          const sh = parseServerHello(message.body);
          if (sh.isHelloRetryRequest) {
            this.helloRetryRequests += 1;
          } else {
            this.serverHello = {
              selectedGroup: sh.selectedGroup,
              keyShareBytes: sh.keyShareBytes,
              cipherSuite: sh.cipherSuite,
              selectedVersion: sh.selectedVersion,
              recordBytes: bytes,
            };
            // The rest of the server flight is encrypted; nothing more to learn from this side.
            assembler.stop();
          }
        }
      } catch (err) {
        this.parseError = (err as Error).message;
        assembler.stop();
      }
    }
  }

  get observation(): Observation {
    return {
      clientHello: this.clientHello,
      serverHello: this.serverHello,
      helloRetryRequests: this.helloRetryRequests,
      alerts: [
        ...this.clientSide.alerts.map((a) => ({ from: "client" as const, ...a })),
        ...this.serverSide.alerts.map((a) => ({ from: "server" as const, ...a })),
      ],
      notTls: this.clientSide.notTls || this.serverSide.notTls,
      parseError: this.parseError,
    };
  }
}
