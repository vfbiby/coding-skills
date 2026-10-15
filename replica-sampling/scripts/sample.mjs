#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const styles = ['display', 'position', 'color', 'background-color', 'background-image',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'padding', 'margin', 'gap', 'border', 'border-radius', 'box-shadow', 'opacity',
  'transform', 'transform-origin', 'transition', 'animation', 'overflow', 'z-index'];
const safeUrl = value => { const u = new URL(value); return `${u.origin}${u.pathname}`; };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));

function validate(config) {
  for (const key of ['targets', 'viewports', 'states']) {
    if (!Array.isArray(config[key]) || !config[key].length) throw Error(`${key} must be a nonempty array`);
    const names = config[key].map(item => item.name);
    if (names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) || new Set(names).size !== names.length)
      throw Error(`${key} names must be unique file-safe identifiers`);
  }
  if (!config.selectors || !Object.keys(config.selectors).length) throw Error('selectors must name at least one element');
  for (const target of config.targets) {
    if (!['http:', 'https:'].includes(new URL(target.url).protocol)) throw Error('targets must use HTTP(S)');
  }
  for (const v of config.viewports) {
    if (![v.width, v.height].every(n => Number.isInteger(n) && n > 0)) throw Error('viewport dimensions must be positive integers');
  }
  for (const state of config.states) {
    if (!Array.isArray(state.framesMs) || !state.framesMs.length || state.framesMs.some((n, i, a) => !Number.isFinite(n) || n < 0 || (i && n <= a[i - 1])))
      throw Error('framesMs must be strictly increasing nonnegative numbers');
    for (const action of [...(state.actions ?? []), ...config.targets.flatMap(target => target.actions?.[state.name] ?? [])]) {
      if (!['click', 'hover', 'press', 'waitFor'].includes(action.type)) throw Error(`unsupported action: ${action.type}`);
      if (action.type !== 'press' && !action.selector) throw Error(`${action.type} needs selector`);
    }
  }
}

async function snapshot(page, selectors, properties) {
  return page.evaluate(({ selectors, properties }) => {
    const elements = {};
    for (const [name, spec] of Object.entries(selectors)) {
      const { selector, pseudo, required = true } = typeof spec === 'string' ? { selector: spec } : spec;
      const nodes = [...document.querySelectorAll(selector)];
      if (required && !nodes.length) throw Error(`missing required selector: ${name}`);
      elements[name] = nodes.map(node => {
        const r = node.getBoundingClientRect();
        const computed = getComputedStyle(node, pseudo);
        return { rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          styles: Object.fromEntries(properties.map(p => [p, computed.getPropertyValue(p)])) };
      });
    }
    const media = new Set();
    let inaccessibleSheets = 0;
    const seen = new Set();
    const walk = owner => {
      if (seen.has(owner)) return;
      seen.add(owner);
      try {
        for (const rule of owner.cssRules ?? []) {
          if (rule.type === CSSRule.MEDIA_RULE) media.add(rule.conditionText);
          if (rule.styleSheet) walk(rule.styleSheet);
          if (rule.cssRules) walk(rule);
        }
      } catch { inaccessibleSheets++; }
    };
    for (const sheet of document.styleSheets) walk(sheet);
    return { location: location.origin + location.pathname, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        scrollX, scrollY, fonts: document.fonts.status },
      fontFaces: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      images: { total: document.images.length, pending: [...document.images].filter(image => !image.complete).length,
        failed: [...document.images].filter(image => image.complete && !image.naturalWidth).length }, elements,
      media: [...media].map(condition => ({ condition, matches: matchMedia(condition).matches })), inaccessibleSheets,
      bundles: [...document.scripts].filter(s => s.src).map(s => { const u = new URL(s.src); return `${u.origin}${u.pathname}`; }) };
  }, { selectors, properties });
}

