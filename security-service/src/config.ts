import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3200),

  DATABASE_URL: z.string().min(1),
  PG_POOL_MAX: z.coerce.number().int().min(1).default(10),

  /** Comma-separated explicit allow-list of browser origins. Wildcards are rejected. */
  CORS_ORIGIN: z.string().default("http://localhost:3100"),

  /** Where access tokens are verified: ledger-service publishes its public key here. */
  JWKS_URL: z.string().url().default("http://localhost:3000/.well-known/jwks.json"),
  JWT_ISSUER: z.string().default("pq-bank-ledger-service"),
  JWT_AUDIENCE: z.string().default("pq-bank-platform"),

  /** Bearer tokens for the machine-to-machine /internal APIs. Separate tokens per principal. */
  SIDECAR_TOKEN: z.string().min(32),
  BENCH_TOKEN: z.string().min(32).optional(),

  /** Peer simulator (scenario runner). Both must be set to enable experiment runs from the API. */
  PEER_SIM_URL: z.string().url().optional(),
  PEER_SIM_TOKEN: z.string().min(32).optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /** A sidecar whose last heartbeat is older than this is reported as stale. */
  SIDECAR_STALE_SECONDS: z.coerce.number().int().min(5).default(45),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  pgPoolMax: number;
  corsOrigins: string[];
  jwksUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  sidecarToken: string;
  benchToken: string | undefined;
  peerSimUrl: string | undefined;
  peerSimToken: string | undefined;
  rateLimitMax: number;
  sidecarStaleSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;
  const origins = e.CORS_ORIGIN.split(",").map((o) => o.trim()).filter((o) => o.length > 0);
  if (origins.includes("*")) throw new Error("Invalid configuration:\n  - CORS_ORIGIN: wildcard origins are not allowed");
  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgPoolMax: e.PG_POOL_MAX,
    corsOrigins: origins,
    jwksUrl: e.JWKS_URL,
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    sidecarToken: e.SIDECAR_TOKEN,
    benchToken: e.BENCH_TOKEN,
    peerSimUrl: e.PEER_SIM_URL,
    peerSimToken: e.PEER_SIM_TOKEN,
    rateLimitMax: e.RATE_LIMIT_MAX,
    sidecarStaleSeconds: e.SIDECAR_STALE_SECONDS,
  };
}
