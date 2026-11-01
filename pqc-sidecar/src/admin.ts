/**
 * The sidecar's loopback admin endpoints, as a pure function so they can be unit-tested without
 * starting a server. Readiness is false until the sidecar has pulled and applied a configuration
 * (it refuses all traffic before that), which is exactly what an orchestrator should gate on.
 */
export interface AdminResponse {
  statusCode: number;
  body: unknown;
}

export function adminResponse(url: string | undefined, status: { ready: boolean }, statusBody: () => unknown): AdminResponse {
  switch (url) {
    case "/healthz":
      return { statusCode: 200, body: { status: status.ready ? "ok" : "starting" } };
    case "/livez":
      return { statusCode: 200, body: { status: "alive" } };
    case "/readyz":
      return { statusCode: status.ready ? 200 : 503, body: { status: status.ready ? "ready" : "starting" } };
    case "/status":
      return { statusCode: 200, body: statusBody() };
    default:
      return { statusCode: 404, body: { error: "not found" } };
  }
}
