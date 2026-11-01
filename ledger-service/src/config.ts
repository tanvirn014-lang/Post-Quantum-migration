import { z } from "zod";

const boolString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    LEDGER_STORE: z.enum(["memory", "postgres"]).default("memory"),
    DATABASE_URL: z.string().optional(),
    PG_POOL_MAX: z.coerce.number().int().min(1).default(10),

    /** Comma-separated explicit allow-list. Never a wildcard: credentials are in play. */
    CORS_ORIGIN: z.string().default("http://localhost:3100"),

    JWT_PRIVATE_KEY_FILE: z.string().optional(),
    JWT_PRIVATE_KEY: z.string().optional(),
    /** Comma-separated SPKI PEM file paths of PREVIOUS JWT public keys, kept in the JWKS for
     *  verification during a signing-key rotation window. Remove a key once accessTokenTtl has
     *  elapsed since the rotation (no unexpired token can still carry it). */
    JWT_ADDITIONAL_PUBLIC_KEY_FILES: z.string().optional(),

    /** base64url 32-byte master key for envelope-encrypting PII (customers.full_name) at rest.
     *  Unset = stored in the clear (dev). Production should supply a real KMS/HSM via a KMS adapter;
     *  enabling it on a DB with existing plaintext rows needs a one-off migration. */
    KMS_MASTER_KEY: z.string().optional(),
    /** Comma-separated base64url PREVIOUS master keys, retained for decryption during a KMS rotation. */
    KMS_PREVIOUS_MASTER_KEYS: z.string().optional(),
    JWT_ISSUER: z.string().default("pq-bank-ledger-service"),
    JWT_AUDIENCE: z.string().default("pq-bank-platform"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    COOKIE_SECURE: boolString.optional(),

    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),

    /** Shared with pqc-sidecar; the core only accepts partner traffic carrying a valid HMAC
     *  assertion made with this secret. Unset disables the partner API entirely. */
    SIDECAR_ASSERTION_SECRET: z.string().min(32).optional(),

    /** Base URL of the hosted Supabase project (e.g. https://<ref>.supabase.co). When set, the
     *  core also accepts Supabase-issued access tokens (verified against the project's public
     *  JWKS) and provisions a local customer for them. Unset disables the add-on entirely. */
    SUPABASE_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    /** Expected `aud` claim on Supabase access tokens. Supabase user tokens use "authenticated". */
    SUPABASE_AUDIENCE: z.string().default("authenticated"),
    /** Whether a verified Supabase identity with no matching local customer is auto-provisioned.
     *  Off by default (secure): an unseen identity is refused unless an operator pre-created the
     *  customer (then it is linked). The sign-up demo sets this true. */
    SUPABASE_AUTO_PROVISION: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.LEDGER_STORE === "postgres" && !env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "required when LEDGER_STORE=postgres" });
    }
    if (env.NODE_ENV === "production" && env.LEDGER_STORE === "memory") {
      ctx.addIssue({ code: "custom", path: ["LEDGER_STORE"], message: "the memory store is not allowed in production" });
    }
    if (env.NODE_ENV === "production" && !env.JWT_PRIVATE_KEY_FILE && !env.JWT_PRIVATE_KEY) {
      ctx.addIssue({ code: "custom", path: ["JWT_PRIVATE_KEY_FILE"], message: "a signing key is required in production" });
    }
    if (env.CORS_ORIGIN.split(",").some((o) => o.trim() === "*")) {
      ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: "wildcard origins are not allowed" });
    }
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  ledgerStore: "memory" | "postgres";
  databaseUrl: string | undefined;
  pgPoolMax: number;
  corsOrigins: string[];
  jwtPrivateKeyFile: string | undefined;
  jwtPrivateKey: string | undefined;
  jwtAdditionalPublicKeyFiles: string[];
  kmsMasterKey: string | undefined;
  kmsPreviousMasterKeys: string[];
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  cookieSecure: boolean;
  rateLimitMax: number;
  loginRateLimitMax: number;
  loginMaxFailedAttempts: number;
  loginLockMinutes: number;
  sidecarAssertionSecret: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAudience: string;
  supabaseAutoProvision: boolean;
}

/** Parses and validates the environment once, at startup. Throws a readable error listing
 *  every problem so a misconfigured deployment fails fast instead of at first request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    ledgerStore: e.LEDGER_STORE,
    databaseUrl: e.DATABASE_URL,
    pgPoolMax: e.PG_POOL_MAX,
    corsOrigins: e.CORS_ORIGIN.split(",").map((o) => o.trim()).filter((o) => o.length > 0),
    jwtPrivateKeyFile: e.JWT_PRIVATE_KEY_FILE,
    jwtPrivateKey: e.JWT_PRIVATE_KEY,
    jwtAdditionalPublicKeyFiles: e.JWT_ADDITIONAL_PUBLIC_KEY_FILES
      ? e.JWT_ADDITIONAL_PUBLIC_KEY_FILES.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : [],
    kmsMasterKey: e.KMS_MASTER_KEY,
    kmsPreviousMasterKeys: e.KMS_PREVIOUS_MASTER_KEYS
      ? e.KMS_PREVIOUS_MASTER_KEYS.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : [],
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    rateLimitMax: e.RATE_LIMIT_MAX,
    loginRateLimitMax: e.LOGIN_RATE_LIMIT_MAX,
    loginMaxFailedAttempts: e.LOGIN_MAX_FAILED_ATTEMPTS,
    loginLockMinutes: e.LOGIN_LOCK_MINUTES,
    sidecarAssertionSecret: e.SIDECAR_ASSERTION_SECRET,
    supabaseUrl: e.SUPABASE_URL,
    supabaseAudience: e.SUPABASE_AUDIENCE,
    supabaseAutoProvision: e.SUPABASE_AUTO_PROVISION,
  };
}

/** A fully-populated config for tests; individual tests override what they care about. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({ NODE_ENV: "test" }),
    corsOrigins: ["http://localhost:3100"],
    ...overrides,
  };
}
