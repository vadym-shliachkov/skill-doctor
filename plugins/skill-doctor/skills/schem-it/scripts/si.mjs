#!/usr/bin/env node
// No static imports: they would load before this check and could fail on an old Node with a cryptic error.
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`schem-it needs Node.js 22 or newer (found ${process.versions.node}). Install it from https://nodejs.org/`);
  process.exit(1);
}

const { parseArgs } = await import('node:util');
const { COMMANDS } = await import('./commands.mjs');

const OPTIONS = {
  root: { type: 'string' },
  run: { type: 'string' },
  only: { type: 'string' },
  unit: { type: 'string' },
  mode: { type: 'string' },
  format: { type: 'string' },
  save: { type: 'boolean' },
  overview: { type: 'boolean' },
  file: { type: 'string' },
};

const [command, ...rest] = process.argv.slice(2);
const fn = COMMANDS[command];
if (!fn) {
  console.error(`Usage: si <${Object.keys(COMMANDS).join('|')}> [--root <dir>] [--run <id>] [options]`);
  process.exit(2);
}

try {
  const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true });
  const result = await fn(values);
  if (typeof result === 'string') process.stdout.write(result.endsWith('\n') ? result : `${result}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result && typeof result === 'object' && result.ok === false) process.exitCode = 1;
} catch (e) {
  console.error(`schem-it: ${e.message}`);
  process.exitCode = 1;
}
