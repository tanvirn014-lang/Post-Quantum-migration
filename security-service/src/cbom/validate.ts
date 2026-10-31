import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// dist/src/cbom/validate.js -> package root is three levels up; schemas/ is not compiled.
const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/cyclonedx-1.7");

export const SCHEMA_FILES = ["bom-1.7.schema.json", "cryptography-defs.schema.json", "jsf-0.82.schema.json", "spdx.schema.json"] as const;
export const BOM_SCHEMA_ID = "http://cyclonedx.org/schema/bom-1.7.schema.json";

export interface ValidationResult {
  valid: boolean;
  schema: string;
  errors: { path: string; message: string }[];
}

type Validate = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: unknown }[] | null };

interface AjvLike {
  addSchema(schema: object): void;
  addFormat(name: string, format: RegExp): void;
  getSchema(id: string): Validate | undefined;
}

// ajv and ajv-formats are CommonJS with a default export; under NodeNext the default import is typed as the module namespace.
const Ajv = AjvModule as unknown as new (options: object) => AjvLike;
const addFormats = addFormatsModule as unknown as (ajv: AjvLike) => void;

let compiled: Validate | undefined;

/** Hashes of the vendored schema files, for the integrity check against MANIFEST.md. */
export function schemaHashes(): Record<string, string> {
  return Object.fromEntries(SCHEMA_FILES.map((f) => [f, createHash("sha256").update(readFileSync(path.join(SCHEMA_DIR, f))).digest("hex")]));
}

function validator(): Validate {
  if (compiled) return compiled;
  // The official CycloneDX schemas are JSON Schema draft-07; Ajv's default class handles that.
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  addFormats(ajv);
  // The CycloneDX schemas use two IRI formats ajv-formats does not implement. A permissive
  // structural check (no whitespace / one @) is registered so they are enforced loosely instead of
  // silently ignored; every URL and email this generator emits is plain ASCII anyway.
  ajv.addFormat("iri-reference", /^\S*$/);
  ajv.addFormat("idn-email", /^[^\s@]+@[^\s@]+$/);
  for (const file of SCHEMA_FILES) ajv.addSchema(JSON.parse(readFileSync(path.join(SCHEMA_DIR, file), "utf8")) as object);
  const v = ajv.getSchema(BOM_SCHEMA_ID);
  if (!v) throw new Error("CycloneDX 1.7 schema failed to compile");
  compiled = v;
  return v;
}

export function validateBom(document: unknown): ValidationResult {
  const validate = validator();
  const valid = validate(document) as boolean;
  const errors = valid
    ? []
    : (validate.errors ?? []).slice(0, 25).map((e) => ({ path: e.instancePath || "/", message: `${e.message ?? "invalid"}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`.slice(0, 300) }));
  return { valid, schema: "CycloneDX 1.7 JSON (official schema, vendored)", errors };
}