function compare(records, targets) {
  const comparisons = [];
  for (const reference of records.filter(r => r.target === targets[0].name)) {
    for (const name of targets.slice(1).map(t => t.name)) {
      const actual = records.find(r => r.target === name && r.viewport === reference.viewport && r.state === reference.state && r.requestedMs === reference.requestedMs);
      const differences = [];
      for (const element of new Set([...Object.keys(reference.data.elements), ...Object.keys(actual.data.elements)])) {
        const expected = reference.data.elements[element] ?? [];
        const received = actual.data.elements[element] ?? [];
        if (expected.length !== received.length) differences.push({ element, field: 'count', reference: expected.length, actual: received.length });
        expected.forEach((box, index) => {
          if (!received[index]) return;
          for (const field of Object.keys(box.rect)) {
            const delta = received[index].rect[field] - box.rect[field];
            if (Math.abs(delta) > .01) differences.push({ element, index, field, delta });
          }
          for (const [field, value] of Object.entries(box.styles)) {
            if (received[index].styles[field] !== value) differences.push({ element, index, field, reference: value, actual: received[index].styles[field] });
          }
        });
      }
      comparisons.push({ viewport: reference.viewport, state: reference.state, requestedMs: reference.requestedMs,
        reference: reference.target, actual: name, differences });
    }
  }
  return comparisons;
}

function report(records, comparisons) {
  const groups = Map.groupBy(records, r => `${r.viewport} / ${r.state} / requested ${r.requestedMs}ms`);
  return `<!doctype html><meta charset="utf-8"><title>Replica samples</title>
    <style>body{font:14px system-ui;margin:24px;background:#eee;color:#222}section{margin-bottom:40px}.grid{display:flex;gap:16px;align-items:flex-start;overflow:auto}figure{margin:0;flex:1;min-width:320px}figure>img{width:100%}.crop{position:relative;overflow:hidden;background:#ddd;max-width:100%}.crop img{position:absolute;max-width:none}pre{white-space:pre-wrap}summary{cursor:pointer}h2{margin-bottom:8px}</style>
    <h1>Replica samples</h1><p>Measured differences, not a pass/fail verdict. Frame times include automation delay. Full-page images are captured after the frame sequence.</p>
    ${[...groups].map(([name, rows]) => `<section><h2>${escape(name)}</h2><div class="grid">${rows.map(r => {
      const link = escape(r.image);
      return `<figure><h3>${escape(r.target)}</h3><p>DOM ${r.measuredMs.toFixed(1)}ms · screenshot ${r.screenshotMs.start.toFixed(1)}–${r.screenshotMs.end.toFixed(1)}ms · DPR ${r.data.viewport.dpr}</p><a href="${link}"><img src="${link}"></a>
        ${Object.entries(r.data.elements).map(([key, boxes]) => boxes.slice(0, 1).map(({ rect }) => {
          if (rect.width <= 0 || rect.height <= 0) return '';
          return `<details><summary>${escape(key)} region</summary><div class="crop" style="width:${rect.width}px;height:${rect.height}px"><img src="${link}" style="width:${r.data.viewport.width}px;left:${-rect.x}px;top:${-rect.y}px"></div></details>`;
        }).join('')).join('')}<a href="${escape(r.fullPage)}">Full page</a></figure>`;
    }).join('')}</div><details><summary>Geometry and computed style differences</summary><pre>${escape(JSON.stringify(comparisons.filter(c => `${c.viewport} / ${c.state} / requested ${c.requestedMs}ms` === name), null, 2))}</pre></details></section>`).join('')}`;
}

