import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, access, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sample } from './sample.mjs';

test('real browser captures geometry, states, frames, provenance and blocks writes', async () => {
  const project = process.env.REPLICA_TEST_PROJECT ?? process.cwd();
  const require = createRequire(join(project, 'package.json'));
  let chromium;
  for (const name of ['playwright', 'playwright-core']) {
    try { ({ chromium } = require(name)); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  assert.ok(chromium, 'set REPLICA_TEST_PROJECT to a project with Playwright');
  let writes = 0;
  const server = createServer((req, res) => {
    if (req.method === 'POST') { writes++; res.end('written'); return; }
    const offset = req.url.startsWith('/actual') ? 12 : 0;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><style>
      body{margin:0;background:#eee}#card{box-sizing:border-box;width:${100 + offset}px;height:80px;background:rgb(10,20,30);transition:width .2s linear}
      #card.expanded{width:${160 + offset}px;background:rgb(30,40,50)}
      @media(max-height:700px){#card{transform:scale(.8);transform-origin:0 0}}
      </style><button id="toggle">toggle</button><div id="card"></div>
      <script>toggle.onclick=()=>card.classList.toggle('expanded');fetch('/write?token=secret-fixture',{method:'POST',body:'private-fixture'}).catch(()=>{});</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'replica-sample-test-'));
  const config = {
    channel: 'chrome',
    targets: [{ name: 'reference', url: base + '/reference?token=secret-fixture', ready: '#card' }, { name: 'actual', url: base + '/actual', ready: '#card', actions: { expanded: [{ type: 'press', selector: '#toggle', key: 'Enter' }] } }],
    viewports: [{ name: 'tall', width: 800, height: 720, dpr: 1 }, { name: 'short', width: 800, height: 650, dpr: 2 }],
    selectors: { card: '#card', optional: { selector: '#absent', required: false } },
    textRoot: 'body',
    states: [{ name: 'idle', framesMs: [0] }, { name: 'expanded', actions: [{ type: 'click', selector: '#toggle' }], framesMs: [0, 100, 350] }],
  };
  try {
    const output = join(root, 'evidence');
    assert.deepEqual(await sample(config, { chromium, project, output }), { frames: 16, comparisons: 8 });
    assert.equal(writes, 0);
    const run = JSON.parse(await readFile(join(output, 'run.json'), 'utf8'));
    assert.equal(run.status, 'complete');
    assert.equal(run.blockedRequests.filter(r => r.method === 'POST').length, 8);
    assert.ok(run.blockedRequests.every(r => !r.url.includes('?')));
    assert.ok(!JSON.stringify(run).includes('secret-fixture'));
    const records = JSON.parse(await readFile(join(output, 'samples.json'), 'utf8'));
    const get = (target, viewport, state, frame) => records.find(r => r.target === target && r.viewport === viewport && r.state === state && r.requestedMs === frame);
    assert.equal(get('reference', 'tall', 'idle', 0).data.elements.card[0].rect.width, 100);
    assert.equal(get('actual', 'tall', 'idle', 0).data.elements.card[0].rect.width, 112);
    assert.equal(get('reference', 'tall', 'expanded', 350).data.elements.card[0].rect.width, 160);
    assert.ok(Math.abs(get('reference', 'short', 'idle', 0).data.elements.card[0].rect.width - 80) < .01);
    assert.equal(get('reference', 'short', 'idle', 0).data.viewport.dpr, 2);
    assert.deepEqual(get('reference', 'tall', 'idle', 0).data.texts.map(t => t.text), ['toggle']);
    assert.ok(get('reference', 'short', 'idle', 0).data.media.some(m => m.condition.includes('700px') && m.matches));
    assert.ok(get('reference', 'tall', 'idle', 0).data.media.some(m => m.condition.includes('700px') && !m.matches));
    for (const r of records) {
      assert.ok(r.measuredMs >= r.requestedMs);
      assert.ok(r.screenshotMs.end >= r.screenshotMs.start && r.screenshotMs.start >= r.measuredMs);
      assert.deepEqual(r.data.elements.optional, []);
      assert.deepEqual((await readFile(join(output, r.image))).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    const differences = JSON.parse(await readFile(join(output, 'comparison.json'), 'utf8'));
    assert.ok(differences.find(c => c.viewport === 'tall' && c.state === 'idle').differences.some(d => d.element === 'card' && d.field === 'width' && d.delta === 12));
    const html = await readFile(join(output, 'index.html'), 'utf8');
    assert.ok(html.includes('frame-350.png') && html.includes('card region'));
    const probeBrowser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await probeBrowser.newPage();
      await page.goto(pathToFileURL(join(output, 'index.html')).href);
      const images = await page.locator('figure > a > img').evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0 })));
      assert.equal(images.length, 16);
      assert.ok(images.every(image => image.loaded));
    } finally { await probeBrowser.close(); }
    await assert.rejects(sample(config, { chromium, project, output }), /must be empty/);
    assert.equal(JSON.parse(await readFile(join(output, 'run.json'), 'utf8')).status, 'complete');
    const failedOutput = join(root, 'missing-selector');
    await assert.rejects(sample({ ...config, targets: [config.targets[0]], viewports: [config.viewports[0]], states: [config.states[0]], selectors: { missing: '#missing' } }, { chromium, project, output: failedOutput }), /missing required selector/);
    assert.equal(JSON.parse(await readFile(join(failedOutput, 'run.json'), 'utf8')).status, 'failed');
    await assert.rejects(access(join(failedOutput, 'index.html')));
    const launchOutput = join(root, 'browser-unavailable');
    await assert.rejects(sample(config, { chromium: { launch() { throw Error('browser unavailable'); } }, project, output: launchOutput }), /browser unavailable/);
    assert.equal(JSON.parse(await readFile(join(launchOutput, 'run.json'), 'utf8')).status, 'failed');
    const configPath = join(root, 'cli-config.json');
    await writeFile(configPath, JSON.stringify({ ...config, targets: [config.targets[0]], viewports: [config.viewports[0]], states: [config.states[0]] }));
    const cliOutput = join(root, 'cli-evidence');
    const launcher = join(root, 'linked-sample.mjs');
    await symlink(fileURLToPath(new URL('./sample.mjs', import.meta.url)), launcher);
    await promisify(execFile)(process.execPath, [launcher, '--config', configPath, '--out', cliOutput, '--project', project]);
    assert.equal(JSON.parse(await readFile(join(cliOutput, 'run.json'), 'utf8')).frames, 1);
    await writeFile(configPath, JSON.stringify({ ...config, targets: [{ name: 'unreachable', url: 'http://127.0.0.1:1/?token=secret-fixture' }] }));
    await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./sample.mjs', import.meta.url)), '--config', configPath, '--out', join(root, 'cli-failure'), '--project', project]), error => error.code === 1 && error.stderr.includes('ERR_UNSAFE_PORT') && !error.stderr.includes('secret-fixture'));
    await fetch(base + '/write', { method: 'POST' });
    assert.equal(writes, 1, 'permanent positive control: HTTP recorder sees a real write');
    console.log('Evidence:', output);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
