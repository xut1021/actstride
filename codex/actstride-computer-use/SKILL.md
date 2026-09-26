---
name: actstride-computer-use
description: Use ActStride bounded fast-model choices and stepwise desktop skills with Codex native Windows Computer Use when the user requests ActStride-assisted desktop operation.
---

# ActStride with native Computer Use

Read the installed official `computer-use` skill and its guidance and confirmations first. It owns Windows input policy. Import `@oai/sky` in `node_repl`; never launch or reconstruct the helper protocol. This skill adds planning guidance and a staged executor, not an internal Codex model-routing hook.

Current Codex is System 2: inspect screenshots, plan, ground candidates, review permissions and verify outcomes. An explicitly configured ActStride `desktopDecider` is System 1. Without it, state that the run is host-only; do not label it dual-model. Respect any user pause on API traffic. Existing API authorization for synthetic pages does not authorize sending personal desktop screenshots or window text to a provider.

## Runtime

Import `scripts/bridge.mjs` relative to this skill's installed directory using an absolute file URL in `node_repl`. It exports `DesktopSession` and `desktopDecider`. Keep the checkout in place when this skill is installed as a junction. See the checkout's `docs/codex-computer-use.md` for examples and verified limits.

Select exactly one window from `sky.list_apps()` or `sky.list_windows()` before constructing `DesktopSession({sky, window, fastDecider?})`. Never invent handles. All native input must run through `node_repl`.

1. Call `session.observe()`, print the returned metadata and stop. Sky displays screenshots automatically. Inspect the result before supplying candidates or indexes. Do not save or re-emit screenshot data.
2. In another cell call `session.propose({revision, task, plan, candidates, useFast})` and print the result. Each candidate has a description and a host-owned action. The narrow action surface is click, type and a few navigation keys. A proposal does not execute anything. Never put unreviewed model-generated actions into candidates.
3. Inspect the returned proposal and its current observation. Apply official permission rules at action time. A `review` string records the host's check; it is not user authorization. If the screen changed or another tool interacted, call `observe()` again and rebuild the proposal.
4. In a separate cell call `session.execute({revision, review})`. It performs exactly one input, immediately refreshes and returns observation metadata. Print that metadata, stop and inspect before continuing. Never wrap observe/propose/execute in an automatic loop.
5. On escalation, missing accessibility data, ambiguous focus, unknown outcome or interruption, return to System 2. Do not retry inputs automatically. If the user stops Computer Use, issue no further input.

The 0.55 selected-probability threshold is an uncalibrated handoff heuristic. It cannot prove safety or task success. Fast errors propagate and must not silently switch providers or spend through a different route.

## Reusable desktop skill

The initial `session.bindDraft(text)` skill targets Notepad only. It creates a new tab, focuses the observed editor, types one single-line draft, and requires verification. It leaves the draft unsaved. Never use this skill for scripts, commands, credentials or third-party transmission.

After binding, `propose` offers the next `skill_step`. At the focus phase, supply `skillTarget` with a click grounded in the latest screenshot/index. At the type phase, supply `focusEvidence` describing the inspected caret or focused editable element. A successful click alone is not proof of focus. Stop if the new tab or editable focus is not visible.

At verification, call `verifyDraft({revision, visualEvidence?})`. Accessible document text must exactly match the draft; if unavailable, inspect the screenshot and describe the visible result. Report this as host visual review, not independent automatic verification. Existing browser ticket/booking/settings skills require DOM controls and are not desktop skills.

## Fast backend

`desktopDecider(options)` wraps the existing ActStride `FastDecider` with desktop-specific instructions. OpenRouter still requires authorized credentials, verified pricing and the existing shared Budget ledger. Local SystemOne uses an independently configured endpoint; screenshots are opt-in via `images:true`. Never read credentials or transmit window data just to activate the skill. The host-only path is available for local integration validation, not as evidence of dual-model speedup.
