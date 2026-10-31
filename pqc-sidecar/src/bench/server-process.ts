import { constants } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

/**
 * Benchmark TLS server, run as a SEPARATE process so the server's CPU work and event loop do not
 * share a thread with the measuring client. It accepts connections, completes the handshake and
 * hangs up. Controlled over IPC: { type: "start", keyPem, certPem, groups } -> { type: "listening", port },
 * { type: "cpu" } -> { type: "cpu", user, system, rss, handshakes }, { type: "stop" }.
 */
type Message =
  | { type: "start"; keyPem: string; certPem: string; groups: string }
  | { type: "cpu" }
  | { type: "stop" };

let server: tls.Server | undefined;
let handshakes = 0;

process.on("message", (message: Message) => {
  if (message.type === "start") {
    server = tls.createServer(
      {
        key: message.keyPem,
        cert: message.certPem,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        ecdhCurve: message.groups,
        // Full handshakes only: no session tickets, so nothing can be resumed.
        secureOptions: constants.SSL_OP_NO_TICKET,
      },
      (socket) => {
        handshakes += 1;
        socket.on("error", () => {});
        socket.end();
      },
    );
    server.on("tlsClientError", () => {});
    server.listen(0, "127.0.0.1", () => {
      process.send?.({ type: "listening", port: (server!.address() as net.AddressInfo).port });
    });
  } else if (message.type === "cpu") {
    const cpu = process.cpuUsage();
    process.send?.({ type: "cpu", user: cpu.user, system: cpu.system, rss: process.memoryUsage().rss, handshakes });
  } else if (message.type === "stop") {
    server?.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }
});
