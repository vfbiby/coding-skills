#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const GEOMETRY = ['x', 'y', 'width', 'height'];
const squash = value => String(value ?? '').replace(/\s+/g, '');

function validate(gate) {
  for (const rule of gate.exempt ?? []) {
    if (typeof rule.reason !== 'string' || !rule.reason.trim()) throw Error('every exempt rule needs a reason');
  }
}

const exempted = (gate, failure) => (gate.exempt ?? []).some(rule =>
  ['target', 'viewport', 'state', 'element', 'index', 'field'].every(key => rule[key] === undefined || rule[key] === failure[key]));

export function gate(records, config) {
  const rules = config.gate ?? {};
  validate(rules);
  const tolerance = rules.tolerancePx ?? 4;
  const reference = config.targets[0].name;
  const failures = [];
  const missingTexts = [];
  let checks = 0;
  let maxDelta = 0;
  const fail = failure => { if (!exempted(rules, failure)) failures.push(failure); };
  const near = (where, a, b) => {
    for (const field of GEOMETRY) {
      if (a[field] === undefined) continue;
      const delta = Math.abs(b[field] - a[field]);
      checks++;
      if (exempted(rules, { ...where, field })) continue;
      maxDelta = Math.max(maxDelta, delta);
      if (delta > tolerance) fail({ ...where, field, reference: a[field], actual: b[field] });
    }
  };
  for (const expected of records.filter(r => r.target === reference)) {
    for (const actual of records.filter(r => r.target !== reference && r.viewport === expected.viewport && r.state === expected.state && r.requestedMs === expected.requestedMs)) {
      const scene = { target: actual.target, viewport: actual.viewport, state: actual.state, requestedMs: actual.requestedMs };
      if (actual.data.document.width > actual.data.viewport.width) fail({ ...scene, field: 'horizontal-overflow', actual: actual.data.document.width });
      for (const [element, boxes] of Object.entries(expected.data.elements)) {
        const received = actual.data.elements[element] ?? [];
        if (received.length < boxes.length) fail({ ...scene, element, field: 'count', reference: boxes.length, actual: received.length });
        boxes.forEach((box, index) => {
          if (!received[index]) return;
          near({ ...scene, element, index }, box.rect, received[index].rect);
          for (const field of rules.styles?.[element] ?? []) {
            checks++;
            if (squash(box.styles[field]) !== squash(received[index].styles[field]))
              fail({ ...scene, element, index, field, reference: box.styles[field], actual: received[index].styles[field] });
          }
        });
      }
      const pool = Map.groupBy(actual.data.texts ?? [], t => t.text);
      const used = new Map();
      for (const text of expected.data.texts ?? []) {
        const index = used.get(text.text) ?? 0;
        used.set(text.text, index + 1);
        const match = pool.get(text.text)?.[index];
        if (match) near({ ...scene, element: `text:${text.text}`, index }, text, match);
        else missingTexts.push({ ...scene, text: text.text });
      }
    }
  }
  return { tolerancePx: tolerance, checks, maxDelta, failures, missingTexts };
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, samples: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('node gate.mjs --config sampling.json --samples evidence/samples.json'); return; }
  if (!values.config || !values.samples) throw Error('--config and --samples are required');
  const config = JSON.parse(await readFile(resolve(values.config), 'utf8'));
  const result = gate(JSON.parse(await readFile(resolve(values.samples), 'utf8')), config);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 2; });
}
