import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// A shared ledger survives separate runs. Unknown request charges stay reserved.
export class Budget {
  constructor(path, limit) {
    if (!Number.isFinite(limit) || limit <= 0) throw Error('Budget must be positive');
    this.path = path;
    this.state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { limit, charged: 0, pending: 0 };
    if (this.state.limit !== limit) throw Error('Existing ledger has a different limit; use its original budget');
    for (const field of ['limit', 'charged', 'pending']) {
      if (!Number.isFinite(this.state[field]) || this.state[field] < 0) throw Error('Invalid budget ledger');
    }
    this.save();
  }
  save() {
    writeFileSync(this.path + '.tmp', JSON.stringify(this.state, null, 2));
    renameSync(this.path + '.tmp', this.path);
  }
  reserve(amount) {
    if (!Number.isFinite(amount) || amount <= 0) throw Error('Invalid request cost bound');
    if (this.state.pending > 0) throw Error('Unsettled request exists; reconcile provider billing before continuing');
    if (this.state.charged + amount > this.state.limit) throw Error('Budget cannot cover the next request cost bound');
    this.state.pending = amount;
    this.save();
  }
  settle(cost) {
    if (!Number.isFinite(cost) || cost < 0) throw Error('Missing valid usage.cost; reservation retained');
    const bound = this.state.pending;
    this.state.charged += cost;
    this.state.pending = 0;
    this.save();
    if (cost > bound || this.state.charged > this.state.limit) throw Error('Provider cost exceeded reserved bound; stop and inspect billing');
  }
}

export function modelPricing(model) {
  if (!model?.architecture?.input_modalities?.includes('image') || !model.supported_parameters?.includes('tools')) {
    throw Error('Selected model must support images and tools');
  }
  const context = model.context_length;
  if (!Number.isFinite(context) || context <= 0) throw Error('Missing model context limit');
  const rates = [model.pricing, ...(model.pricing.overrides || [])];
  const prompt = Math.max(...rates.map(r => Number(r.prompt ?? model.pricing.prompt)));
  const completion = Math.max(...rates.map(r => Number(r.completion ?? model.pricing.completion)));
  if (![prompt, completion].every(n => Number.isFinite(n) && n >= 0)) throw Error('Missing model token prices');
  const image = Number(model.pricing.image || 0);
  if (!Number.isFinite(image) || image < 0) throw Error('Invalid image pricing');
  // Reserve ALL advertised context tokens, not an estimated screenshot token count.
  // One image; no plugins, web search, audio, or paid server tools are requested.
  return {
    bound: context * prompt + 2048 * completion + image,
    maxPrice: { prompt: prompt * 1e6, completion: completion * 1e6, image, request: 0 },
  };
}
