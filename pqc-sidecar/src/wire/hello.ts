import { ByteReader, WireParseError, u16 } from "./reader.js";
import { isGrease } from "./groups.js";

export const ExtensionType = {
  serverName: 0,
  supportedGroups: 10,
  signatureAlgorithms: 13,
  alpn: 16,
  supportedVersions: 43,
  keyShare: 51,
} as const;

export interface Extension {
  type: number;
  data: Buffer;
}

export interface KeyShareEntry {
  group: number;
  keyExchange: Buffer;
}

export interface ParsedClientHello {
  legacyVersion: number;
  random: Buffer;
  sessionId: Buffer;
  cipherSuites: number[];
  compressionMethods: number[];
  extensions: Extension[];
}

/** SHA-256("HelloRetryRequest") - the fixed ServerHello.random that marks an HRR (RFC 8446 4.1.3). */
const HELLO_RETRY_REQUEST_RANDOM = Buffer.from("cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c", "hex");

function readVector8(r: ByteReader): Buffer {
  return r.bytes(r.u8());
}

function readVector16(r: ByteReader): Buffer {
  return r.bytes(r.u16());
}

function parseExtensions(r: ByteReader): Extension[] {
  const block = new ByteReader(readVector16(r));
  const extensions: Extension[] = [];
  while (block.remaining > 0) {
    const type = block.u16();
    extensions.push({ type, data: Buffer.from(readVector16(block)) });
  }
  return extensions;
}

export function parseClientHello(body: Buffer): ParsedClientHello {
  const r = new ByteReader(body);
  const legacyVersion = r.u16();
  const random = Buffer.from(r.bytes(32));
  const sessionId = Buffer.from(readVector8(r));
  const suites = new ByteReader(readVector16(r));
  const cipherSuites: number[] = [];
  while (suites.remaining > 0) cipherSuites.push(suites.u16());
  const compressionMethods = [...readVector8(r)];
  const extensions = r.remaining > 0 ? parseExtensions(r) : [];
  return { legacyVersion, random, sessionId, cipherSuites, compressionMethods, extensions };
}

export function serializeClientHello(ch: ParsedClientHello): Buffer {
  const suites = Buffer.alloc(ch.cipherSuites.length * 2);
  ch.cipherSuites.forEach((s, i) => suites.writeUInt16BE(s, i * 2));
  const extensions = Buffer.concat(ch.extensions.map((e) => Buffer.concat([u16(e.type), u16(e.data.length), e.data])));
  return Buffer.concat([
    u16(ch.legacyVersion),
    ch.random,
    Buffer.from([ch.sessionId.length]),
    ch.sessionId,
    u16(suites.length),
    suites,
    Buffer.from([ch.compressionMethods.length, ...ch.compressionMethods]),
    u16(extensions.length),
    extensions,
  ]);
}

function findExtension(extensions: readonly Extension[], type: number): Extension | undefined {
  return extensions.find((e) => e.type === type);
}

/** Groups the client offers, in its preference order, GREASE removed. */
export function offeredGroups(ch: ParsedClientHello): number[] {
  const ext = findExtension(ch.extensions, ExtensionType.supportedGroups);
  if (!ext) return [];
  const r = new ByteReader(ext.data);
  const list = new ByteReader(readVector16(r));
  const groups: number[] = [];
  while (list.remaining > 0) groups.push(list.u16());
  return groups.filter((g) => !isGrease(g));
}

export function clientKeyShares(ch: ParsedClientHello): KeyShareEntry[] {
  const ext = findExtension(ch.extensions, ExtensionType.keyShare);
  if (!ext) return [];
  const r = new ByteReader(ext.data);
  const list = new ByteReader(readVector16(r));
  const entries: KeyShareEntry[] = [];
  while (list.remaining > 0) {
    const group = list.u16();
    entries.push({ group, keyExchange: Buffer.from(readVector16(list)) });
  }
  return entries;
}

