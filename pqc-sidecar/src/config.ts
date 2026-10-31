import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),

  SIDECAR_HOST: z.string().default("127.0.0.1"),
  SIDECAR_PORT: z.coerce.number().int().min(0).max(65535).default(8443),
  /** Loopback-only plain-HTTP status endpoint for orchestration and the dashboard. */
  SIDECAR_ADMIN_PORT: z.coerce.number().int().min(0).max(65535).default(8081),

  TLS_KEY_FILE: z.string().min(1),
  TLS_CERT_FILE: z.string().min(1),
  /** CA that issues client certificates for peers. */
  PEER_CA_FILE: z.string().min(1),

  /** The core. Plain HTTP on a private network is the documented prototype boundary. */
  UPSTREAM_URL: z.string().url().default("http://localhost:3000"),
  SECURITY_SERVICE_URL: z.string().url().default("http://localhost:3200"),
  SIDECAR_TOKEN: z.string().min(32),
  SIDECAR_ASSERTION_SECRET: z.string().min(32),

  CONFIG_POLL_MS: z.coerce.number().int().min(250).default(5_000),
  HEARTBEAT_MS: z.coerce.number().int().min(500).default(10_000),
  INITIAL_CONFIG_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  MAX_CONNECTIONS: z.coerce.number().int().min(1).default(200),
  HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
  INSTANCE_ID: z.string().min(1).max(64).optional(),
});

export type SidecarEnv = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SidecarEnv {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
