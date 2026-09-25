// Build choices from fresh visible controls, never from the task's correct answer.
export function candidatesFor(ui, textValues = []) {
  if (!ui || !Array.isArray(ui.controls)) throw Error('Fresh UI structure is required for Jev');
  const choices = {};
  for (const c of ui.controls) {
    choices[`click_${c.index}`] = {
      description: `Click ${c.tag} ${JSON.stringify(c.label)}; value=${JSON.stringify(c.value)}; context=${c.context || ''}`,
      action: { action: 'click', x: c.x, y: c.y, reason: `Click ${c.label}` },
    };
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
    if (available) choices[`scroll_${name}`] = { description: `Scroll ${name} to see more controls`, action: { action: 'scroll', x: 1200, y: 800, dy, reason: `Scroll ${name}` } };
  }
  choices.escalate = { description: 'Ask Luna to replan: ambiguous next action, missing required text, or repeated failure', action: { action: 'escalate', reason: 'Jev requests replanning' } };
  choices.done = { description: 'Finish ONLY if the visible page explicitly reports PASS', action: { action: 'done', reason: 'Visible task completed' } };
  return choices;
}
