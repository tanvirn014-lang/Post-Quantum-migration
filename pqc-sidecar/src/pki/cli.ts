import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCertificateAuthority, createUntrustedCertificate, issuePeerCertificate, issueServerCertificate, type Identity } from "./generate.js";

/**
 * Generates the local research PKI under .secrets/pki (git-ignored):
 *   ca.pem / ca.key.pem            test CA that issues the server and peer certificates
 *   sidecar/server.{pem,key.pem}   the sidecar's TLS server certificate
 *   peers/<slug>/{cert,key}.pem    simulated external peers (private keys stay with the simulator)
 *   peers.json                     NON-secret manifest: slug, name, profile, certificate fingerprint
 *
 * All certificates are classical (ECDSA P-256). Idempotent: an existing PKI is never overwritten
 * unless --force is passed, because registered peer fingerprints would stop matching.
 */

export const SIM_PEERS = [
  { slug: "hybrid-bank", name: "Simulated Hybrid Bank", profile: "hybrid-required", registered: true, description: "Hybrid-capable partner; policy requires hybrid key agreement." },
  { slug: "legacy-psp", name: "Simulated Legacy PSP", profile: "classical-allowed", registered: true, description: "Legacy payment service provider limited to X25519; classical fallback explicitly permitted." },
  { slug: "strict-bank", name: "Simulated Strict Bank", profile: "hybrid-required", registered: true, description: "Registered peer used to demonstrate rejection of a forced classical connection." },
  { slug: "unregistered-peer", name: "Unregistered Peer", profile: null, registered: false, description: "Certificate from the trusted CA that is never registered." },
] as const;

async function write(file: string, content: string, mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { mode });
}

async function writeIdentity(dir: string, id: Identity, certName: string, keyName: string): Promise<void> {
  await write(path.join(dir, certName), id.certPem);
  await write(path.join(dir, keyName), id.keyPem, 0o600);
}

async function main(): Promise<void> {
  const root = path.resolve(process.env["PKI_DIR"] ?? ".secrets/pki");
  const force = process.argv.includes("--force");
  if (existsSync(path.join(root, "ca.pem")) && !force) {
    console.log(`PKI already exists at ${root} (use --force to regenerate; registered peer fingerprints will change).`);
    return;
  }

  const ca = await createCertificateAuthority();
  await writeIdentity(root, ca, "ca.pem", "ca.key.pem");

  const server = await issueServerCertificate(ca, { commonName: "pqc-sidecar", dnsNames: ["localhost", "pqc-sidecar"], ipAddresses: ["127.0.0.1", "::1"] });
  await writeIdentity(path.join(root, "sidecar"), server, "server.pem", "server.key.pem");

  const manifest: unknown[] = [];
  for (const peer of SIM_PEERS) {
    const id = await issuePeerCertificate(ca, { commonName: peer.slug });
    await writeIdentity(path.join(root, "peers", peer.slug), id, "cert.pem", "key.pem");
    manifest.push({ slug: peer.slug, name: peer.name, profile: peer.profile, registered: peer.registered, description: peer.description, certSha256: id.sha256 });
  }
  const rogue = await createUntrustedCertificate("rogue");
  await writeIdentity(path.join(root, "peers", "rogue"), rogue, "cert.pem", "key.pem");
  manifest.push({ slug: "rogue", name: "Rogue (self-signed)", profile: null, registered: false, description: "Self-signed certificate not issued by the trusted CA.", certSha256: rogue.sha256 });

  await write(path.join(root, "peers.json"), JSON.stringify(manifest, null, 2));
  console.log(`PKI written to ${root}`);
  for (const m of manifest as { slug: string; certSha256: string }[]) console.log(`  ${m.slug.padEnd(18)} ${m.certSha256}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
