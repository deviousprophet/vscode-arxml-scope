/**
 * The diff body surface contract.
 *
 * The class names on the host and both editor roots are read by the preview
 * audit; the built-in Monaco diff owns the line/word paint, the overview ruler
 * and the center margin, while the extra copy-left arrow reuses the built-in
 * `.arrow-revert-change` view-zone margin. These source assertions keep a
 * rename or a dropped contract from silently turning the body audit green
 * against an empty surface.
 */
import * as assert from 'assert';

import { webviewCss, webviewSource } from './cssTestUtils';

suite('diff body surface', () => {
	test('the page publishes the body, gutter and status contract', () => {
		const source = webviewSource('diffMonaco.ts');
		for (const name of ['arxml-diff-body', 'arxml-diff-gutter', 'arxml-diff-status']) {
			assert.ok(source.includes(`'${name}'`), `${name} is applied by the page`);
		}
		assert.ok(source.includes("classList.toggle('arxml-diff-merge'"), 'merge mode is a body state');
		assert.ok(!source.includes('arxml-diff-merge-margin'), 'no custom center overlay remains');
	});

	test('the built-in diff owns the body paint and overview ruler', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(/renderIndicators:\s*true/.test(source), 'native +/− indicators are on');
		assert.ok(/renderOverviewRuler:\s*true/.test(source), 'the built-in overview ruler is on');
		assert.ok(/renderMarginRevertIcon:\s*true/.test(source), 'the built-in margin arrow stays mounted');
		assert.ok(/renderGutterMenu:\s*false/.test(source), 'the gutter menu cannot duplicate the affordance');
		assert.ok(!source.includes('overviewRuler:'), 'no semantic ruler decorations remain');
		assert.ok(!source.includes('arxml-selected'), 'no custom selection tint remains');
		assert.ok(!source.includes('arxml-subtree'), 'no custom subtree tint remains');
		assert.ok(!source.includes('arxml-diff-line-'), 'no second semantic line/fill layer');
		assert.ok(!source.includes('arxml-diff-sign-'), 'no second semantic sign layer');
		assert.ok(!source.includes('arxml-diff-word-'), 'no second semantic word layer');
	});

	test('merge arrows reuse the built-in diff-margin view zone', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(
			/arrow-revert-change codicon codicon-arrow-left/.test(source),
			'the extra arrow uses the built-in classes'
		);
		assert.ok(source.includes('marginDomNode: wrapper'), 'the arrow lives in a view-zone margin');
		assert.ok(
			source.includes("addEventListener('click', handleCopyArrow, true)"),
			'the built-in arrow click is captured'
		);
		assert.ok(
			source.includes("postToHost({ type: 'copy', side: target.side, key: target.key })"),
			'the host copy action'
		);
		const css = webviewCss('monaco', 'monaco.css');
		assert.ok(!css.includes('arxml-merge-arrow'), 'no custom pill/text arrow');
		assert.ok(!css.includes('arxml-diff-merge-margin'), 'no custom center overlay');
		assert.ok(!css.includes('arxml-selected'), 'no custom selection tint');
		assert.ok(!css.includes('arxml-subtree'), 'no custom subtree tint');
		assert.ok(
			/#diff-monaco:not\(\.arxml-diff-merge\)[\s\S]*\.arrow-revert-change[\s\S]*display:\s*none/.test(css),
			'merge mode gates the built-in arrow without a diff re-render'
		);
	});

	test('the stylesheet leaves the built-in diff paint intact', () => {
		const css = webviewCss('monaco', 'monaco.css');
		assert.ok(!css.includes('line-insert'), 'native inserted line fills are not neutralized');
		assert.ok(!css.includes('line-delete'), 'native deleted line fills are not neutralized');
		assert.ok(!css.includes('char-insert'), 'native inserted char spans are not neutralized');
		assert.ok(!css.includes('char-delete'), 'native deleted char spans are not neutralized');
	});

	test('navigation stays semantic; the built-in arrow maps line changes only', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(source.includes('semanticChanges(body.rows)'), 'the navigation source is the body adapter');
		assert.ok(source.includes('navigationTarget('), 'a missing side maps to the owning pane');
		assert.ok(/diffEditor\?\.getLineChanges/.test(source), 'the built-in arrow maps its deletion block');
	});

	test('the native unchanged widgets stay on the Show all/Show diff path', () => {
		const source = webviewSource('diffMonaco.ts');
		assert.ok(
			/hideUnchangedRegions:\s*\{[\s\S]*enabled:\s*changesOnly/.test(source),
			'Show diff drives the native option'
		);
		assert.ok(/contextLineCount:\s*contextActive \? 5 : 0/.test(source), 'Context stays the 5/0 context count');
		assert.ok(/minimumLineCount:\s*3/.test(source), 'the VS Code minimum unchanged run is kept');
		assert.ok(source.includes('onViewAll'), 'Show all remains a toolbar action');
		assert.ok(source.includes('onViewDiff'), 'Show diff remains a toolbar action');
	});
});
