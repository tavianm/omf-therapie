# Availability golden fixtures — provenance (SC4)

The `expected` games in `*.json` are captured from the PRE-refactor
availability implementation. This record pins the exact source revision and
the reproducible capture command so the oracle's origin is verifiable —
regenerating from the refactored implementation would be circular and is NOT
what this records.

- **Source revision:** `417309d` (`417309d1fa05c7d2c5b65c069159795442c22e63`) — pre-refactor
  `getAvailableSlots` (the commit that introduced these fixtures; the batch
  / derivation refactor of #153 landed strictly after it).
- **Capture command:** `node scripts/capture-availability-fixtures.mjs --rev 417309d`
- **Last verified:** 2026-09-13T11:26:14.223Z
- **Result:** regenerated games are IDENTICAL to the committed fixtures (bit-for-bit expected blocks) — provenance confirmed.

## Fixture digests (post-run)

| Fixture | sha256 |
|---------|--------|
| `manual-slots-week.json` | `2188021896e8dc9c6761d59ae4fe319ab3369f40e876fc9844b52070bdb79667` |
| `partial-busy-overlaps.json` | `08b42bb36cd2e50fef6acf1953c2ac166e6fc2250bc3391bbbc937dca64020c0` |
| `dst-transition-week.json` | `fd8e5b022157f1117e105a60d23b0f925181a09dcf1f2055089c93c0a575fec4` |
| `mock-mode.json` | `65832008fc8ac0046c83b1f36c7dab44851d8edd7e8602135e6360739d487d50` |
