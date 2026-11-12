// Models of the deep fixture after the first and the second analysis round, built from hand-written fragments.
import { scan } from '../skills/schem-it/scripts/lib/scan.mjs';
import { mergeModel } from '../skills/schem-it/scripts/lib/merge.mjs';
import { discoverUnits } from '../skills/schem-it/scripts/lib/discover.mjs';
import { copyFixture } from './helpers.mjs';

const SKILL = 'skills/audit/SKILL.md';
const SEO = 'skills/audit/agents/seo.md';
const TOOL = 'skills/audit/scripts/tool.mjs';
const at = (file, line, quote) => ({ file, lines: [line, line], quote });
const chain = (unit, file, mid, extraEdges = []) => ({
  unit,
  nodes: [{ id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at(file, 1, 'x') }, ...mid, { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at(file, 1, 'x') }],
  edges: [...['start', ...mid.filter((n) => n.kind !== 'storage').map((n) => n.id), 'end'].map((id, i, all) => (i ? { from: all[i - 1], to: id, kind: 'flow', source: at(file, 1, 'x') } : null)).filter(Boolean), ...extraEdges],
});

// Wave 1: the skill runs collect, fans out over two area prompts, writes findings.json; the SEO prompt works through its table and list.
export function firstRound() {
  const s = scan(copyFixture('deep'));
  const audit = chain('deep/audit', SKILL, [
    { id: 'collect', kind: 'process', label: 'Collect', role: 'r', command: 'node "<SKILL_DIR>/scripts/tool.mjs" collect --root <ROOT>', origin: 'inferred', source: at(SKILL, 10, 'T collect') },
    { id: 'areas', kind: 'subprocess', label: 'Analysts check each area', role: 'r', target: 'deep:runner', calls: 'agent', parallel: true,
      targets: [{ target: 'agents/seo.md', role: 'Checks SEO' }, { target: 'agents/perf.md', role: 'Checks speed' }], origin: 'inferred', source: at(SKILL, 11, 'deep:runner') },
    { id: 'merge', kind: 'process', label: 'Merge', role: 'r', command: 'node scripts/tool.mjs merge', origin: 'inferred', source: at(SKILL, 12, 'T merge') },
    { id: 'findings', kind: 'storage', label: 'findings.json', role: 'r', path: 'findings.json', holds: 'Findings', schema: 'references/finding.schema.json', origin: 'inferred', source: at(SKILL, 12, 'findings.json') },
  ], [{ from: 'merge', to: 'findings', kind: 'writes', label: 'findings', source: at(SKILL, 12, 'findings.json') }]);
  const seo = chain('deep/audit/seo', SEO, [
    { id: 'rules', kind: 'process', label: 'Check every rule', role: 'r', table: { lines: [5, 8] }, origin: 'inferred', source: at(SEO, 5, 'Rule') },
    { id: 'facts', kind: 'process', label: 'Record facts', role: 'r', list: { lines: [12, 13] }, origin: 'inferred', source: at(SEO, 10, 'Facts') },
    { id: 'notes', kind: 'storage', label: 'notes.json', role: 'r', path: 'notes.json', holds: 'Notes', fields: [{ name: 'area', holds: 'The area key' }, { name: 'facts.key', holds: 'A fact key' }], origin: 'inferred', source: at(SEO, 10, 'Facts') },
  ], [{ from: 'facts', to: 'notes', kind: 'writes', label: 'facts', source: at(SEO, 10, 'Facts') }]);
  const fragments = new Map([['deep/audit', audit], ['deep/audit/seo', seo]]);
  return { s, fragments, model: mergeModel(s, { units: {} }, fragments, { run: 'r1' }) };
}

// Wave 2: discover the script commands, add a chart for collect that runs its sibling merge, merge again.
export function secondRound() {
  const { s, fragments, model } = firstRound();
  const d = discoverUnits(s, model);
  fragments.set('deep/audit/run-tool-collect', chain('deep/audit/run-tool-collect', TOOL, [
    { id: 'then', kind: 'process', label: 'Merge right away', role: 'r', command: 'node scripts/tool.mjs merge', origin: 'inferred', source: at(TOOL, 5, 'merge') },
  ]));
  return { scan: d.scan, model: mergeModel(d.scan, { units: {} }, fragments, { run: 'r1' }) };
}
