import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detect } from '../../skills/schem-it/scripts/lib/detect.mjs';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { runDir } from '../../skills/schem-it/scripts/lib/paths.mjs';
import { renderHtml } from '../../skills/schem-it/scripts/lib/render-html.mjs';
import { tmpDir, runSi } from '../helpers.mjs';

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('run ids that are not plain names are refused', () => {
  const root = tmpDir();
  for (const bad of ['../x', '..', 'a/b', 'a\b', '']) assert.throws(() => runDir(root, bad), /Invalid run id/);
  assert.doesNotThrow(() => runDir(root, '2026-11-12T10-00-00-2'));
  const r = runSi(['render', '--root', root, '--run', '../../x']);
  assert.notEqual(r.code, 0);
});

test('scan writes a .gitignore into .schem-it', () => {
  const root = write(path.join(tmpDir(), 'helper'), { 'SKILL.md': '---\nname: helper\ndescription: d\n---\n\n1. Do it.\n' });
  const r = runSi(['scan', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(root, '.schem-it', '.gitignore'), 'utf8'), '*\n');
});

test('a marketplace plugin whose source is outside the folder is skipped', () => {
  const base = tmpDir();
  write(base, { 'private/.claude-plugin/plugin.json': '{"name":"priv"}', 'private/skills/s/SKILL.md': '---\nname: s\ndescription: secret\n---\n' });
  const root = write(path.join(base, 'm'), {
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'm', plugins: [{ name: 'priv', source: '../private' }] }),
  });
  const d = detect(root);
  assert.equal(d.plugins.length, 0);
  assert.match(d.warnings.join('\n'), /outside the analysed folder/);
});

test('a hooks file outside the plugin root is not read, and hook names are not regexes', () => {
  const base = tmpDir();
  write(base, { 'hk/hooks.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'secret' }] }] } }) });
  const root = write(path.join(base, 'p'), {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'p', hooks: '../hk/hooks.json' }),
    'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n\n1. Do it.\n',
  });
  const res = scan(root);
  assert.ok(!JSON.stringify(res).includes('secret'));
  assert.match(res.warnings.join('\n'), /outside the analysed folder/);

  const root2 = write(path.join(tmpDir(), 'q'), {
    '.claude-plugin/plugin.json': '{"name":"q"}',
    'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n\n1. Do it.\n',
    'hooks/hooks.json': JSON.stringify({ hooks: { '(a+)+$x': [{ hooks: [{ command: 'x' }] }], '[': [{ hooks: [{ command: 'y' }] }] } }),
  });
  const t = Date.now();
  assert.doesNotThrow(() => scan(root2));
  assert.ok(Date.now() - t < 5000);
});

test('a root name that looks like a placeholder does not break the page', () => {
  const html = renderHtml({ rootId: 'r', nodes: [{ id: 'r', label: 'x /*DATA*/ /*ELK*/' }] }, {}, { template: '<title><!--TITLE--></title><script>/*ELK*/\n/*LAYOUT*/\n/*DATA*/</script>', elk: 'ELK', layout: 'LAYOUT' });
  assert.match(html, /<title>x \/\*DATA\*\/ \/\*ELK\*\/ · schem-it<\/title>/);
  assert.match(html, /<script>ELK\nLAYOUT\nconst DATA = /);
});

test('a .schem-it folder or latest.json that is a link is refused', (t) => {
  const base = tmpDir();
  const root = write(path.join(base, 'helper'), { 'SKILL.md': '---\nname: helper\ndescription: d\n---\n\n1. Do it.\n' });
  fs.mkdirSync(path.join(base, 'elsewhere'));
  try { fs.symlinkSync(path.join(base, 'elsewhere'), path.join(root, '.schem-it'), 'junction'); } catch { t.skip('cannot create links here'); return; }
  const r = runSi(['scan', '--root', root]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /symbolic link/);
  assert.deepEqual(fs.readdirSync(path.join(base, 'elsewhere')), []);
});
