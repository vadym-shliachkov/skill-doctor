// The fields of a JSON schema, two levels deep: top-level properties, then those of nested objects and array items.

function typeName(p) {
  const t = Array.isArray(p.type) ? p.type.join(' | ') : p.type ?? (p.enum ? 'enum' : p.$ref ? 'ref' : 'any');
  return t === 'array' ? `${p.items?.type ?? 'any'}[]` : t;
}

export function schemaFields(schema, { depth = 2 } = {}) {
  const top = schema?.properties ? schema : schema?.items?.properties ? schema.items : null;
  if (!top) return [];
  const out = [];
  const walk = (obj, prefix, level) => {
    const required = new Set(obj.required ?? []);
    for (const [name, p] of Object.entries(obj.properties ?? {})) {
      const isArray = p.type === 'array' || (Array.isArray(p.type) && p.type.includes('array'));
      const inner = isArray ? p.items : p;
      const values = p.enum ?? (isArray ? p.items?.enum : undefined) ?? ('const' in p ? [p.const] : undefined);
      out.push({
        name: `${prefix}${name}`, type: typeName(p), required: required.has(name),
        ...(values ? { values: values.map(String) } : {}), ...(p.description ? { holds: p.description } : {}), depth: level,
      });
      if (level + 1 < depth && inner?.properties) walk(inner, `${prefix}${name}${isArray ? '[]' : ''}.`, level + 1);
    }
  };
  walk(top, '', 0);
  return out;
}
