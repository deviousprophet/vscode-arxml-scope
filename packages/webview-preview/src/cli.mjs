#!/usr/bin/env node
/**
 * Spike CLI:
 *   node src/cli.mjs --adapter adapters/toy/index.mjs [--state name] [--list]
 *                     [--out .out/<adapter>] [--allow-failures]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listStates, runStandalone } from './modes/standalone.mjs';
import { summarize } from './runner/report.mjs';

function parseArgs(argv) {
	const args = { allowFailures: false, list: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--adapter') {
			args.adapter = argv[++i];
		} else if (arg === '--state') {
			args.state = argv[++i];
		} else if (arg === '--out') {
			args.out = argv[++i];
		} else if (arg === '--browser') {
			args.browser = argv[++i];
		} else if (arg === '--list') {
			args.list = true;
		} else if (arg === '--allow-failures') {
			args.allowFailures = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!args.adapter) {
		throw new Error('--adapter is required');
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const adapterPath = path.resolve(process.cwd(), args.adapter);
const module = await import(pathToFileURL(adapterPath).href);
const adapter = module.default;
if (!adapter) {
	throw new Error(`${adapterPath} has no default export`);
}
if (args.list) {
	console.log(JSON.stringify({ _type: 'webview-preview-states', adapter: adapter.name, states: listStates(adapter) }, null, 2));
	process.exit(0);
}
const outDir = path.resolve(process.cwd(), args.out ?? path.join('.out', adapter.name));
await mkdir(outDir, { recursive: true });
const report = await runStandalone({
	adapter,
	outDir,
	only: args.state,
	executablePath: args.browser
});
console.log(JSON.stringify(summarize(report), null, 2));
if (report.failed > 0) {
	for (const state of report.states.filter((candidate) => !candidate.ok)) {
		console.error(`\n${state.name}:`);
		for (const assertion of state.assertions.filter((candidate) => !candidate.ok)) {
			for (const issue of assertion.issues) {
				console.error(`  [${assertion.id}] ${issue}`);
			}
		}
		for (const issue of state.productViolations) {
			console.error(`  [product] ${issue}`);
		}
	}
	if (!args.allowFailures) {
		process.exitCode = 1;
	}
}
