/** TLS supported-group (named group) code points this prototype can classify. */

export type GroupKind = "hybrid" | "classical";

export interface KnownGroup {
  code: number;
  name: string;
  kind: GroupKind;
}

export const GROUP_X25519 = 0x001d;
export const GROUP_X25519_MLKEM768 = 0x11ec;

const KNOWN: readonly KnownGroup[] = [
  { code: GROUP_X25519_MLKEM768, name: "X25519MLKEM768", kind: "hybrid" },
  { code: 0x11eb, name: "SecP256r1MLKEM768", kind: "hybrid" },
  { code: 0x11ed, name: "SecP384r1MLKEM1024", kind: "hybrid" },
  { code: GROUP_X25519, name: "X25519", kind: "classical" },
  { code: 0x001e, name: "X448", kind: "classical" },
  { code: 0x0017, name: "secp256r1", kind: "classical" },
  { code: 0x0018, name: "secp384r1", kind: "classical" },
  { code: 0x0019, name: "secp521r1", kind: "classical" },
];

export function lookupGroup(code: number): KnownGroup | undefined {
  return KNOWN.find((g) => g.code === code);
}

/** GREASE values (RFC 8701) are random placeholders clients send to keep servers honest. */
export function isGrease(value: number): boolean {
  return (value & 0x0f0f) === 0x0a0a;
}

export function groupName(code: number): string | undefined {
  return lookupGroup(code)?.name;
}
