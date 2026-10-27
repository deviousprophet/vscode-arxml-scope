#!/usr/bin/env node
/**
 * Measures the production scanner, node index and renderer on an ECUC sample.
 *
 *   npm run perf:ecuc -- <file>
 *   node scripts/bench-ecuc.js ../sample/large.arxml
 *
 * The benchmark is evidence, not a promise: it covers the Node-side work, not the browser or
 * VS Code layout/paint. The harness page load is a separate observation. No dependency.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, outModule } = require('./out-module');

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function formatBytes(bytes) {
	if (bytes < 1024) {
		return bytes + ' B';
	}
	if (bytes < 1024 * 1024) {
		return (bytes / 1024).toFixed(1) + ' KiB';
	}
	return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
}

function measure(label, run) {
	const times = [];
	let last;
	for (let at = 0; at < 4; at++) {
		const start = performance.now();
		last = run();
		const end = performance.now();
		if (at > 0) {
			times.push(end - start);
		}
	}
	return { label, median: median(times), last };
}

function main() {
	const file = path.resolve(process.argv[2] || path.join(ROOT, '..', 'sample', 'large.arxml'));
	if (!fs.existsSync(file)) {
		throw new Error(
			'Sample not found: ' + file + '\nRun `npm run samples:ecuc` first, or pass a file path.'
		);
	}
	const text = fs.readFileSync(file, 'utf8');
	const fileBytes = fs.statSync(file).size;
	const scanner = outModule(path.join('core', 'ecuc', 'scanner.js'));
	const renderer = outModule(path.join('editor', 'renderHtml.js'));
	const nodeId = outModule(path.join('editor', 'nodeId.js'));
	const offsets = outModule(path.join('core', 'text', 'offsets.js'));

	const heapBefore = process.memoryUsage();
	const scan = measure('scan', () => scanner.scanEcucValues(text));
	const model = scan.last;
	if (model.modules.length === 0) {
		throw new Error('No ECUC modules found in ' + file);
	}
	const index = measure('index', () => nodeId.buildNodeIndex(model));
	const nodes = index.last.byId.size;
	const lineIndex = new offsets.LineIndex(text);
	const tree = measure('tree', () => renderer.renderTree(model, { lineIndex }));
	const page = measure('page', () => renderer.renderHtml(model, { nonce: 'bench', lineIndex }));
	const heapAfter = process.memoryUsage();

	console.log('ECUC benchmark');
	console.log('  file:        ' + file);
	console.log('  size:        ' + formatBytes(fileBytes) + ' (' + text.length + ' UTF-16 code units)');
	console.log('  nodes:       ' + nodes + ' indexed nodes (' + model.modules.length + ' modules)');
	console.log('  scan:        ' + scan.median.toFixed(2) + ' ms (median of 3)');
	console.log('  index:       ' + index.median.toFixed(2) + ' ms');
	console.log('  renderTree:  ' + tree.median.toFixed(2) + ' ms (' + formatBytes(Buffer.byteLength(tree.last)) + ')');
	console.log('  renderHtml:  ' + page.median.toFixed(2) + ' ms (' + formatBytes(Buffer.byteLength(page.last)) + ')');
	console.log(
		'  heapUsed:    ' +
			formatBytes(Math.max(0, heapAfter.heapUsed - heapBefore.heapUsed)) +
			' delta (rss ' +
			formatBytes(heapAfter.rss) +
			' after the run; neither is a peak)'
	);
	console.log('\nrenderTree and renderHtml call buildNodeIndex themselves, and renderHtml calls renderTree;');
	console.log('these are separate warm runs, so the phases are not additive.');
	console.log('This does not measure browser layout/paint or the real VS Code webview.');
}

try {
	main();
} catch (error) {
	console.error('perf: ' + (error && error.message ? error.message : String(error)));
	process.exitCode = 1;
}