export function clientSupportedVersions(ch: ParsedClientHello): number[] {
  const ext = findExtension(ch.extensions, ExtensionType.supportedVersions);
  if (!ext) return [];
  const r = new ByteReader(ext.data);
  const list = new ByteReader(readVector8(r));
  const versions: number[] = [];
  while (list.remaining > 0) versions.push(list.u16());
  return versions.filter((v) => !isGrease(v));
}

export function clientServerName(ch: ParsedClientHello): string | undefined {
  const ext = findExtension(ch.extensions, ExtensionType.serverName);
  if (!ext) return undefined;
  const r = new ByteReader(ext.data);
  const list = new ByteReader(readVector16(r));
  while (list.remaining > 0) {
    const nameType = list.u8();
    const name = readVector16(list);
    if (nameType === 0) return name.toString("ascii");
  }
  return undefined;
}

/**
 * Returns a copy of the ClientHello with `group` removed from supported_groups and from the
 * key_share list - a deliberate, protocol-level manipulation used only by the controlled
 * downgrade experiment. The result is still a well-formed ClientHello.
 */
export function removeGroup(ch: ParsedClientHello, group: number): ParsedClientHello {
  const extensions = ch.extensions.map((ext): Extension => {
    if (ext.type === ExtensionType.supportedGroups) {
      const r = new ByteReader(ext.data);
      const list = new ByteReader(readVector16(r));
      const kept: number[] = [];
      while (list.remaining > 0) {
        const g = list.u16();
        if (g !== group) kept.push(g);
      }
      const body = Buffer.alloc(kept.length * 2);
      kept.forEach((g, i) => body.writeUInt16BE(g, i * 2));
      return { type: ext.type, data: Buffer.concat([u16(body.length), body]) };
    }
    if (ext.type === ExtensionType.keyShare) {
      const kept = clientKeyShares({ ...ch, extensions: [ext] }).filter((e) => e.group !== group);
      const body = Buffer.concat(kept.map((e) => Buffer.concat([u16(e.group), u16(e.keyExchange.length), e.keyExchange])));
      return { type: ext.type, data: Buffer.concat([u16(body.length), body]) };
    }
    return ext;
  });
  return { ...ch, extensions };
}

export interface ParsedServerHello {
  legacyVersion: number;
  random: Buffer;
  sessionId: Buffer;
  cipherSuite: number;
  isHelloRetryRequest: boolean;
  selectedVersion: number | undefined;
  /** The group the server selected. For a real ServerHello, the group of its key share. */
  selectedGroup: number | undefined;
  /** Length in bytes of the server's key-exchange value; undefined for a HelloRetryRequest. */
  keyShareBytes: number | undefined;
}

export function parseServerHello(body: Buffer): ParsedServerHello {
  const r = new ByteReader(body);
  const legacyVersion = r.u16();
  const random = Buffer.from(r.bytes(32));
  const sessionId = Buffer.from(readVector8(r));
  const cipherSuite = r.u16();
  r.u8(); // legacy_compression_method
  const extensions = r.remaining > 0 ? parseExtensions(r) : [];
  const isHelloRetryRequest = random.equals(HELLO_RETRY_REQUEST_RANDOM);

  let selectedVersion: number | undefined;
  const versionExt = findExtension(extensions, ExtensionType.supportedVersions);
  if (versionExt) {
    if (versionExt.data.length !== 2) throw new WireParseError("malformed supported_versions in ServerHello");
    selectedVersion = versionExt.data.readUInt16BE(0);
  }

  let selectedGroup: number | undefined;
  let keyShareBytes: number | undefined;
  const keyShareExt = findExtension(extensions, ExtensionType.keyShare);
  if (keyShareExt) {
    const kr = new ByteReader(keyShareExt.data);
    selectedGroup = kr.u16();
    if (!isHelloRetryRequest) keyShareBytes = readVector16(kr).length;
  }
  return { legacyVersion, random, sessionId, cipherSuite, isHelloRetryRequest, selectedVersion, selectedGroup, keyShareBytes };
}
