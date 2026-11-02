import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { createCertificateAuthority, issuePeerCertificate, issueServerCertificate, fingerprintOfPem, type CertificateAuthority, type Identity } from "../src/pki/generate.js";
import { createInternalMtlsServer, internalMtlsAgent } from "../src/internal-mtls.js";

function request(port: number, agent: https.Agent): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port, path: "/", method: "GET", agent }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("internal mTLS (sidecar↔core hop)", () => {
  let ca: CertificateAuthority;
  let foreignCa: CertificateAuthority;
  let server: https.Server;
  let serverCert: Identity;
  let client: Identity;
  let revokedClient: Identity;
  let foreignClient: Identity;
  let port: number;

  before(async () => {
    ca = await createCertificateAuthority("Internal Test CA");
    foreignCa = await createCertificateAuthority("Foreign CA");
    serverCert = await issueServerCertificate(ca, { commonName: "ledger-core", dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] });
    client = await issuePeerCertificate(ca, { commonName: "pqc-sidecar" });
    revokedClient = await issuePeerCertificate(ca, { commonName: "pqc-sidecar-old" });
    foreignClient = await issuePeerCertificate(foreignCa, { commonName: "intruder" });

    const revokedFp = fingerprintOfPem(revokedClient.certPem);
    server = createInternalMtlsServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
      { serverCertPem: serverCert.certPem, serverKeyPem: serverCert.keyPem, clientCaPem: ca.certPem, isRevoked: (fp) => fp === revokedFp },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => {
    server.close();
  });

  it("accepts a client that presents a certificate issued by the trusted CA", async () => {
    const agent = internalMtlsAgent({ clientCertPem: client.certPem, clientKeyPem: client.keyPem, serverCaPem: ca.certPem });
    const res = await request(port, agent);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).ok, true);
  });

  it("rejects a client that presents no certificate (handshake fails)", async () => {
    const agent = new https.Agent({ ca: ca.certPem, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
    await assert.rejects(() => request(port, agent));
  });

  it("rejects a client whose certificate is from a different CA", async () => {
    const agent = internalMtlsAgent({ clientCertPem: foreignClient.certPem, clientKeyPem: foreignClient.keyPem, serverCaPem: ca.certPem });
    await assert.rejects(() => request(port, agent));
  });

  it("refuses a revoked client certificate even though it chains to the trusted CA (403)", async () => {
    const agent = internalMtlsAgent({ clientCertPem: revokedClient.certPem, clientKeyPem: revokedClient.keyPem, serverCaPem: ca.certPem });
    const res = await request(port, agent);
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error.code, "CLIENT_CERT_REVOKED");
  });
});
