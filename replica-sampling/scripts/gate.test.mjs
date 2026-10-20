import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gate } from './gate.mjs';

const box = (x, radius = '8px') => ({ rect: { x, y: 10, width: 100, height: 40 }, styles: { 'border-radius': radius, color: 'rgb(0, 0, 0)' } });
const frame = (target, elements, { texts = [], documentWidth = 800 } = {}) => ({
  target, viewport: 'desk', state: 'idle', requestedMs: 0,
  data: { viewport: { width: 800 }, document: { width: documentWidth }, elements, texts },
});
const config = gate => ({ targets: [{ name: 'reference' }, { name: 'ours' }], gate });
const reference = frame('reference', { card: [box(0), box(0)] }, { texts: [{ text: 'Title', x: 0, y: 0 }, { text: 'Save', x: 0, y: 50 }] });

test('matching samples pass and every rule is counted', () => {
  const ours = frame('ours', { card: [box(3), box(-3), box(0)] }, { texts: [{ text: 'Title', x: 2, y: 0 }, { text: 'Save', x: 0, y: 51 }] });
  const result = gate([reference, ours], config({ styles: { card: ['border-radius'] } }));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.missingTexts, []);
  assert.equal(result.maxDelta, 3);
  assert.equal(result.checks, 2 * 4 + 2 + 2 * 2);
});

test('positive controls: each rule fails on a sample that violates it', () => {
  const ours = frame('ours', { card: [box(5, '4px')] }, { texts: [{ text: 'Title', x: 0, y: 9 }], documentWidth: 820 });
  const fields = gate([reference, ours], config({ styles: { card: ['border-radius'] } })).failures.map(f => `${f.element ?? ''}:${f.field}`);
  assert.deepEqual(fields.sort(), ['card:border-radius', 'card:count', 'card:x', 'text:Title:y', ':horizontal-overflow'].sort());
});

test('unlisted styles are not compared and missing texts are reported, not failed', () => {
  const ours = frame('ours', { card: [box(0), { ...box(0), styles: { 'border-radius': '8px', color: 'red' } }] }, { texts: [{ text: 'Title', x: 0, y: 0 }] });
  const result = gate([reference, ours], config({ styles: { card: ['border-radius'] } }));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.missingTexts.map(t => t.text), ['Save']);
});

test('exemptions need a reason and only silence what they name', () => {
  const ours = frame('ours', { card: [box(0), { ...box(0), rect: { x: 0, y: 10, width: 100, height: 90 } }] }, { texts: reference.data.texts });
  assert.throws(() => gate([reference, ours], config({ exempt: [{ element: 'card', field: 'height' }] })), /reason/);
  assert.equal(gate([reference, ours], config({})).failures.length, 1);
  const narrow = config({ exempt: [{ element: 'card', index: 1, field: 'height', reason: 'extra row appended locally' }] });
  assert.deepEqual(gate([reference, ours], narrow).failures, []);
  assert.equal(gate([reference, ours], narrow).maxDelta, 0, 'exempted deltas stay out of maxDelta');
  const wrongIndex = config({ exempt: [{ element: 'card', index: 0, field: 'height', reason: 'other card' }] });
  assert.equal(gate([reference, ours], wrongIndex).failures.length, 1);
  const styled = frame('ours', { card: [box(0, '4px'), box(0)] }, { texts: reference.data.texts });
  const styleRules = { styles: { card: ['border-radius'] } };
  assert.equal(gate([reference, styled], config(styleRules)).failures.length, 1);
  const styleExempt = config({ ...styleRules, exempt: [{ element: 'card', field: 'border-radius', reason: 'state differs by account' }] });
  assert.deepEqual(gate([reference, styled], styleExempt).failures, []);
});

test('CLI exits 1 on failures and 0 when clean', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replica-gate-test-'));
  const cli = fileURLToPath(new URL('./gate.mjs', import.meta.url));
  await writeFile(join(root, 'config.json'), JSON.stringify(config({ styles: { card: ['border-radius'] } })));
  await writeFile(join(root, 'bad.json'), JSON.stringify([reference, frame('ours', { card: [box(0, '4px'), box(0)] }, { texts: reference.data.texts })]));
  await writeFile(join(root, 'good.json'), JSON.stringify([reference, frame('ours', { card: [box(0), box(0)] }, { texts: reference.data.texts })]));
  const run = file => promisify(execFile)(process.execPath, [cli, '--config', join(root, 'config.json'), '--samples', join(root, file)]);
  await assert.rejects(run('bad.json'), error => error.code === 1 && error.stdout.includes('border-radius'));
  assert.equal(JSON.parse((await run('good.json')).stdout).failures.length, 0);
});
