/**
 * The guarded boot-error surface: the console-only editor reporter and the
 * diff notice strip. Both listeners are driven directly, so the exact message
 * text and the `data-kind` write are the contract.
 */
import * as assert from 'assert';

import { installConsoleErrors, installNoticeErrors } from '../../../webview/render/pageError';

type Listener = (event: unknown) => void;

interface RecordingWindow {
	listeners: Map<string, Listener>;
	window: { addEventListener(type: string, listener: Listener): void };
}

function recordingWindow(): RecordingWindow {
	const listeners = new Map<string, Listener>();
	return {
		listeners,
		window: {
			addEventListener(type: string, listener: Listener) {
				listeners.set(type, listener);
			},
		},
	};
}

function withDataset(): { textContent: string; dataset: { kind?: string } } {
	return { textContent: '', dataset: {} };
}

suite('page error surface', () => {
	test('the console reporter keeps the label, message and source line', () => {
		const target = recordingWindow();
		const logged: string[] = [];
		const surface = installConsoleErrors(target.window, { error: (text) => logged.push(text) }, 'ECUC editor');

		surface.report('boom');
		target.listeners.get('error')!({ message: 'kaput', lineno: 12 });
		target.listeners.get('error')!({});
		target.listeners.get('error')!({ message: 42, lineno: 0 });
		target.listeners.get('error')!(undefined);
		target.listeners.get('unhandledrejection')!({ reason: 'bad' });
		target.listeners.get('unhandledrejection')!({});

		assert.deepStrictEqual(logged, [
			'ECUC editor: boom',
			'ECUC editor: kaput (line 12)',
			'ECUC editor: unknown error',
			'ECUC editor: 42',
			'ECUC editor: unknown error',
			'ECUC editor: bad',
			'ECUC editor: undefined',
		]);
	});

	test('the notice surface writes the message, the hint and kind', () => {
		const notice = withDataset();
		const target = recordingWindow();
		const surface = installNoticeErrors(
			{ getElementById: (id) => (id === 'notice' ? notice : null) },
			target.window,
			{ noticeId: 'notice', label: 'The diff page failed' }
		);

		target.listeners.get('error')!({ message: 'kaput', lineno: 12 });
		assert.deepStrictEqual(notice, {
			textContent:
				'The diff page failed: kaput (line 12). Open Developer: Open Webview Developer Tools for the stack.',
			dataset: { kind: 'warn' },
		});

		surface.report('direct');
		assert.deepStrictEqual(notice, { textContent: 'direct', dataset: { kind: 'warn' } });

		target.listeners.get('unhandledrejection')!({ reason: 'bad' });
		assert.deepStrictEqual(notice, {
			textContent: 'The diff page failed: bad. Open Developer: Open Webview Developer Tools for the stack.',
			dataset: { kind: 'warn' },
		});
	});

	test('a missing notice or a notice without a dataset is inert', () => {
		const target = recordingWindow();
		const missing = installNoticeErrors(
			{ getElementById: () => null },
			target.window,
			{ noticeId: 'notice', label: 'X' }
		);
		assert.doesNotThrow(() => {
			missing.report('ignored');
			target.listeners.get('error')!({ message: 'ignored' });
		});

		const plain = { textContent: '' };
		const plainTarget = recordingWindow();
		const plainSurface = installNoticeErrors(
			{ getElementById: () => plain },
			plainTarget.window,
			{ noticeId: 'notice', label: 'L' }
		);
		plainTarget.listeners.get('error')!({ message: 'm', lineno: 1 });
		plainSurface.report('r');
		assert.strictEqual(
			plain.textContent,
			'r',
			'the message is written and the absent dataset is skipped'
		);
	});
});