export async function sample(config, { chromium, output, configDir = process.cwd(), project = process.cwd() }) {
  validate(config);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw Error('output directory must be empty; samples are never overwritten');
  const revision = (() => {
    try { return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }).trim()) }; }
    catch { return null; }
  })();
  const run = { status: 'running', startedAt: new Date().toISOString(), project: revision,
    targets: config.targets.map(t => ({ name: t.name, url: safeUrl(t.url), revision: t.revision ?? null })), blockedRequests: [] };
  await json(join(output, 'run.json'), run);
  let browser;
  const records = [];
  let current = 'browser-launch';
  try {
    browser = await chromium.launch({ headless: true, channel: config.channel, executablePath: config.executablePath });
    run.browser = browser.version();
    for (const target of config.targets) for (const viewport of config.viewports) for (const state of config.states) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr ?? 1, isMobile: viewport.isMobile ?? false, hasTouch: viewport.hasTouch ?? false,
        userAgent: viewport.userAgent, colorScheme: config.colorScheme ?? 'dark', reducedMotion: 'no-preference', serviceWorkers: 'block',
        storageState: target.storageState ? resolve(configDir, target.storageState) : undefined });
      try {
        await context.route('**/*', route => {
          const request = route.request();
          if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
          run.blockedRequests.push({ target: target.name, method: request.method(), url: safeUrl(request.url()) });
          return route.abort('blockedbyclient');
        });
        await context.routeWebSocket('**/*', socket => { run.blockedRequests.push({ target: target.name, method: 'WebSocket', url: safeUrl(socket.url()) }); socket.close(); });
        current = `${target.name}/${viewport.name}/${state.name}`;
        const page = await context.newPage();
        page.setDefaultTimeout(config.timeoutMs ?? 15000);
        try {
          await page.goto(target.url, { waitUntil: 'domcontentloaded' });
          if (target.ready) await page.locator(target.ready).first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() => [...document.images].filter(image => {
            const r = image.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
          }).every(image => image.complete));
          const folder = `${target.name}/${viewport.name}/${state.name}`;
          await mkdir(join(output, folder), { recursive: true });
          const started = performance.now();
          for (const action of target.actions?.[state.name] ?? state.actions ?? []) {
            const selector = action.selector ? page.locator(action.selector).first() : null;
            if (action.type === 'click') await selector.click();
            if (action.type === 'hover') await selector.hover();
            if (action.type === 'press') await (selector ?? page.keyboard).press(action.key);
            if (action.type === 'waitFor') await selector.waitFor({ state: action.state ?? 'visible' });
          }
          for (const requestedMs of state.framesMs) {
            while (performance.now() - started < requestedMs)
              await pause(Math.ceil(requestedMs - (performance.now() - started)));
            const measuredMs = performance.now() - started;
            const data = await snapshot(page, { ...config.selectors, ...target.selectors }, config.styles ?? styles);
            const image = `${folder}/frame-${requestedMs}.png`;
            const start = performance.now() - started;
            await page.screenshot({ path: join(output, image), animations: 'allow' });
            const record = { target: target.name, viewport: viewport.name, state: state.name, requestedMs, measuredMs,
              screenshotMs: { start, end: performance.now() - started }, image, fullPage: `${folder}/full.png`, data };
            records.push(record);
            await json(join(output, folder, `frame-${requestedMs}.json`), record);
          }
          await page.screenshot({ path: join(output, folder, 'full.png'), fullPage: true, animations: 'allow' });
        } finally { await page.close(); }
      } finally { await context.close(); }
    }
    const comparisons = compare(records, config.targets);
    await json(join(output, 'samples.json'), records);
    await json(join(output, 'comparison.json'), comparisons);
    await writeFile(join(output, 'index.html'), report(records, comparisons));
    run.status = 'complete';
    run.frames = records.length;
    return { frames: records.length, comparisons: comparisons.length };
  } catch (error) {
    run.status = 'failed';
    run.failedAt = current;
    throw error;
  } finally {
    await browser?.close();
    run.finishedAt = new Date().toISOString();
    await json(join(output, 'run.json'), run);
  }
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, out: { type: 'string' }, project: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('node sample.mjs --config sampling.json --out evidence-dir [--project path-with-playwright]'); return; }
  if (!values.config || !values.out) throw Error('--config and --out are required');
  const project = resolve(values.project ?? process.cwd());
  const require = createRequire(join(project, 'package.json'));
  let playwright;
  for (const name of ['playwright', 'playwright-core']) {
    try { playwright = require(name); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  if (!playwright) throw Error('Install Playwright in --project, or point --project at an existing installation');
  const path = resolve(values.config);
  console.log(await sample(JSON.parse(await readFile(path, 'utf8')), { chromium: playwright.chromium, project, output: resolve(values.out), configDir: dirname(path) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => {
    const message = error.message.split('\n')[0].replace(/https?:\/\/[^\s"']+/g, value => safeUrl(value));
    console.error(error.name + ': ' + message);
    process.exitCode = 1;
  });
}
