# Jev + Astra subscription validation

Tested September 26, 2026. Jev used paid OpenRouter Decisions; Astra used the official Codex CLI with an existing ChatGPT login. No OpenRouter Luna calls were made in this evaluation.

| Run (UTC / mode) | Result | Wall seconds | Astra calls | Jev calls | OpenRouter cost |
| --- | --- | ---: | ---: | ---: | ---: |
| 2026-09-26T01-58-40.809Z-codex-dual | PASS | 31.8 | 1 | 12 | $0.00107869 |
| 2026-09-26T02-02-32.208Z-codex-dual | PASS | 41.5 | 1 | 12 | $0.00107667 |
| 2026-09-26T02-03-13.919Z-codex-dual | PASS | 35.5 | 1 | 12 | $0.00107667 |
| 2026-09-26T02-03-49.621Z-codex-s2-only | PASS | 250.4 | 13 | 0 | $0.00000000 |

Dual mode passed 3/3; Astra-only passed 1/1. All attempts are listed. The first dual run was a smoke test before the state-invalidation fix. The remaining two dual runs and the baseline used the corrected verifier and visibility filter.

Mean wall time across the two corrected dual runs: 38.5 seconds. The single Astra-only baseline took 250.4 seconds. These small, sequential samples on one fixed task do not establish general speed or reliability.

The four runs reported $0.00323203 in OpenRouter charges, all from Jev. The one Jev effort-selection request cost another $0.000029862 and was included in the persistent dollar ledger. Astra used subscription allowance; its dollar cost is intentionally not reported as zero or added to the OpenRouter total.

## Subscription route

- CLI 0.156.1, model gpt-6-astra, medium reasoning, ChatGPT authentication confirmed before each run. API-key environment variables are removed from the child. Personal configuration is ignored and there is no paid API fallback.
- Each planner decision starts a fresh ephemeral CLI invocation with read-only permissions, image input and a JSON output schema. Shell tools, apps, hooks and multi-agent delegation are disabled. Observed child events contained only the final action message and usage; no tool executions.
- Windows, Node v24.18.0, headless Edge 153.0.4234.48, 1280×960 viewport. Fresh browser context for every run. Dollar budget remains shared with the original Luna experiment.
- Wall time includes CLI startup, authentication check, inference, screenshots and browser execution. Network and machine load were uncontrolled. This is not a direct inference-latency comparison and is not comparable to the older Luna-only API timings.
- The page visibly states the task and expected SKU. The baseline and dual modes both receive structured controls. This remains a synthetic integration exercise, not a general desktop agent evaluation.

## Regression results

The extended no-API audit passed 33 checks with 0 failures. It exercises mocked HTTP errors, invalid JSON, unknown billing, concurrency, budget exhaustion, invalid actions, bad form inputs, cancellation, stale success state, hidden controls and shifted layouts. Run npm run audit to reproduce it; it does not call paid models.

The stale-PASS defect was reproduced before the fix: changing quantity or selecting a different SKU after a successful submission left the prior hidden result intact. Inputs, selections, filter changes and reopening confirmation now clear that result. Visibility-hidden and opacity-zero controls are excluded from candidate targets. These fixes do not invalidate the original one-shot success runs, which stopped immediately after their first successful confirmation.

All 22 automated tests passed, including the subscription adapter's credential stripping and stopping instead of falling back to an API. The standalone scripted CLI replay also passed with zero model calls. GitHub CI remains unrun because the existing publisher token lacks workflow permission; its disabled template remains available.

## Evidence

astra-validation.json contains sanitized outer-controller events, per-run token counts and current source hashes. The first smoke run predates the two small verifier/visibility fixes, so the current hashes apply to the subsequent runs. Raw CLI logs, login credentials and local machine paths are not published. Account-wide percentage changes include this development session and cannot be attributed solely to the test program.

![Successful corrected Jev + Astra run](astra-success.png)
