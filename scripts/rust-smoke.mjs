import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const target = `${process.platform}-${process.arch}`;
const modulePath = path.join(root, 'dist', 'native', target, 'arxml_node.node');
if (!existsSync(modulePath)) {
	console.error(`Native addon not found: ${modulePath}. Run "npm run rust:build" first.`);
	process.exit(1);
}
const contractSource = readFileSync(path.join(root, 'src', 'host', 'engine', 'coreEngine.ts'), 'utf8');
const expectedAbi = Number(/EXPECTED_ENGINE_ABI = (\d+)/.exec(contractSource)?.[1]);
if (!Number.isInteger(expectedAbi)) {
	console.error('Could not read EXPECTED_ENGINE_ABI from src/host/engine/coreEngine.ts');
	process.exit(1);
}

const require = createRequire(import.meta.url);
const started = performance.now();
const native = require(modulePath);
const loadMs = Math.round((performance.now() - started) * 1000) / 1000;
const hello = native.engineHello();
const version = native.engineVersion();
const abi = native.engineAbi();
if (typeof hello !== 'string' || typeof version !== 'string' || abi !== expectedAbi) {
	console.error(JSON.stringify({ hello, version, abi }));
	process.exit(1);
}
console.log(JSON.stringify({ _type: 'rust-smoke', target, hello, version, abi, expectedAbi, loadMs }));
