import fs from 'node:fs';

const REFERENCES = new URL('../../references/', import.meta.url);
const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(new URL(`${name}.schema.json`, REFERENCES), 'utf8')));
  return cache.get(name);
}

export function validateSchema(schema, value, at = '$') {
  const errors = [];
  check(schema, value, at, errors);
  return errors;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isInteger(v)) return 'integer';
  return typeof v;
}

function check(s, v, at, errors) {
  // anyOf: valid when one alternative is; otherwise report the alternative that came closest.
  if (s.anyOf) {
    const results = s.anyOf.map((alt) => { const e = []; check(alt, v, at, e); return e; });
    if (results.every((e) => e.length)) {
      errors.push({ path: at, message: 'does not match any allowed form' }, ...results.reduce((a, b) => (b.length < a.length ? b : a)));
    }
    return;
  }
  const push = (message) => errors.push({ path: at, message });
  if (s.type) {
    const types = [].concat(s.type);
    const actual = typeOf(v);
    if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
      push(`expected ${types.join(' or ')}, got ${actual}`);
      return;
    }
  }
  if (s.enum && !s.enum.includes(v)) push(`must be one of ${s.enum.join(', ')}`);
  if ('const' in s && v !== s.const) push(`must be ${JSON.stringify(s.const)}`);
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) push(`must be at least ${s.minLength} characters`);
    if (s.maxLength != null && v.length > s.maxLength) push(`must be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) push(`must match ${s.pattern}`);
  }
  if (typeof v === 'number' && s.minimum != null && v < s.minimum) push(`must be at least ${s.minimum}`);
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) push(`must have at least ${s.minItems} item(s)`);
    if (s.maxItems != null && v.length > s.maxItems) push(`must have at most ${s.maxItems} item(s)`);
    if (s.items) v.forEach((item, i) => check(s.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(v) === 'object') {
    for (const key of s.required ?? []) if (!(key in v)) push(`missing required property "${key}"`);
    for (const [key, child] of Object.entries(v)) {
      const sub = s.properties?.[key];
      if (sub) check(sub, child, `${at}.${key}`, errors);
      else if (s.additionalProperties === false) push(`unknown property "${key}"`);
    }
  }
}
