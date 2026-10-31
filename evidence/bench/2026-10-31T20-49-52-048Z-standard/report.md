# Handshake benchmark 2026-10-31T20-49-52-048Z-standard

Preset: **standard** · 2026-10-31T20:49:52.048Z · commit 522678c501e2 (dirty working tree)
Host: 12th Gen Intel(R) Core(TM) i5-12500H, 16 logical cores, 16016 MiB, win32 10.0.26200 · Node 26.4.0, OpenSSL 3.5.7

> Single host over loopback. These numbers characterise this implementation in this environment only; they are not production or partner-network latency and support no capacity claim.

## Experiment A: classical (X25519) vs hybrid (X25519MLKEM768) full TLS 1.3 handshakes

| | classical | hybrid |
|---|---|---|
| handshakes (ok / failed) | 9000 / 0 | 9000 / 0 |
| mean ms | 1.89 | 2.19 |
| median ms | 1.84 | 2.14 |
| p95 ms | 2.93 | 3.29 |
| p99 ms | 3.96 | 4.62 |
| std dev ms | 0.69 | 1.04 |
| ClientHello record bytes | 235 | 1411 |
| ServerHello record bytes | 127 | 1215 |
| wire bytes sent / received per handshake | 235 / 831 | 1411 / 1909 |
| configuration mismatches | 0 | 0 |

**H1 (extra bytes):** hybrid adds 1176 B to the ClientHello record and 1088 B to the ServerHello record; 1176 B more sent and 1078 B more received per handshake.

**H2 (extra computation):** paired per-run difference of the median handshake time, hybrid minus classical = 0.265 ms (95% bootstrap CI over 30 runs: 0.153 to 0.384 ms). Verdict: **hybrid-slower**.

## Experiment G: throughput and resource cost

| concurrency | condition | handshakes/s (median) | client CPU ms/hs | server CPU ms/hs | server RSS MiB | failures |
|---|---|---|---|---|---|---|
| 1 | classical | 415.6 | 1.927 | 0.733 | 130.7 | 0 |
| 1 | hybrid | 381.0 | 2.033 | 0.727 | 130.7 | 0 |
| 4 | classical | 438.7 | 2.293 | 0.833 | 131.1 | 0 |
| 4 | hybrid | 418.3 | 2.237 | 0.833 | 130.9 | 0 |
| 16 | classical | 507.3 | 1.980 | 0.623 | 130.7 | 0 |
| 16 | hybrid | 428.6 | 2.347 | 1.043 | 131.0 | 0 |

## Caveats

- Single host over loopback: latencies are not representative of any production or partner network.
- Client and server share one machine's CPU; contention is possible and run-to-run variation is reported, not hidden.
- Handshake timing excludes TCP connection setup and application data.
- Per-handshake CPU time comes from process.cpuUsage(), whose resolution is coarse on some platforms (notably Windows); treat CPU figures as averages over many handshakes, noisy at small sample sizes.
- The results characterise this implementation (Node.js/OpenSSL) in this environment only.
