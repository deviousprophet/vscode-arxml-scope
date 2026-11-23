/**
 * The diff body surface contract.
 *
 * The class names on the host and both editor roots are read by the preview
 * audit and by the follow-up ruler/visual-proof children; the stylesheet owns the
 * VS Code diff paint. These source assertions keep a rename or a dropped class
 * from silently turning the body audit green against an empty surface.
 */
import * as assert from 'assert';

import { webviewCss, webviewSource } from './cssTestUtils';

suite('diff body surface', () => {
	test('the page publishes the body, gutter, status and merge-margin contract', () => {
		const source = webviewSource('diffMonaco.ts');
		for (const name of [
			'arxml-diff-body',
			'arxml-diff-gutter',
			'arxml-diff-status',
			'arxml-diff-merge-margin'
		]) {
			assert.ok(source.includes(`'${name}'`), `${name} is applied by the page`);
		}
		assert.ok(source.includes("classList.toggle('arxml-diff-merge'"), 'merge mode is a body state');
	});

	test('signs, fills and words are semantic decoration classes', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(source.includes('arxml-diff-sign-${paint}'), 'the gutter sign is semantic');
		assert.ok(source.includes('insert-sign codicon codicon-add'), 'the added sign is the built-in codicon');
		assert.ok(source.includes('delete-sign codicon codicon-remove'), 'the removed sign is the built-in codicon');
		assert.ok(source.includes('arxml-diff-line-${paint}'), 'the line fill is semantic');
		assert.ok(source.includes('arxml-diff-word-${paint}'), 'the word span is semantic');
		assert.ok(source.includes('wordDiffSpans'), 'word spans come from the pure helper');
		assert.ok(!/renderIndicators:\s*true/.test(source), 'Monaco text-diff indicators stay off');
		assert.ok(/renderMarginRevertIcon:\s*false/.test(source), 'merge mode never adds the built-in revert icon');
		assert.ok(/renderGutterMenu:\s*false/.test(source), 'the gutter menu cannot duplicate the affordance');
	});

	test('copy arrows are the glyph-margin codicons, not text pseudo-elements', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(source.includes('codicon-arrow-${direction}'), 'the arrow is the VS Code codicon');
		assert.ok(source.includes('glyphMargin: { position: monaco.editor.GlyphMarginLane.Right }'), 'the margin lane');
		const css = webviewCss('monaco', 'monaco.css');
		assert.ok(!/arxml-merge-arrow[^{]*::after/.test(css), 'no text arrow pseudo-element remains');
		assert.ok(/\.cgmr\.arxml-merge-arrow/.test(css), 'the glyph control keeps VS Code margin geometry');
	});

	test('the stylesheet owns the semantic paint and neutralizes Monaco text-diff fills', () => {
		const css = webviewCss('monaco', 'monaco.css');
		for (const selector of [
			'.arxml-diff-line-added',
			'.arxml-diff-line-removed',
			'.arxml-diff-word-added',
			'.arxml-diff-word-removed',
			'.arxml-diff-sign'
		]) {
			assert.ok(css.includes(selector), `${selector} is styled`);
		}
		assert.ok(
			/\.monaco-diff-editor \.view-overlays > div > \.line-insert,[\s\S]*background-color: transparent/.test(css),
			'the pre-aligned body does not keep a second line fill'
		);
		assert.ok(/--vscode-diffEditor-insertedTextBackground/.test(css), 'word spans use the inserted role');
		assert.ok(/--vscode-diffEditor-removedTextBackground/.test(css), 'word spans use the removed role');
	});
});
