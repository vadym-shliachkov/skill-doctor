import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const TOOLS = join(import.meta.dirname, '..', 'tools');
if (process.argv[2] === 'go') {
  execFileSync(process.execPath, [join(TOOLS, 'child.mjs')]);
}
