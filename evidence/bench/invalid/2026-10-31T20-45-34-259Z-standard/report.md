# Handshake benchmark 2026-10-31T20-45-34-259Z-standard

> **INVALID RUN - not evidence.** throughput concurrency 1 classical: 7 failures; throughput concurrency 16 classical: 1 failures; throughput concurrency 16 hybrid: 3 failures

Preset: **standard** · 2026-10-31T20:45:34.259Z · commit 522678c501e2
Host: 12th Gen Intel(R) Core(TM) i5-12500H, 16 logical cores, 16016 MiB, win32 10.0.26200 · Node 26.4.0, OpenSSL 3.5.7

> Single host over loopback. These numbers characterise this implementation in this environment only; they are not production or partner-network latency and support no capacity claim.

## Experiment A: classical (X25519) vs hybrid (X25519MLKEM768) full TLS 1.3 handshakes

| | classical | hybrid |
|---|---|---|
| handshakes (ok / failed) | 8993 / 7 | 8989 / 11 |
| mean ms | 1.37 | 1.54 |
| median ms | 1.31 | 1.46 |
| p95 ms | 1.83 | 1.96 |
| p99 ms | 2.37 | 2.45 |
| std dev ms | 0.33 | 0.49 |
| ClientHello record bytes | 235 | 1411 |
| ServerHello record bytes | 127 | 1215 |
| wire bytes sent / received per handshake | 235 / 832 | 1411 / 1910 |
| configuration mismatches | 0 | 0 |

**H1 (extra bytes):** hybrid adds 1176 B to the ClientHello record and 1088 B to the ServerHello record; 1176 B more sent and 1078 B more received per handshake.

**H2 (extra computation):** paired per-run difference of the median handshake time, hybrid minus classical = 0.156 ms (95% bootstrap CI over 30 runs: 0.140 to 0.172 ms). Verdict: **hybrid-slower**.

## Experiment G: throughput and resource cost

| concurrency | condition | handshakes/s (median) | client CPU ms/hs | server CPU ms/hs | server RSS MiB | failures |
|---|---|---|---|---|---|---|
| 1 | classical | 208.9 | 4.583 | 0.730 | 101.9 | 7 |
| 1 | hybrid | 208.9 | 4.377 | 0.883 | 90.9 | 0 |
| 4 | classical | 221.5 | 4.477 | 0.577 | 93.9 | 0 |
| 4 | hybrid | 221.9 | 4.427 | 0.937 | 96.8 | 0 |
| 16 | classical | 126.3 | 7.713 | 1.147 | 99.2 | 1 |
| 16 | hybrid | 223.5 | 4.117 | 0.780 | 99.5 | 3 |

## Caveats

- Single host over loopback: latencies are not representative of any production or partner network.
- Client and server share one machine's CPU; contention is possible and run-to-run variation is reported, not hidden.
- Handshake timing excludes TCP connection setup and application data.
- Per-handshake CPU time comes from process.cpuUsage(), whose resolution is coarse on some platforms (notably Windows); treat CPU figures as averages over many handshakes, noisy at small sample sizes.
- The results characterise this implementation (Node.js/OpenSSL) in this environment only.
