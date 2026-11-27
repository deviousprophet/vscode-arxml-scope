#!/usr/bin/env node
/**
 * Cross-state stability probe for the seeded preview pages.
 *
 * Loads a baseline state and one or more variant states, then compares the
 * geometry of the selected stable controls. It is deliberately generic: the
 * caller names the controls that must not move between states.
 *
 *   node .agents/skills/ux-review/scripts/preview/state-diff.mjs \
 *     --baseline editor --state editor-dirty \
 *     --selector "#collapse-all" --selector "#expand-all"
 *
 * Exit 0 when every selector keeps its rect (within tolerance). Exit 1 when a
 * selector moves, disappears or changes visibility. The JSON report is written
 * to the skill's ignored artifacts directory by default.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './previewWebview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const requireFromPreview = createRequire(path.join(repoRoot, 'packages/webview-preview/package.json'));
const { chromium } = requireFromPreview('@playwright/test');

function values(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  }
  return out;
}

function one(name, fallback) {
  const list = values(name);
  return list.length > 0 ? list[list.length - 1] : fallback;
}

function number(name, fallback) {
  const raw = one(name, undefined);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  return candidates.find((candidate) => existsSync(candidate));
}

const baselineName = one('--baseline', undefined);
const stateNames = values('--state');
const selectors = values('--selector');
const tolerance = number('--tolerance', 1);
const outFile = path.resolve(
  one('--out', path.join(here, '../artifacts/state-diff.json'))
);

if (!baselineName) throw new Error('--baseline <state> is required');
if (stateNames.length === 0) throw new Error('at least one --state <state> is required');
if (selectors.length === 0) throw new Error('at least one --selector <css> is required');

const executablePath = findBrowser();
if (executablePath === undefined) {
  throw new Error('No Chrome or Edge found. Set CHROME_PATH to a headless-capable browser.');
}

const preview = await startPreview({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });

async function measure(name) {
  const state = preview.states.find((candidate) => candidate.name === name);
  if (state === undefined) throw new Error(`unknown state: ${name}`);
  const page = await browser.newPage({
    viewport: { width: state.width, height: state.height }
  });
  try {
    await page.goto(`http://127.0.0.1:${preview.port}/?state=${encodeURIComponent(name)}`, {
      waitUntil: 'load'
    });
    await page.waitForSelector('body[data-preview-ready="true"]', { timeout: 30_000 });
    await page.waitForTimeout(300);
    const metrics = await page.evaluate((wanted) => {
      const read = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
          opacity: Number(style.opacity),
          hidden: element.hidden,
          text: (element.textContent ?? '').trim().slice(0, 80)
        };
      };
      return {
        selectors: Object.fromEntries(wanted.map((selector) => [selector, read(selector)])),
        scroll: {
          top: document.scrollingElement?.scrollTop ?? 0,
          height: document.body?.scrollHeight ?? 0
        }
      };
    }, selectors);
    return { state: name, viewport: { width: state.width, height: state.height }, ...metrics };
  } finally {
    await page.close();
  }
}

const baseline = await measure(baselineName);
const variants = [];
const failures = [];

for (const name of stateNames) {
  const variant = await measure(name);
  const comparison = { state: name, viewport: variant.viewport, selectors: {}, failures: [] };
  if (variant.viewport.width !== baseline.viewport.width || variant.viewport.height !== baseline.viewport.height) {
    comparison.failures.push(
      `viewport ${variant.viewport.width}x${variant.viewport.height} differs from baseline ${baseline.viewport.width}x${baseline.viewport.height}`
    );
  }
  for (const selector of selectors) {
    const before = baseline.selectors[selector];
    const after = variant.selectors[selector];
    if (before === null || after === null) {
      const failure = `${selector} is missing in ${before === null ? baselineName : name}`;
      comparison.failures.push(failure);
      comparison.selectors[selector] = { before, after, delta: null };
      continue;
    }
    const delta = {
      x: after.x - before.x,
      y: after.y - before.y,
      width: after.width - before.width,
      height: after.height - before.height
    };
    const moved =
      Math.abs(delta.x) > tolerance ||
      Math.abs(delta.y) > tolerance ||
      Math.abs(delta.width) > tolerance ||
      Math.abs(delta.height) > tolerance;
    const visibilityChanged =
      before.display !== after.display ||
      before.visibility !== after.visibility ||
      before.hidden !== after.hidden;
    if (moved) {
      comparison.failures.push(
        `${selector} moved: x ${before.x} -> ${after.x} (${delta.x > 0 ? '+' : ''}${delta.x.toFixed(2)}), y ${before.y} -> ${after.y} (${delta.y > 0 ? '+' : ''}${delta.y.toFixed(2)}), width ${before.width} -> ${after.width}, height ${before.height} -> ${after.height}`
      );
    }
    if (visibilityChanged) {
      comparison.failures.push(
        `${selector} changed visibility: display ${before.display} -> ${after.display}, hidden ${before.hidden} -> ${after.hidden}`
      );
    }
    comparison.selectors[selector] = { before, after, delta, moved, visibilityChanged };
  }
  if (comparison.failures.length > 0) failures.push({ state: name, failures: comparison.failures });
  variants.push(comparison);
}

const report = {
  _type: 'preview-state-diff',
  baseline: { name: baselineName, viewport: baseline.viewport },
  tolerance,
  selectors,
  variants,
  failures,
  ok: failures.length === 0
};

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

for (const variant of variants) {
  console.log(`${variant.state}: ${variant.failures.length === 0 ? 'stable' : 'UNSTABLE'}`);
  for (const failure of variant.failures) console.log(`  ${failure}`);
}
console.log(`report: ${outFile}`);

await browser.close();
preview.close();
process.exit(report.ok ? 0 : 1);
