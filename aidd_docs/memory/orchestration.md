# Orchestration

## Subagent sizing

- The lead orchestrator owns decomposition, consequential reasoning, integration, and the final decision.
- Every `spawn_agent` call must explicitly set both `model` and `reasoning_effort`; never rely on inherited defaults.
- Select a less capable, lower-cost model and the lowest reasoning effort sufficient for the bounded delegated task.
- Before starting a subagent, announce the selected model and reasoning effort to the user.
- Keep each delegated task narrow and evidence-based. Escalate consequential choices and cross-task integration back to the lead orchestrator.
- Do not restart an older subagent that was created without explicit sizing. Spawn a replacement with explicit `model` and `reasoning_effort` instead.
