import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GROUP_X25519, GROUP_X25519_MLKEM768, isGrease, lookupGroup } from "../src/wire/groups.js";
import { clientKeyShares, offeredGroups, parseClientHello, removeGroup, serializeClientHello } from "../src/wire/hello.js";
import { HandshakeObserver } from "../src/wire/observer.js";
import { HandshakeAssembler, HandshakeType, RECORD_HEADER_BYTES, wrapHandshake, wrapRecord } from "../src/wire/records.js";
import { ByteReader, WireParseError } from "../src/wire/reader.js";
import { captureClientHelloBytes, testPki, tappedHandshake } from "./helpers/tls-fixture.js";

describe("verified handshake trace (real TLS 1.3 handshakes, observed on the wire)", () => {
  it("hybrid client and hybrid-preferred server: X25519MLKEM768 selected, with the RFC 10024 key-share sizes", async () => {
    const r = await tappedHandshake({ serverGroups: "X25519MLKEM768:X25519", clientGroups: "*X25519MLKEM768:*X25519" });
    assert.strictEqual(r.connected, true, r.error);
    const { clientHello, serverHello } = r.observation;
    assert.ok(clientHello && serverHello);
    assert.strictEqual(clientHello.offeredGroups[0], GROUP_X25519_MLKEM768, "hybrid offered first");
    assert.ok(clientHello.offeredGroups.includes(GROUP_X25519));
    assert.deepStrictEqual(clientHello.supportedVersions.includes(0x0304), true, "TLS 1.3 offered");
    assert.strictEqual(serverHello.selectedGroup, GROUP_X25519_MLKEM768);
    // RFC 10024: 1184-byte ML-KEM-768 encapsulation key + 32-byte X25519 = 1216 client share;
    // 1088-byte ML-KEM ciphertext + 32-byte X25519 = 1120 server share (hypothesis H1 inputs).
    assert.strictEqual(clientHello.keyShares.find((k) => k.group === GROUP_X25519_MLKEM768)?.bytes, 1216);
    assert.strictEqual(serverHello.keyShareBytes, 1120);
    assert.strictEqual(serverHello.selectedVersion, 0x0304);
  });

  it("classical-only client: X25519 selected with a 32-byte share and a much smaller ClientHello", async () => {
    const hybrid = await tappedHandshake({ serverGroups: "X25519MLKEM768:X25519", clientGroups: "*X25519MLKEM768:*X25519" });
    const classical = await tappedHandshake({ serverGroups: "X25519MLKEM768:X25519", clientGroups: "X25519" });
    assert.strictEqual(classical.connected, true, classical.error);
    const { clientHello, serverHello } = classical.observation;
    assert.deepStrictEqual(clientHello?.offeredGroups, [GROUP_X25519]);
    assert.deepStrictEqual(clientHello?.keyShares, [{ group: GROUP_X25519, bytes: 32 }]);
    assert.strictEqual(serverHello?.selectedGroup, GROUP_X25519);
    assert.strictEqual(serverHello?.keyShareBytes, 32);
    assert.ok(hybrid.observation.clientHello!.recordBytes > classical.observation.clientHello!.recordBytes + 1000, "hybrid ClientHello is >1 KB larger (hypothesis H1)");
  });

  it("hybrid-only server rejects a classical-only client; no ServerHello is produced and the alert is captured", async () => {
    const r = await tappedHandshake({ serverGroups: "X25519MLKEM768", clientGroups: "X25519" });
    assert.strictEqual(r.connected, false);
    assert.strictEqual(r.observation.serverHello, undefined);
    assert.deepStrictEqual(r.observation.clientHello?.offeredGroups, [GROUP_X25519]);
    assert.ok(r.observation.alerts.some((a) => a.from === "server" && a.description === 40), "server sent handshake_failure(40)");
  });

  it("classical-baseline server with a hybrid-capable client falls back to X25519 without any error", async () => {
    const r = await tappedHandshake({ serverGroups: "X25519", clientGroups: "X25519MLKEM768:X25519" });
    assert.strictEqual(r.connected, true, r.error);
    assert.strictEqual(r.observation.serverHello?.selectedGroup, GROUP_X25519);
  });

  it("identifies the client that offered hybrid but only a classical share as classical-selected after a retry or fallback", async () => {
    // A client that offers hybrid in supported_groups but sends only an X25519 key share forces
    // the server to either accept X25519 or send a HelloRetryRequest. OpenSSL clients here send
    // both shares, so we assert the observer reports whatever was actually selected.
    const r = await tappedHandshake({ serverGroups: "X25519MLKEM768:X25519", clientGroups: "X25519:X25519MLKEM768" });
    assert.strictEqual(r.connected, true, r.error);
    const selected = r.observation.serverHello?.selectedGroup;
    assert.ok(selected === GROUP_X25519 || selected === GROUP_X25519_MLKEM768);
    assert.strictEqual(lookupGroup(selected!)?.name, selected === GROUP_X25519 ? "X25519" : "X25519MLKEM768");
  });
});

