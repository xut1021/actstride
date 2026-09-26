// Hand-authored, site-scoped workflows. No fixture configuration or answer lookup.
const definitions = [
  { id: 'assign_ticket', title: '工单分派', description: 'Find a unique ticket by department and priority, assign its owner, check and confirm.', params: { department: 'string', priority: 'string', owner: 'string' } },
  { id: 'book_room', title: '会议室预约', description: 'Find a unique available room matching day, period and minimum capacity; fill applicant, check and confirm.', params: { day: 'string', period: 'string', capacity: 'integer', name: 'string' } },
  { id: 'notification_preferences', title: '账户偏好', description: 'Open notification settings, set email/SMS states and timezone, check and confirm.', params: { email: 'boolean', sms: 'boolean', zone: 'string' } },
];
export const bindingSchema = { anyOf: [
  { type: 'null' },
  ...definitions.map(d => ({ type: 'object', additionalProperties: false, required: ['id', 'params'], properties: {
    id: { type: 'string', enum: [d.id] },
    params: { type: 'object', additionalProperties: false, required: Object.keys(d.params), properties: Object.fromEntries(Object.entries(d.params).map(([k, type]) => [k, { type }])) },
  } })),
] };

export function validateBinding(binding) {
  const d = definitions.find(d => d.id === binding?.id);
  if (!d || !binding.params || typeof binding.params !== 'object' || Array.isArray(binding.params) || Object.keys(binding).some(k => !['id', 'params'].includes(k))) throw Error('Invalid skill binding');
  const entries = Object.entries(d.params);
  if (Object.keys(binding.params).length !== entries.length || entries.some(([k, type]) => {
    const v = binding.params[k];
    return type === 'integer' ? !Number.isInteger(v) || v < 1 || v > 1000
      : type === 'boolean' ? typeof v !== 'boolean'
      : typeof v !== 'string' || !v.trim() || v.length > 100 || /[\x00-\x1f]/.test(v);
  })) throw Error('Invalid skill parameters');
  return structuredClone(binding);
}

export function skillCatalog(ui) {
  if (!ui || ui.modal || ui.busy || ui.error || /^PASS\b/.test(ui.status || '')) return [];
  return definitions.filter(d => ui.title === d.title).map(({ id, description, params }) => ({ id, version: 1, description, params }));
}

export function skillCandidate(ui, binding) {
  if (!binding || !skillCatalog(ui).some(d => d.id === binding.id)) return null;
  validateBinding(binding);
  return { description: `Execute verified local workflow ${binding.id} with ${JSON.stringify(binding.params)}. Checks each step and returns to planner on mismatch.`,
    action: { action: 'skill', skill: structuredClone(binding), reason: `Use ${binding.id}` } };
}
