# Orchestration

## Subagent model selection

- The lead orchestrator owns decomposition, consequential reasoning, integration, and the final decision.
- Every `spawn_agent` call must explicitly set both `model` and `reasoning_effort`; never rely on inherited defaults.
- Before starting a subagent, announce the selected model and reasoning effort to the user.
- Select the model and reasoning effort from the task's complexity, ambiguity, and risk. Do not apply a blanket capability downgrade.
- Use Luna for narrow, mechanical work such as targeted validation, evidence gathering, or straightforward execution.
- Use Terra for multi-file implementation, debugging, independent review, or any bounded task that still requires nuanced judgment.
- Increase reasoning effort whenever correctness, uncertainty, or impact warrants it; cost is a trade-off, not the primary quality gate.
- Keep each delegated task narrow and evidence-based. Escalate consequential choices and cross-task integration back to the lead orchestrator.
- Resume an existing subagent when its current model and effort still fit the task; otherwise spawn a better-sized replacement.
