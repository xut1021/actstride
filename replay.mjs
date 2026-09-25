// Offline transport/UI fixture, NOT an AI agent or a speed benchmark.
// Selectors are allowed here to generate known-correct coordinate actions.
const steps = [
  ['click', '#search'], ['type', '传感器'],
  ['click', '#stock'], ['key', 'ArrowDown'], ['key', 'Enter'],
  ['click', '#filter'], ['click', '#rows button', 'S-102'],
  ['click', '#name'], ['type', '测试员'],
  ['click', '#quantity'], ['key', 'ControlOrMeta+A'], ['type', '2'],
  ['click', '#submit'], ['click', '#approve'], ['done'],
];
export class Replay {
  constructor(page) { this.page = page; this.index = 0; }
  feedback() {}
  async decide() {
    const step = steps[this.index++];
    if (!step) throw Error('Replay exhausted');
    const [kind, value, text] = step;
    const action = { action: kind, reason: 'Scripted offline fixture; no model inference' };
    if (kind === 'click') {
      let locator = this.page.locator(value);
      if (text) locator = locator.filter({ hasText: text });
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      if (!box) throw Error('Replay target not visible');
      action.x = Math.floor(box.x + box.width / 2);
      action.y = Math.floor(box.y + box.height / 2);
    } else if (kind === 'type') action.text = value;
    else if (kind === 'key') action.key = value;
    return { role: 'replay', action };
  }
}
