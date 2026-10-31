# Invalid benchmark runs (kept for transparency, not evidence)

`2026-10-31T20-39-12-972Z-standard` - **invalid.** From run 21 of 30 onward, and at every throughput point,
connections failed (2461 classical and 2334 hybrid handshakes of 9000 each). The cause is exhaustion of the
Windows ephemeral port range (13,977 dynamic ports) after about 14,000 connections to a single destination
port: the first 21 runs are clean, every later run fails. The latency and throughput statistics in that run's
report are therefore not representative and must not be quoted.

The harness was fixed (the benchmark server now listens on 32 ports and handshakes rotate over them) and now
refuses to publish any run whose failure rate exceeds 0.5% (`assessValidity`). The invalid run was published to
the security-service before this check existed; evidence rows there are immutable, so the API flags it as
invalid instead (derived from its own failure counts).
