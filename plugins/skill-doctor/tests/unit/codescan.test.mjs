import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { makeResolver } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { scanText, scanCode, resolveModule, definesFunction, isEntryScript, listScriptFiles, langOf } from '../../skills/schem-it/scripts/lib/codescan.mjs';
import { copyFixture, tmpDir } from '../helpers.mjs';

test('langOf picks the language from the extension', () => {
  assert.deepEqual(['a.py', 'b.sh', 'c.ps1', 'd.mjs', 'e.ts'].map(langOf), ['py', 'sh', 'sh', 'js', 'js']);
});

test('scanCode finds a child process with the script named on its line', () => {
  const root = copyFixture('pipeline');
  assert.deepEqual(scanCode(root, 'skills/flow/scripts/entry.mjs'), [
    { file: 'skills/flow/scripts/entry.mjs', line: 5, kind: 'child', detail: 'child.mjs' },
  ]);
});

test('scanCode lists in-folder imports, AI calls, and the hints of imported modules one level deep', () => {
  const root = copyFixture('pipeline');
  assert.deepEqual(scanCode(root, 'skills/flow/scripts/loop.py'), [
    { file: 'skills/flow/scripts/loop.py', line: 2, kind: 'import', detail: 'run_eval from skills/flow/scripts/run_eval.py' },
    { file: 'skills/flow/scripts/loop.py', line: 8, kind: 'child', detail: 'subprocess.run(["claude", "-p", "improve"])' },
    { file: 'skills/flow/scripts/loop.py', line: 8, kind: 'ai', detail: '"claude"' },
    { file: 'skills/flow/scripts/run_eval.py', line: 5, kind: 'child', detail: 'cli.py' },
  ]);
  assert.equal(scanCode(root, 'skills/flow/scripts/loop.py', { limit: 1 }).some((h) => h.file.endsWith('run_eval.py')), false);
});

test('scanText: shell lines, JS imports and requires, comments and RegExp.exec are not calls', () => {
  assert.deepEqual(scanText('node tools/a.mjs --x\nsource lib.sh\nclaude -p "hi"\n# python b.py', 'sh'), [
    { line: 1, kind: 'child', detail: 'tools/a.mjs' },
    { line: 2, kind: 'import', module: 'lib.sh', names: [] },
    { line: 3, kind: 'ai', detail: 'claude -p' },
  ]);
  assert.deepEqual(scanText("import { a, b as c } from './m.mjs';\nconst x = require('./lib/x');\nconst m = re.exec(text);\n// execSync('y.sh')", 'js'), [
    { line: 1, kind: 'import', module: './m.mjs', names: ['a', 'b', 'c'] },
    { line: 2, kind: 'import', module: './lib/x', names: [] },
  ]);
});

test('resolveModule accepts a path, a path without extension, a dotted Python module and a bare file name', () => {
  const s = scan(copyFixture('pipeline'));
  const resolve = makeResolver(s.root, s.units.find((u) => u.id === 'pipe/flow'));
  for (const spec of ['scripts/run_eval.py', 'scripts/run_eval', 'scripts.run_eval', 'run_eval.py']) {
    assert.equal(resolveModule(spec, resolve), 'skills/flow/scripts/run_eval.py', spec);
  }
  assert.equal(resolveModule('nope.py', resolve), null);
});

test('definesFunction finds functions, arrows, methods, exports and $ names; not calls', () => {
  const js = "function load() {}\nconst $run = async (x) => x;\nclass A {\n  static async step(a) {\n  }\n}\nexport async function go() {}\nconst o = { fix: function () {} };\nuse(other);";
  for (const name of ['load', '$run', 'step', 'go', 'fix']) assert.equal(definesFunction(js, name, 'js'), true, name);
  assert.equal(definesFunction(js, 'other', 'js'), false);
  assert.equal(definesFunction('async def run_eval(i):\r\n    pass\r\n', 'run_eval', 'py'), true);
  assert.equal(definesFunction('run_eval(1)\n', 'run_eval', 'py'), false);
  assert.equal(definesFunction('setup() {\n  :\n}\nfunction clean {\n}', 'setup', 'sh'), true);
  assert.equal(definesFunction('setup() {\n  :\n}\nfunction clean {\n}', 'clean', 'sh'), true);
});

test('isEntryScript: shell files, shebangs (with a BOM), Python main (CRLF) and JS argv; libraries are not', () => {
  assert.equal(isEntryScript('echo hi', 'x.sh'), true);
  assert.equal(isEntryScript('\uFEFF#!/usr/bin/env node\nconsole.log(1)', 'x.mjs'), true);
  assert.equal(isEntryScript('def main():\r\n    pass\r\n\r\nif __name__ == \'__main__\':\r\n    main()\r\n', 'x.py'), true);
  assert.equal(isEntryScript('console.log(process.argv.slice(2))', 'x.mjs'), true);
  assert.equal(isEntryScript('export const a = 1;', 'x.mjs'), false);
  assert.equal(isEntryScript('def a():\n    pass\n', 'x.py'), false);
});

test('listScriptFiles skips tests, fixtures, vendored and output folders, also at the root', () => {
  const root = copyFixture('pipeline');
  assert.deepEqual(listScriptFiles(root, 'skills/flow'), [
    'skills/flow/scripts/cli.py', 'skills/flow/scripts/entry.mjs', 'skills/flow/scripts/loop.py', 'skills/flow/scripts/run_eval.py', 'skills/flow/tools/child.mjs',
  ]);
  const flat = tmpDir();
  for (const [rel, text] of [['x.mjs', ''], ['.schem-it/a.mjs', ''], ['node_modules/b.js', ''], ['fixtures/c.py', ''], ['y.spec.ts', '']]) {
    fs.mkdirSync(path.dirname(path.join(flat, rel)), { recursive: true });
    fs.writeFileSync(path.join(flat, rel), text);
  }
  assert.deepEqual(listScriptFiles(flat, '.'), ['x.mjs']);
});

test('listScriptFiles skips virtualenvs, caches, build output and dot-folders', () => {
  const root = tmpDir();
  for (const rel of ['run.py', '.venv/lib/site-packages/p/m.py', 'venv/x.py', 'env/y.py', '__pycache__/q.py', 'dist/cli.js', 'build/x.sh', '.cache/z.mjs', 'lib/site-packages/w.py']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '');
  }
  assert.deepEqual(listScriptFiles(root, '.'), ['run.py']);
});

test('definesFunction finds CommonJS exports, bare assignments, typed TS functions and modifiers', () => {
  const cases = [
    'exports.run = function (x) {}',
    'module.exports.run = async () => {}',
    'run = function () {}',
    'const run = async (x: string): Promise<void> => {}',
    'class A {\n  async run(x: T): Promise<void> {\n  }\n}',
    'class A {\n  private run(x) {\n  }\n}',
    'const run = (a, b = f()) => a',
    'function run<T>(x: T): T { return x; }',
  ];
  for (const text of cases) assert.equal(definesFunction(text, 'run', 'js'), true, text);
  for (const text of ['run(1);', 'if (run) {}', 'x.run(2);', 'const y = run;']) assert.equal(definesFunction(text, 'run', 'js'), false, text);
});
