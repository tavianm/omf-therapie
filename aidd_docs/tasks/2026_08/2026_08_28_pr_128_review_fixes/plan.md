---
objective: "The local mock-payment journey requires an explicit request capability, remains usable in development, and has complete route coverage."
status: implemented
---

# Plan: Address PR 128 security review

## Overview

| Field | Value |
| --- | --- |
| **Goal** | Close the residual mock-payment authorization gap and prove every GET branch. |
| **Source** | [PR #128 code-review comment](https://github.com/tavianm/omf-therapie/pull/128#issuecomment-5456323682) |

## Phases

| # | Phase | File |
| --- | --- | --- |
| 1 | Authorize and verify local mock payments | [`phase-1.md`](./phase-1.md) |

## Decisions

| Decision | Why |
| --- | --- |
| Require a local-only capability token and loopback host | `DEV` and an environment flag identify a mode, but do not authorize an individual mutating request or prevent localhost CSRF. |
| Fail closed outside Astro development for every calendar mock reader | A leaked calendar flag must not activate fictional availability or bypass cache behavior in a deployed build. |
