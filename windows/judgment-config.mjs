import { parseArgs } from 'node:util';
import { systemOneEndpoint } from '../fast-decider.mjs';

export const help = `Desktop judgment comparison (text/UIA input)
node windows/judgment-benchmark.mjs [options]
  --fast-provider openrouter|systemone   default: openrouter
  --fast MODEL                          default: typesafe/jev-1.13 on OpenRouter
  --fast-endpoint URL                    required for local SystemOne
  --threshold NUMBER                    0..1; default: 0.55, uncalibrated
  --repeats NUMBER                      1..3; default: 2
  --compare judgments|planning          default: judgments; planning compares Jev alone with Astra-guided Jev
  --help
OpenRouter uses OPENROUTER_API_KEY and the existing $20 ledger.
SystemOne uses optional FAST_API_KEY; it does not read or modify that ledger.
Both routes also call the subscription Astra planner. No model is downloaded.
`;

export function judgmentConfig(args) {
  const { values } = parseArgs({ args, options: {
    'fast-provider': { type: 'string', default: 'openrouter' }, fast: { type: 'string' },
    'fast-endpoint': { type: 'string' }, threshold: { type: 'string', default: '0.55' },
    repeats: { type: 'string', default: '2' }, compare: { type: 'string', default: 'judgments' }, help: { type: 'boolean' },
  } });
  if (values.help) return { help: true };
  const provider = values['fast-provider'], threshold = Number(values.threshold), repeats = Number(values.repeats);
  if (!['openrouter', 'systemone'].includes(provider)) throw Error('Unknown fast provider');
  if (!['judgments', 'planning'].includes(values.compare)) throw Error('Unknown comparison');
  if (!values.threshold.trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error('Threshold must be 0..1');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw Error('Repeats must be 1..3');
  const model = values.fast ?? (provider === 'openrouter' ? 'typesafe/jev-1.13' : undefined);
  if (model !== undefined && (!model.trim() || /[\s?#]/.test(model))) throw Error('Invalid model ID');
  if (provider === 'openrouter' && (!/^[\w][\w.-]*\/[\w][\w.:-]*$/.test(model) || values['fast-endpoint'] !== undefined)) throw Error('OpenRouter needs an owner/model ID and no custom endpoint');
  return { provider, model, endpoint: provider === 'systemone' ? systemOneEndpoint(values['fast-endpoint']) : undefined, threshold, repeats, compare: values.compare };
}

export async function judgmentPrice(model, fetchImpl = fetch) {
  // Use the selected model's advertised bounds, never another version's prices.
  const path = model.split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(`https://openrouter.ai/api/v1/models/${path}/endpoints`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Pricing HTTP ${response.status}`);
  const endpoints = (await response.json()).data?.endpoints;
  if (!endpoints?.length) throw Error('No pricing');
  const bounds = endpoints.map(e => {
    const context = e.context_length, completion = e.max_completion_tokens ?? context;
    const promptRate = Number(e.pricing?.prompt), completionRate = Number(e.pricing?.completion);
    if (![context, completion].every(n => Number.isFinite(n) && n > 0)
      || ![promptRate, completionRate].every(n => Number.isFinite(n) && n >= 0)
      || e.pricing?.prompt == null || e.pricing?.completion == null) throw Error('Invalid pricing');
    return context * promptRate + completion * completionRate;
  });
  const bound = Math.max(...bounds);
  if (!Number.isFinite(bound) || bound <= 0) throw Error('Invalid pricing');
  return { bound };
}

export function fastCredentials(provider, env = process.env) {
  return provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.FAST_API_KEY;
}
