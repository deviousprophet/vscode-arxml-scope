import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const platform = process.platform;
const arch = process.arch;
const artifact =
	platform === 'win32' ? 'arxml_node.dll' : platform === 'darwin' ? 'libarxml_node.dylib' : 'libarxml_node.so';
const source = path.join(root, 'rust', 'target', 'release', artifact);
const outputDir = path.join(root, 'dist', 'native', `${platform}-${arch}`);
const output = path.join(outputDir, 'arxml_node.node');

if (process.env.ARXML_SKIP_RUST_BUILD === '1') {
	if (!existsSync(output)) {
		throw new Error(`ARXML_SKIP_RUST_BUILD is set but ${output} is missing`);
	}
	console.log(
		JSON.stringify({
			_type: 'rust-native-build',
			target: `${platform}-${arch}`,
			output: path.relative(root, output).replaceAll('\\', '/'),
			skipped: true,
		})
	);
	process.exit(0);
}

execFileSync('cargo', ['build', '--manifest-path', 'rust/arxml-node/Cargo.toml', '--release'], {
	stdio: 'inherit',
	cwd: root,
});

if (!existsSync(source)) {
	throw new Error(`Rust build did not produce ${source}`);
}
mkdirSync(outputDir, { recursive: true });
copyFileSync(source, output);
console.log(
	JSON.stringify({
		_type: 'rust-native-build',
		target: `${platform}-${arch}`,
		artifact: path.relative(root, source).replaceAll('\\', '/'),
		output: path.relative(root, output).replaceAll('\\', '/'),
		bytes: statSync(output).size,
	})
);
