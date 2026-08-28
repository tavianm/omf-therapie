---
objective: "The Stripe mock webhook GET route is unusable outside Vite development mode and remains type-safe."
status: implemented
---

# Plan: Secure the Stripe mock webhook

## Overview

| Field      | Value |
| ---------- | ----- |
| **Goal**   | Restrict the unauthenticated mock payment endpoint to explicit local development mode. |
| **Source** | GitHub issue [#70](https://github.com/tavianm/omf-therapie/issues/70) |

## Phases

| #   | Phase | File |
| --- | ----- | ---- |
| 1   | Gate and verify the mock webhook | [`phase-1.md`](./phase-1.md) |
