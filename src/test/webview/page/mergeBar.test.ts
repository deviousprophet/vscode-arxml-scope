/**
 * The diff panel's merge strip.
 *
 * The strip is the only merge surface: it shows the conflict count and the current
 * conflict, and forwards exactly three intents to the host. The panel stays read-only
 * for a plain diff because the strip only appears when the host posts merge state.
 */
import * as assert from 'assert';

import type { MergeViewState } from '../../../diffProtocol';
import { expectReady, installDom, loadModule, messagesOf } from '../pageTestUtils';

function state(overrides: Partial<MergeViewState> = {}): MergeViewState {
	return {
		conflicts: [
			{
				nodeId: 'container:Pkg/Mod/Cont#0/param:P#0',
				path: '/Pkg/Mod/Cont/P',
				reason: 'both-changed',
				base: '1',
				ours: '2',
				theirs: '3'
			},
			{
				nodeId: 'container:Pkg/Mod/Cont#0/param:Q#0',
				path: '/Pkg/Mod/Cont/Q',
				reason: 'delete-modify',
				ours: '4'
			}
		],
		unresolved: 2,
		target: 'all-cases.merged.arxml',
		problems: [],
		...overrides
	};
}

function mount(): { dom: ReturnType<typeof installDom>; document: any } {
	const dom = installDom('diff');
	loadModule<typeof import('../../../webview/diffViewer')>('../../webview/diffViewer').mountDiff();
	expectReady(dom.api);
	return { dom, document: dom.document };
}

suite('diff page merge strip', () => {
	test('a plain diff shows no merge strip', () => {
		const { dom, document } = mount();
		try {
			const bar = document.getElementById('diff-merge') as HTMLElement;
			assert.ok(bar, 'the strip element exists');
			assert.strictEqual(bar.hidden, true, 'and stays hidden without merge state');
		} finally {
			dom.restore();
		}
	});

	test('merge state shows the count, the conflict and the target', () => {
		const { dom, document } = mount();
		try {
			dom.post({ type: 'merge', state: state() });
			const bar = document.getElementById('diff-merge') as HTMLElement;
			assert.strictEqual(bar.hidden, false);
			assert.match(bar.querySelector('.merge-bar-status')?.textContent ?? '', /1\/2/);
			assert.match(bar.querySelector('.merge-bar-status')?.textContent ?? '', /2 unresolved/);
			const current = bar.querySelector('.merge-bar-current')?.textContent ?? '';
			assert.ok(current.includes('/Pkg/Mod/Cont/P'), current);
			assert.ok(current.includes('base 1'), 'the base value is shown');
			assert.ok(current.includes('ours 2') && current.includes('theirs 3'), 'both sides are shown');
			assert.ok(current.includes('all-cases.merged.arxml'), 'the write target is shown');
			const write = bar.querySelector('[data-action="write"]') as HTMLButtonElement;
			assert.strictEqual(write.disabled, true, 'write is blocked while unresolved');
		} finally {
			dom.restore();
		}
	});

	test('next wraps and accept posts the current conflict and side', () => {
		const { dom, document } = mount();
		try {
			dom.post({ type: 'merge', state: state() });
			const bar = document.getElementById('diff-merge') as HTMLElement;
			(bar.querySelector('[data-action="next"]') as HTMLButtonElement).click();
			assert.match(bar.querySelector('.merge-bar-status')?.textContent ?? '', /2\/2/);
			(bar.querySelector('[data-action="next"]') as HTMLButtonElement).click();
			assert.match(bar.querySelector('.merge-bar-status')?.textContent ?? '', /1\/2/, 'next wraps');

			(bar.querySelector('[data-action="theirs"]') as HTMLButtonElement).click();
			assert.deepStrictEqual(messagesOf(dom.api, 'mergeResolve'), [
				{ type: 'mergeResolve', nodeId: 'container:Pkg/Mod/Cont#0/param:P#0', side: 'theirs' }
			]);
		} finally {
			dom.restore();
		}
	});

	test('write is enabled once every conflict is resolved and posts once', () => {
		const { dom, document } = mount();
		try {
			dom.post({ type: 'merge', state: state({ unresolved: 0 }) });
			const bar = document.getElementById('diff-merge') as HTMLElement;
			const write = bar.querySelector('[data-action="write"]') as HTMLButtonElement;
			assert.strictEqual(write.disabled, false);
			write.click();
			assert.strictEqual(messagesOf(dom.api, 'mergeWrite').length, 1);
		} finally {
			dom.restore();
		}
	});
});
