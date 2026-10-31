# Vendored CycloneDX 1.7 JSON schemas

Official schemas from the CycloneDX specification repository, vendored unmodified so BOM validation
works offline and is reproducible. Retrieved 2026-11-01 from
`https://raw.githubusercontent.com/CycloneDX/specification/master/schema/<file>` (the `master`
branch publishes `bom-1.7.schema.json`; `$id` is `http://cyclonedx.org/schema/bom-1.7.schema.json`).
CycloneDX is also standardised as ECMA-424 (2nd edition, CycloneDX 1.7).

| File | SHA-256 |
|---|---|
| bom-1.7.schema.json | 73308edec3ab2d38bfffd993e96a042b594314143b6971a6e9ed98bbb6bd76ce |
| cryptography-defs.schema.json | 013919cfb1c6209f919cd7253a4e3f740cb44023697bb4657a5f0584d6f47137 |
| jsf-0.82.schema.json | 8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae |
| spdx.schema.json | 4b345e2329f209f34e960ae2a8e7cb46a166907e6a45e94978565925dc47b359 |

`tests/cbom.test.ts` recomputes these hashes, so an accidental edit of a vendored schema fails the
suite. License: Apache-2.0 (the schemas carry their own notices).
