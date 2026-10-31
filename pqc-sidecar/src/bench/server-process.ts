import { constants } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

/**
 * Benchmark TLS server, run as a SEPARATE process so the server's CPU work and event loop do not
 * share a thread with the measuring client. It accepts connections, completes the handshake and
 * hangs up. It listens on `listeners` ports (default 1) with identical configuration; spreading connections over
 * several destination ports keeps a long run from exhausting the client's ephemeral ports (each port has its own
 * TIME_WAIT tuple space). Controlled over IPC: { type: "start", keyPem, certPem, groups, listeners? } ->
 * { type: "listening", port, ports },
 * { type: "cpu" } -> { type: "cpu", user, system, rss, handshakes }, { type: "stop" }.
 */
type Message =
  | { type: "start"; keyPem: string; certPem: string; groups: string; listeners?: number }
  | { type: "cpu" }
  | { type: "stop" };

const servers: tls.Server[] = [];
let handshakes = 0;

process.on("message", (message: Message) => {
  if (message.type === "start") {
    const options: tls.TlsOptions = {
      key: message.keyPem,
      cert: message.certPem,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ecdhCurve: message.groups,
      // Full handshakes only: no session tickets, so nothing can be resumed.
      secureOptions: constants.SSL_OP_NO_TICKET,
    };
    const count = Math.max(1, Math.min(message.listeners ?? 1, 256));
    const listening = Array.from({ length: count }, () => {
      const server = tls.createServer(options, (socket) => {
        handshakes += 1;
        socket.on("error", () => {});
        socket.end();
      });
      server.on("tlsClientError", () => {});
      servers.push(server);
      return new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
    });
    void Promise.all(listening).then((ports) => process.send?.({ type: "listening", port: ports[0], ports }));
  } else if (message.type === "cpu") {
    const cpu = process.cpuUsage();
    process.send?.({ type: "cpu", user: cpu.user, system: cpu.system, rss: process.memoryUsage().rss, handshakes });
  } else if (message.type === "stop") {
    for (const server of servers) server.close();
    setTimeout(() => process.exit(0), 300).unref();
  }
});
