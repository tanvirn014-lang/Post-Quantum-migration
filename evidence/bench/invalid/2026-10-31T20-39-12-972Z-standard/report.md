# Handshake benchmark 2026-10-31T20-39-12-972Z-standard

Preset: **standard** · 2026-10-31T20:39:12.972Z · commit a89f2afb9d33
Host: 12th Gen Intel(R) Core(TM) i5-12500H, 16 logical cores, 16016 MiB, win32 10.0.26200 · Node 26.4.0, OpenSSL 3.5.7

> Single host over loopback. These numbers characterise this implementation in this environment only; they are not production or partner-network latency and support no capacity claim.

## Experiment A: classical (X25519) vs hybrid (X25519MLKEM768) full TLS 1.3 handshakes

| | classical | hybrid |
|---|---|---|
| handshakes (ok / failed) | 6539 / 2461 | 6666 / 2334 |
| mean ms | 1.55 | 1.75 |
| median ms | 1.30 | 1.48 |
| p95 ms | 2.51 | 2.75 |
| p99 ms | 3.08 | 3.46 |
| std dev ms | 0.55 | 0.86 |
| ClientHello record bytes | 235 | 1411 |
| ServerHello record bytes | 127 | 1215 |
| wire bytes sent / received per handshake | 235 / 833 | 1411 / 1911 |
| configuration mismatches | 0 | 0 |

**H1 (extra bytes):** hybrid adds 1176 B to the ClientHello record and 1088 B to the ServerHello record; 1176 B more sent and 1078 B more received per handshake.

**H2 (extra computation):** paired per-run difference of the median handshake time, hybrid minus classical = n/a ms (95% bootstrap CI over 30 runs: n/a to n/a ms). Verdict: **not-distinguishable**.

## Experiment G: throughput and resource cost

| concurrency | condition | handshakes/s (median) | client CPU ms/hs | server CPU ms/hs | server RSS MiB | failures |
|---|---|---|---|---|---|---|
| 1 | classical | 1.6 | 4.063 | 0.000 | 68.3 | 893 |
| 1 | hybrid | 0.8 | 3.957 | 0.000 | 68.3 | 897 |
| 4 | classical | 0.0 | 4.063 | 0.000 | 68.3 | 900 |
| 4 | hybrid | 0.0 | 4.320 | 0.000 | 68.3 | 898 |
| 16 | classical | 0.0 | 3.803 | 0.000 | 68.3 | 900 |
| 16 | hybrid | 0.7 | 4.013 | 0.000 | 68.3 | 897 |

## Caveats

- Single host over loopback: latencies are not representative of any production or partner network.
- Client and server share one machine's CPU; contention is possible and run-to-run variation is reported, not hidden.
- Handshake timing excludes TCP connection setup and application data.
- Per-handshake CPU time comes from process.cpuUsage(), whose resolution is coarse on some platforms (notably Windows); treat CPU figures as averages over many handshakes, noisy at small sample sizes.
- The results characterise this implementation (Node.js/OpenSSL) in this environment only.
