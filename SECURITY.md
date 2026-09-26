# Data and execution boundary

This prototype is intended only for its bundled synthetic task. The isolated browser receives that HTML locally; other browser requests and WebSockets are blocked. OpenRouter receives the synthetic task, visible page text and controls, action history, and (for Luna) screenshots. The API key is read from the process environment and is not intentionally logged. Do not adapt this to personal pages without reviewing data handling.

The model cannot execute JavaScript or shell commands. Coordinates, keys and text are validated, typed text replaces only a focused non-password input, and popups are closed. These restrictions are not a complete security boundary against arbitrary untrusted web content. Playwright and Node run with the permissions of their host process.

`runs/` and `.env` are ignored by Git. Check artifacts before sharing them. The shared budget ledger and lock apply within one checkout only. Provider metadata and billing remain external dependencies; a client-side limit is not equivalent to a provider-enforced key limit. Unknown charges stop execution rather than retrying.

Do not publish API keys in bug reports. For reproducible bugs, share a sanitized report and synthetic inputs only.

The optional Codex planner invokes the official CLI with ChatGPT authentication and refuses API-key login. API-key environment variables are stripped from the child, and its invocation ignores personal configuration and disables shell tools, apps, hooks and delegation. It receives the synthetic screenshot and control state only. Raw CLI events and generated files stay under ignored `runs/`; inspect them before sharing. This route uses your subscription allowance and has no automatic API fallback. Subscription usage is separate from the OpenRouter dollar ledger.
