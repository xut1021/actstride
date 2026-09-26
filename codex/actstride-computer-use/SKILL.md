---
name: actstride-computer-use
description: Use Astra or the current Codex planner with reusable desktop skills to reduce redundant Computer Use planning and proposal calls. Supports native Windows Notepad drafts; optional fast-model choices require explicit selection.
---

# ActStride with native Computer Use

Read the installed official `computer-use` skill and its guidance and confirmations first. It owns Windows input policy. Import `@oai/sky` in `node_repl`; never launch or reconstruct the helper protocol. This skill adds planning guidance and a staged executor, not an internal Codex model-routing hook.

Current Codex is the planner: inspect screenshots, bind a reusable workflow once, ground its next step and verify outcomes. Default to direct skill execution without Jev or another external decider. Use the current host model; this skill cannot switch it to Astra. Call it Astra only when that model is actually in use. An explicitly configured `desktopDecider` remains available for requested comparisons. Respect any user pause on API traffic. Existing API authorization for synthetic pages does not authorize sending personal desktop screenshots or window text to a provider.

## Runtime

Import `scripts/bridge.mjs` relative to this skill's installed directory using an absolute file URL in `node_repl`. It exports `DesktopSession` and `desktopDecider`. Keep the checkout in place when this skill is installed as a junction. See the checkout's `docs/codex-computer-use.md` for examples and verified limits.

Select exactly one window from `sky.list_apps()` or `sky.list_windows()` before constructing `DesktopSession({sky, window, fastDecider?})`. Never invent handles. All native input must run through `node_repl`.

## Default: plan once, advance the bound draft directly

The native API still requires inspecting each refreshed screenshot. Reuse the bound skill instead of replanning its sequence or making a separate proposal call for each action. This is a multi-step workflow advanced one input per cell, not unattended multi-action execution. Other apps currently use the official Computer Use workflow; do not present the synthetic UIA form skills as installed native skills.

1. Call `session.observe()`, print its metadata and stop to inspect the displayed screenshot. Bind `session.bindDraft(text)` once for an authorized short, single-line, unsaved Notepad draft.
2. In the next cell call `session.advanceDraft({revision, skillTarget, review})` for `new_tab`. Supply a click on the observed new-tab button. Prefer this to the Ctrl+N shortcut that failed in a previous native run. Print the returned metadata and stop to inspect.
3. For `focus`, pass a newly grounded editor click plus `newTabEvidence` describing the observed new empty tab. For `type`, pass `focusEvidence` describing the currently observed caret or editable focus. Each `advanceDraft` performs exactly one input and refresh. It never calls the fast model; the draft text and phase are retained.
4. At `verify`, inspect the result and call `verifyDraft({revision, visualEvidence?})`. A visual check is host review, not an independent automated assertion. No save or send is part of this skill.

`review`, `newTabEvidence` and `focusEvidence` record host inspection, not permission grants. Apply the official action-time rules. Stop on an unexpected modal, wrong focus, mismatch or user interruption. Reobserve after external interaction; never automate this sequence with a loop. Do not retry unknown input outcomes. The direct path reduces proposal round trips; native wall-clock speedup still needs a paired measurement.

## Optional: staged proposals and fast-model comparison

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
