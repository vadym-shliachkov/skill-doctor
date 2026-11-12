// Ad-hoc: lays out every flowchart of a schem-it run and reports rule violations.
// node tests/check-run.mjs <path to model.json>
import fs from 'node:fs';
import { buildViews } from '../skills/schem-it/scripts/lib/views.mjs';
import { loadLayout, checkLayout } from './layout-check.mjs';

const model = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { SchemLayout, elk } = loadLayout();
const byId = new Map(model.nodes.map((n) => [n.id, n]));
let bad = 0;
for (const v of buildViews(model).filter((x) => x.kind !== 'index' && x.nodes.length)) {
  const L = await SchemLayout.compute(v, byId, elk, { showFiles: true });
  const p = checkLayout(L);
  const flows = L.edges.filter((e) => e.kind === 'flow').length;
  console.log(`${p.length ? 'FAIL' : 'ok  '} ${v.id}: ${L.blocks.length} blocks, ${flows} flow, ${L.edges.length - flows} data, ${Math.round(L.width)}x${Math.round(L.height)}`);
  for (const x of p.slice(0, 8)) console.log(`       ${x}`);
  if (p.length) bad++;
}
process.exitCode = bad ? 1 : 0;
