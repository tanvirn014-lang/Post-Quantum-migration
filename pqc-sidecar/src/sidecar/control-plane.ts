import type { Logger } from "pino";
import { z } from "zod";
import type { ConnectionEventPayload, EventSink, SidecarConfigPayload } from "./types.js";

const configSchema = z.object({
  version: z.number().int().min(1),
  tlsProfile: z.object({ name: z.string().min(1), groups: z.array(z.string().min(1)).min(1).max(4), description: z.string() }),
  peers: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      certSha256: z.string().regex(/^[0-9a-f]{64}$/),
      profile: z.enum(["hybrid-required", "classical-allowed"]),
      enabled: z.boolean(),
    }),
  ),
  generatedAt: z.string(),
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ControlPlaneOptions {
  baseUrl: string;
  token: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Pulls the configuration the sidecar must enforce. Conditional GET on the version ETag keeps
 * polling cheap. If the control plane is unreachable the sidecar keeps enforcing the last
 * configuration it applied (fail-static); it never starts accepting connections without one.
 */
export class ConfigClient {
  private etag: string | undefined;
  consecutiveFailures = 0;
  lastSuccessAt: Date | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly opts: ControlPlaneOptions,
    private readonly onConfig: (cfg: SidecarConfigPayload) => { applied: boolean; error?: string },
  ) {}

  /** One poll. Returns true if a new configuration was fetched and applied. */
  async pollOnce(): Promise<boolean> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(new URL("/internal/v1/sidecar-config", this.opts.baseUrl), {
        headers: { ...authHeaders(this.opts.token), ...(this.etag ? { "if-none-match": this.etag } : {}) },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
      });
      if (res.status === 304) {
        this.markSuccess();
        return false;
      }
      if (!res.ok) throw new Error(`control plane answered ${res.status}`);
      const cfg = configSchema.parse(await res.json());
      const result = this.onConfig(cfg);
      this.markSuccess();
      if (result.applied) {
        this.etag = res.headers.get("etag") ?? undefined;
        return true;
      }
      return false;
    } catch (err) {
      this.consecutiveFailures += 1;
      this.opts.logger.warn({ error: (err as Error).message, consecutiveFailures: this.consecutiveFailures }, "config poll failed; keeping the last applied configuration");
      return false;
    }
  }

  private markSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = new Date();
  }

  /** Blocks until a first configuration has been applied (the sidecar must not listen before). */
  async waitForInitialConfig(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (let delay = 250; ; delay = Math.min(delay * 2, 4_000)) {
      if (await this.pollOnce()) return;
      if (this.lastSuccessAt && !this.etag) throw new Error("control plane returned a configuration the sidecar cannot apply");
      if (Date.now() >= deadline) throw new Error("timed out waiting for the initial configuration from the control plane");
      await sleep(delay);
    }
  }

  start(intervalMs: number): void {
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      await this.pollOnce();
      this.timer = setTimeout(() => void tick(), intervalMs);
    };
    this.timer = setTimeout(() => void tick(), intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * Batches connection events and ships them to the control plane. Events are idempotent on
 * their id, so a retried batch is safe. The queue is bounded: under a prolonged outage the
 * oldest events are dropped (and counted) rather than exhausting memory.
 */
export class TelemetryClient implements EventSink {
  private queue: ConnectionEventPayload[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;
  private backoffMs = 0;
  dropped = 0;
  sent = 0;
  failures = 0;

  constructor(
    private readonly opts: ControlPlaneOptions & { maxQueue?: number; flushIntervalMs?: number; batchSize?: number },
  ) {}

  get queued(): number {
    return this.queue.length;
  }

  emit(event: ConnectionEventPayload): void {
    this.queue.push(event);
    const max = this.opts.maxQueue ?? 5_000;
    if (this.queue.length > max) {
      const overflow = this.queue.length - max;
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
    if (this.queue.length >= (this.opts.batchSize ?? 50)) void this.flush();
  }

  start(): void {
    const interval = this.opts.flushIntervalMs ?? 1_000;
    const tick = async (): Promise<void> => {
      await this.flush();
      this.timer = setTimeout(() => void tick(), Math.max(interval, this.backoffMs));
    };
    this.timer = setTimeout(() => void tick(), interval);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, 100);
        const res = await fetchImpl(new URL("/internal/v1/events/connections", this.opts.baseUrl), {
          method: "POST",
          headers: { ...authHeaders(this.opts.token), "content-type": "application/json" },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) throw new Error(`control plane answered ${res.status}`);
        this.queue.splice(0, batch.length);
        this.sent += batch.length;
        this.backoffMs = 0;
      }
    } catch (err) {
      this.failures += 1;
      this.backoffMs = Math.min((this.backoffMs || 1_000) * 2, 30_000);
      this.opts.logger.warn({ error: (err as Error).message, queued: this.queue.length, backoffMs: this.backoffMs }, "telemetry flush failed; will retry");
    } finally {
      this.flushing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
  }
}

export interface HeartbeatBody {
  instanceId: string;
  startedAt: string;
  appliedConfigVersion: number;
  activeProfile: string;
  runtime: Record<string, unknown>;
  listener: Record<string, unknown>;
  counters: Record<string, unknown>;
}

export async function sendHeartbeat(opts: ControlPlaneOptions, body: HeartbeatBody): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(new URL("/internal/v1/sidecar/heartbeat", opts.baseUrl), {
      method: "POST",
      headers: { ...authHeaders(opts.token), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    return res.ok;
  } catch (err) {
    opts.logger.warn({ error: (err as Error).message }, "heartbeat failed");
    return false;
  }
}
