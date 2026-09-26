# Model backends and billing

Default: paid Jev decisions with the ChatGPT-authenticated Codex planner. The OpenRouter-only planner is opt-in. Exact model IDs below describe configuration, not a requirement of the architecture.

System 1 can instead use a loopback SystemOne server. See [fast backends](fast-backends.md) for Laya/Kev text protocols, the OpenJev Multimodal image extension, input limits, and validation status. Select `--fast-provider systemone --fast-endpoint http://127.0.0.1:8000/v1/systemone`; add `--fast-images` only for an image-capable server. `--fast MODEL` is optional and cannot switch Kev's loaded checkpoint. With the default Codex planner this route does not require an OpenRouter key or touch its ledger. An optional `FAST_API_KEY` is sent only to that local endpoint and stripped from the Codex child process. Self-hosted usage is recorded with unknown cost, not as free inference.

## Run the real models

Set `OPENROUTER_API_KEY` in the process environment using your preferred secret manager. `.env` files are not automatically loaded. Do not paste keys into issues, command arguments, or source code.

### Jev + Astra using your Codex plan

Install the official Codex CLI if needed, run `codex login`, and verify that `codex login status` says **Logged in using ChatGPT**. This integration was tested with CLI 0.156.1. It requires that version's `--ignore-user-config`, image input and structured-output support. Older unsupported CLIs fail instead of silently changing the billing route.

```sh
npm start -- --planner-provider codex --mode dual --budget 5
npm start -- --planner-provider codex --mode s2-only
```

The first command pays only for Jev on OpenRouter and uses `gpt-6-astra` with medium reasoning via Codex for planning. The second uses Astra for every step and needs no OpenRouter key. Add `--headless --channel msedge` for unattended Edge. The CLI creates one ephemeral, read-only Codex invocation for each planner decision and receives a screenshot plus structured state. Shell tools, apps, hooks and delegation are disabled for that invocation; an unexpected tool event rejects the result. Launch overhead is included in timings.

API-key authentication is rejected. API-key environment variables are removed from the Codex child process, personal configuration is not loaded, and there is no fallback to a paid OpenAI/OpenRouter planner. If authentication, quota or the CLI fails, the run stops. Logs record Codex tokens separately: `cost_usd` covers **OpenRouter only**, not a dollar estimate of subscription usage. Account-wide weekly usage also includes your other Codex work.

See the [Astra validation record](astra-validation.md). The [official authentication documentation](https://learn.chatgpt.com/docs/auth) explains the ChatGPT/API billing distinction, and the [non-interactive guide](https://learn.chatgpt.com/docs/non-interactive-mode) documents structured outputs.

### Jev + Luna using OpenRouter only

```sh
npm start -- --planner-provider openrouter --mode dual --budget 5
npm start -- --planner-provider openrouter --mode s2-only --budget 5
```

For headless Edge: append `--headless --channel msedge`. Both modes use a fresh isolated browser, the same task, action executor, observation data and verifier. `dual` uses `typesafe/jev-1.13` through OpenRouter's **Decisions API**, plus `openai/gpt-6-luna` through Chat Completions. `s2-only` calls Luna for every step. There is no third model. Model IDs must be available to your OpenRouter account; the program fails if current metadata cannot be verified.

Live runs share a persistent `runs/budget.json` spending limit. **Five dollars is a ceiling, not a target.** The controller reserves a conservative whole-context cost before each request, accounts for reported `usage.cost`, runs one request at a time and performs no automatic retries. Chat requests also set provider price ceilings. The Decisions endpoint uses current endpoint metadata for its reservation; it has no verified per-request price ceiling here. This is client-side accounting dependent on provider metadata and billing, not a provider-enforced dollar cap. Use a separately limited OpenRouter key if you need an account-side limit.

Missing billing, HTTP errors or interrupted requests retain the reservation and block subsequent spending. Reconcile the charge in OpenRouter before adjusting an unsettled ledger. Do not delete the ledger to bypass its limit. Do not run separate copies against a shared spending allowance: the lock and ledger apply to this checkout only.
