// Build choices from fresh visible controls, never from the task's correct answer.
export function candidatesFor(ui, textValues = []) {
  if (!ui || !Array.isArray(ui.controls)) throw Error('Fresh UI structure is required for System 1');
  const choices = {};
  for (const c of ui.controls) {
    choices[`click_${c.index}`] = {
      description: `Click ${c.tag} ${JSON.stringify(c.label)}; value=${JSON.stringify(c.value)}; context=${c.context || ''}`,
      action: { action: 'click', ...(c.ref ? { ref: c.ref, revision: c.revision } : { x: c.x, y: c.y }), reason: `Click ${c.label}` },
    };
    if (c.ref && c.tag === 'select') for (const [i, option] of c.options.entries()) {
      if (!option.disabled && option.value !== c.value) choices[`select_${c.index}_${i}`] = {
        description: `Set ${JSON.stringify(c.label)} to option ${JSON.stringify(option.label)}`,
        action: { action: 'select', ref: c.ref, revision: c.revision, value: option.value, reason: `Set ${c.label}=${option.label}` },
      };
    }
    if (c.ref && c.tag === 'input') textValues.forEach((text, i) => {
      if (text !== c.value) choices[`fill_${c.index}_${i}`] = {
        description: `Fill input ${JSON.stringify(c.label)} with ${JSON.stringify(text)}`,
        action: { action: 'fill', ref: c.ref, revision: c.revision, text, reason: `Fill ${c.label}` },
      };
    });
  }
  if (ui.focused?.tag === 'input') {
    textValues.forEach((text, i) => {
      if (text !== ui.focused.value) choices[`type_${i}`] = {
        description: `Replace the focused input ${JSON.stringify(ui.focused.label)} value with ${JSON.stringify(text)}`,
        action: { action: 'type', text, reason: `Fill ${ui.focused.label}` },
      };
    });
  }
  if (ui.focused?.tag === 'select') {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape']) choices[`key_${key}`] = {
      description: `${key} in focused select ${ui.focused.label}; current=${ui.focused.value}; options=${JSON.stringify(ui.focused.options)}`,
      action: { action: 'key', key, reason: `Operate ${ui.focused.label}` },
    };
  }
  for (const [name, available, dy] of [['up', ui.canScrollUp, -480], ['down', ui.canScrollDown, 480]]) {
    if (available) choices[`scroll_${name}`] = { description: `Scroll ${name} to see more controls`, action: { action: 'scroll', dy, reason: `Scroll ${name}` } };
  }
  if (ui.busy) choices.wait = { description: 'Wait 500 milliseconds for the visible loading state to finish', action: { action: 'wait', reason: 'Wait for loading' } };
  choices.escalate = { description: 'Ask System 2 to replan: ambiguous next action, missing required text, or repeated failure', action: { action: 'escalate', reason: 'System 1 requests replanning' } };
  choices.done = { description: 'Finish ONLY if the visible page explicitly reports PASS', action: { action: 'done', reason: 'Visible task completed' } };
  return choices;
}
