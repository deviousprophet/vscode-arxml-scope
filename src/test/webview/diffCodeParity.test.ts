import * as assert from 'assert';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

function read(relative: string): string {
	return readFileSync(path.join(root, relative), 'utf8');
}

function sha256(relative: string): string {
	const text = readFileSync(path.join(root, relative), 'utf8').replaceAll('\r\n', '\n');
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function webviewFiles(extension: string): string[] {
	const dir = path.join(root, 'src', 'webview');
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith(extension))
		.map((file) => path.join('src', 'webview', file).replaceAll('\\', '/'));
}

/**
 * Static source/hash contract for the pinned Monaco surface. This is not a
 * behavioural test; the preview suite exercises the rendered DOM.
 */
suite('VS Code diff source contract', () => {
	test('source contract: monaco-editor is pinned to the VS Code 1.125 release', () => {
		const lock = JSON.parse(read('package-lock.json')) as {
			packages: Record<string, { version?: string; integrity?: string }>;
		};
		const monaco = lock.packages['node_modules/monaco-editor'];
		assert.ok(monaco !== undefined, 'monaco-editor is locked');
		assert.strictEqual(monaco.version, '0.57.0');
		assert.strictEqual(
			monaco.integrity,
			'sha512-5BkI9KGoqrNvBGUe15/QlZq3OooZ8WLg1AxTpaqHRCP3HNpzPPZKE2EDz8M7c+VRmCeUw1Brp4cx/PWm3kI/5A=='
		);

		const pkg = JSON.parse(read('package.json')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies?.['monaco-editor'], '0.57.0');
		assert.strictEqual(pkg.devDependencies?.['patch-package'], '^8.0.1');
		assert.strictEqual(pkg.scripts?.['postinstall'], 'patch-package');
	});

	test('source contract: the built-in gutter, sash and diff editor files match the pinned release', () => {
		const expected: Record<string, string> = {
			'node_modules/monaco-editor/esm/vs/editor/browser/widget/diffEditor/features/gutterFeature.js':
				'26895e826aa577208097ddd126ecae16b1785f1cdf45cea9b6e17ce5aa9dd13a',
			'node_modules/monaco-editor/esm/vs/editor/browser/widget/diffEditor/components/diffEditorSash.js':
				'0ada5415d0c7716760816f11f9b01a12f2f508cf511e49dee2a5d30c1fcdd5a3',
			'node_modules/monaco-editor/esm/vs/editor/browser/widget/diffEditor/diffEditorWidget.js':
				'b7095044c8e7e01a9b4a5aeb105c9502aa90bc32cbed0042f0a0a809fc2afc3a',
			'node_modules/monaco-editor/esm/vs/editor/browser/widget/diffEditor/diffEditor.contribution.js':
				'4872c4050da0c60b1f6e7cdecf636b176584dcc16d72b3ded77d983ef3693bbd',
			'node_modules/monaco-editor/esm/vs/platform/actions/browser/toolbar.js':
				'4382bca3d09f4679e77f9f690d8e088419d842379ef0aa055cc09fbb9e495f09'
		};
		for (const [file, expectedHash] of Object.entries(expected)) {
			assert.ok(existsSync(path.join(root, file)), `${file} exists`);
			assert.strictEqual(sha256(file), expectedHash, `${file} is the pinned release file`);
		}
	});

	test('source contract: the checked-in patch is the only upstream modification', () => {
		const patch = read('patches/monaco-editor+0.57.0.patch');
		assert.ok(patch.includes('features/gutterFeature.js'), 'the patch scopes the gutter toolbar');
		assert.ok(patch.includes('platform/actions/browser/toolbar.js'), 'the patch scopes the menu');
		assert.ok(patch.includes('__arxmlGutterItem'), 'the patch exposes the hovered hunk');
		assert.ok(patch.includes('arxml.copyLeftAvailable'), 'the patch scopes the left action');
		assert.ok(patch.includes('arxml.copyRightAvailable'), 'the patch scopes the right action');
	});

	test('source contract: the page uses the built-in diff surface with the per-side body', () => {
		const page = read('src/webview/diffMonaco.ts');
		const required = [
			'renderGutterMenu: true',
			'enableSplitViewResizing: true',
			'renderSideBySide: true',
			'useInlineViewWhenSpaceIsLimited: false',
			'readOnly: true',
			'renderOverviewRuler: true',
			'renderIndicators: true',
			'folding: true',
			"showFoldingControls: 'mouseover'",
			'buildDiffSyntheticDocuments'
		];
		for (const token of required) {
			assert.ok(page.includes(token), `diffMonaco.ts enables ${token}`);
		}
		assert.ok(
			!page.includes('buildAlignedSyntheticDocuments'),
			'the page does not use the pre-aligned placeholder body'
		);
		assert.ok(
			!page.includes('enableSplitViewResizing: false'),
			'the page does not disable the built-in sash'
		);
	});

	test('source contract: exactly two ARXML actions are registered on the built-in hunk toolbar', () => {
		const actions = read('src/webview/monaco/diffGutterActions.ts');
		assert.strictEqual(
			(actions.match(/MenuRegistry\.appendMenuItem\(MenuId\.DiffEditorHunkToolbar/g) ?? []).length,
			2
		);
		assert.strictEqual((actions.match(/CommandsRegistry\.registerCommand/g) ?? []).length, 2);
		assert.ok(actions.includes("title: 'Copy Block to Left'"));
		assert.ok(actions.includes("title: 'Copy Block to Right'"));
		assert.ok(actions.includes('ContextKeyExpr.has(COPY_LEFT_CONTEXT)'));
		assert.ok(actions.includes('ContextKeyExpr.has(COPY_RIGHT_CONTEXT)'));
		assert.ok(
			!actions.includes('diffEditorModifiedWritable'),
			'the custom actions do not depend on the built-in writable key'
		);
	});

	test('source contract: compact find-button tooltips do not steal hover', () => {
		const css = read('src/webview/monaco/monaco.css');
		assert.ok(
			/\.monaco-hover\.workbench-hover\.compact\s*\{[^}]*pointer-events:\s*none/.test(css),
			'compact hover tooltips must not intercept their anchor'
		);
		assert.ok(
			/\.workbench-hover-container:has\(\.monaco-hover\.workbench-hover\.compact\)\s*\{[^}]*pointer-events:\s*none/.test(
				css
			),
			'the compact tooltip container must not intercept its anchor'
		);
		assert.ok(
			/\.context-view:has\(\.monaco-hover\.workbench-hover\.compact\)\s*\{[^}]*pointer-events:\s*none/.test(
				css
			),
			'the compact tooltip context view must not intercept its anchor'
		);
	});

	test('source contract: no custom margin, arrow, placeholder or ruler layer remains', () => {
		const forbidden = [
			'arxml-diff-placeholder',
			'arxml-merge-arrow',
			'diff-copy-arrow',
			'arxml-diff-merge-margin',
			'arxml-copy-left-margin',
			'arxml-copy-right-margin',
			'arrow-revert-change',
			'arxml-diff-selection',
			'arxml-diff-ruler'
		];
		const files = [...webviewFiles('.ts'), ...webviewFiles('.css')].filter(
			(file) => !file.endsWith('monacoInternals.d.ts')
		);
		for (const file of files) {
			const source = read(file);
			for (const token of forbidden) {
				assert.ok(!source.includes(token), `${file} does not contain ${token}`);
			}
		}
	});
});
