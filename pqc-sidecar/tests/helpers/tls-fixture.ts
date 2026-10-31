import net from "node:net";
import tls from "node:tls";
import { createCertificateAuthority, issuePeerCertificate, issueServerCertificate, type CertificateAuthority, type Identity } from "../../src/pki/generate.js";
import { HandshakeObserver, type Observation } from "../../src/wire/observer.js";
import { TapDuplex } from "../../src/wire/tap.js";

export interface TestPki {
  ca: CertificateAuthority;
  server: Identity;
  peer: Identity;
}

let cached: Promise<TestPki> | undefined;

/** One CA + server + peer certificate for the whole test run (generation is the slow part). */
export function testPki(): Promise<TestPki> {
  cached ??= (async () => {
    const ca = await createCertificateAuthority("Test CA");
    const server = await issueServerCertificate(ca, { commonName: "sidecar.test", dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] });
    const peer = await issuePeerCertificate(ca, { commonName: "test-peer" });
    return { ca, server, peer };
  })();
  return cached;
}

export interface TapResult {
  observation: Observation;
  connected: boolean;
  error?: string;
}

/**
 * Runs one real TLS 1.3 handshake between a plain node:tls server (restricted to
 * `serverGroups`) and a client (restricted to `clientGroups`) whose socket is tapped, so the
 * observer sees both directions exactly as the sidecar would.
 */
export async function tappedHandshake(opts: { serverGroups: string; clientGroups: string; clientIdentity?: Identity }): Promise<TapResult> {
  const pki = await testPki();
  const server = tls.createServer(
    {
      key: pki.server.keyPem,
      cert: pki.server.certPem,
      ca: pki.ca.certPem,
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ecdhCurve: opts.serverGroups,
    },
    (socket) => {
      socket.on("error", () => {});
      socket.end("ok");
    },
  );
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const raw = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    raw.once("connect", resolve);
    raw.once("error", reject);
  });
  const observer = new HandshakeObserver();
  const tap = new TapDuplex(raw, observer, "client");

  const result = await new Promise<TapResult>((resolve) => {
    const client = tls.connect({
      socket: tap,
      servername: "localhost",
      ca: pki.ca.certPem,
      minVersion: "TLSv1.3",
      ecdhCurve: opts.clientGroups,
      ...(opts.clientIdentity ? { key: opts.clientIdentity.keyPem, cert: opts.clientIdentity.certPem } : {}),
    });
    client.on("secureConnect", () => {
      client.end();
      resolve({ observation: observer.observation, connected: true });
    });
    client.on("error", (err) => resolve({ observation: observer.observation, connected: false, error: err.message }));
  });

  raw.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return result;
}

/** Captures the first bytes a TLS client sends (its ClientHello record) without answering. */
export async function captureClientHelloBytes(clientGroups: string): Promise<Buffer> {
  const captured = new Promise<Buffer>((resolve) => {
    const capture = net.createServer((socket) => {
      socket.once("data", (data) => {
        resolve(data);
        socket.destroy();
        capture.close();
      });
      socket.on("error", () => {});
    });
    capture.listen(0, "127.0.0.1", () => {
      const port = (capture.address() as net.AddressInfo).port;
      const client = tls.connect({ host: "127.0.0.1", port, servername: "localhost", minVersion: "TLSv1.3", ecdhCurve: clientGroups, rejectUnauthorized: false });
      client.on("error", () => {});
    });
  });
  return captured;
}