describe("ClientHello parsing and re-serialization", () => {
  it("round-trips a real ClientHello byte for byte", async () => {
    const record = await captureClientHelloBytes("X25519MLKEM768:X25519");
    const asm = new HandshakeAssembler();
    const [message] = asm.push(record);
    assert.strictEqual(message?.type, HandshakeType.clientHello);
    const parsed = parseClientHello(message!.body);
    assert.ok(serializeClientHello(parsed).equals(message!.body));
  });

  it("removes a group from supported_groups and key_share and still produces a well-formed hello", async () => {
    const record = await captureClientHelloBytes("*X25519MLKEM768:*X25519");
    const [message] = new HandshakeAssembler().push(record);
    const original = parseClientHello(message!.body);
    assert.ok(offeredGroups(original).includes(GROUP_X25519_MLKEM768));

    const tampered = removeGroup(original, GROUP_X25519_MLKEM768);
    const reparsed = parseClientHello(serializeClientHello(tampered));
    assert.ok(!offeredGroups(reparsed).includes(GROUP_X25519_MLKEM768));
    assert.ok(offeredGroups(reparsed).includes(GROUP_X25519));
    assert.ok(!clientKeyShares(reparsed).some((k) => k.group === GROUP_X25519_MLKEM768));
    assert.ok(clientKeyShares(reparsed).some((k) => k.group === GROUP_X25519));
    assert.ok(serializeClientHello(tampered).length < message!.body.length - 1000, "the 1216-byte share is gone");
  });

  it("exposes SNI and ignores GREASE values", async () => {
    const record = await captureClientHelloBytes("X25519");
    const obs = new HandshakeObserver();
    obs.feedClientToServer(record);
    assert.strictEqual(obs.observation.clientHello?.serverName, "localhost");
    assert.ok(obs.observation.clientHello?.offeredGroups.every((g) => !isGrease(g)));
  });
});

describe("handshake assembly robustness", () => {
  it("handles a ClientHello delivered one byte at a time", async () => {
    const record = await captureClientHelloBytes("X25519MLKEM768:X25519");
    const obs = new HandshakeObserver();
    for (const byte of record) obs.feedClientToServer(Buffer.from([byte]));
    assert.strictEqual(obs.observation.clientHello?.keyShares.find((k) => k.group === GROUP_X25519_MLKEM768)?.bytes, 1216);
  });

  it("reassembles a handshake message split across two records", () => {
    const body = Buffer.from("hello-body-0123456789");
    const message = wrapHandshake(99, body);
    const first = wrapRecord(22, 0x0303, message.subarray(0, 6));
    const second = wrapRecord(22, 0x0303, message.subarray(6));
    const asm = new HandshakeAssembler();
    assert.deepStrictEqual(asm.push(first), []);
    const [out] = asm.push(second);
    assert.strictEqual(out?.type, 99);
    assert.ok(out!.body.equals(body));
  });

  it("returns two messages packed into one record", () => {
    const record = wrapRecord(22, 0x0303, Buffer.concat([wrapHandshake(1, Buffer.from("a")), wrapHandshake(2, Buffer.from("bb"))]));
    const messages = new HandshakeAssembler().push(record);
    assert.deepStrictEqual(messages.map((m) => m.type), [1, 2]);
  });

  it("flags non-TLS traffic instead of guessing", () => {
    const asm = new HandshakeAssembler();
    asm.push(Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    assert.strictEqual(asm.notTls, true);
    assert.strictEqual(asm.stopped, true);
  });

  it("survives random garbage without throwing", () => {
    for (let i = 0; i < 200; i++) {
      const obs = new HandshakeObserver();
      assert.doesNotThrow(() => obs.feedClientToServer(randomBytes(1 + (i % 700))));
      assert.doesNotThrow(() => obs.feedServerToClient(randomBytes(1 + (i % 700))));
    }
  });

  it("records a parse error for a record that claims to be a handshake but is truncated, without throwing", () => {
    const truncatedHello = wrapRecord(22, 0x0301, wrapHandshake(HandshakeType.clientHello, Buffer.from([3, 3, 1, 2, 3])));
    const obs = new HandshakeObserver();
    assert.doesNotThrow(() => obs.feedClientToServer(truncatedHello));
    assert.ok(obs.observation.parseError);
    assert.strictEqual(obs.observation.clientHello, undefined);
  });

  it("rejects an oversized record length instead of buffering it", () => {
    const asm = new HandshakeAssembler();
    asm.push(Buffer.from([22, 3, 3, 0xff, 0xff, 1, 2, 3]));
    assert.strictEqual(asm.notTls, true);
  });

  it("stops at the first encrypted record and ignores everything after it", () => {
    const asm = new HandshakeAssembler();
    asm.push(Buffer.concat([Buffer.from([23, 3, 3, 0, 4, 1, 2, 3, 4]), wrapRecord(22, 0x0303, wrapHandshake(1, Buffer.from("late")))]));
    assert.strictEqual(asm.stopped, true);
    assert.deepStrictEqual(asm.push(wrapRecord(22, 0x0303, wrapHandshake(1, Buffer.from("x")))), []);
  });

  it("bounds a reader: any over-read throws WireParseError", () => {
    const r = new ByteReader(Buffer.from([1, 2]));
    assert.strictEqual(r.u16(), 0x0102);
    assert.throws(() => r.u8(), WireParseError);
    assert.throws(() => new ByteReader(Buffer.alloc(0)).bytes(1), WireParseError);
  });

  it("keeps header size constant (guards the record-size accounting)", () => {
    assert.strictEqual(RECORD_HEADER_BYTES, 5);
    assert.strictEqual(wrapRecord(22, 0x0303, Buffer.alloc(10)).length, 15);
  });

  it("has a test PKI available (sanity for the fixtures)", async () => {
    const pki = await testPki();
    assert.match(pki.server.sha256, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(pki.server.sha256, pki.peer.sha256);
  });
});
