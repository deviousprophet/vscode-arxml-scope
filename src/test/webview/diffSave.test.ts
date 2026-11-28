/**
 * The page's save-target decision. Dirtiness is host-owned; the page only
 * chooses which side a `Ctrl+S` gesture names.
 */
import * as assert from 'assert';
import { labelIsDirty, saveTargetSide } from '../../webview/monaco/diffSave';

const dirtyIn =
	(...dirty: Array<'left' | 'right'>) =>
	(side: 'left' | 'right'): boolean =>
		dirty.includes(side);

suite('diff save target', () => {
	test('the host dirty marker is the trailing bullet', () => {
		assert.strictEqual(labelIsDirty('right.arxml •'), true);
		assert.strictEqual(labelIsDirty('right.arxml'), false);
		assert.strictEqual(labelIsDirty(undefined), false);
	});
	test('the focused dirty side wins, including when both sides are dirty', () => {
		assert.strictEqual(saveTargetSide('right', undefined, dirtyIn('right')), 'right');
		assert.strictEqual(saveTargetSide('left', undefined, dirtyIn('left')), 'left');
		assert.strictEqual(saveTargetSide('left', 'right', dirtyIn('left', 'right')), 'left');
		assert.strictEqual(saveTargetSide('right', 'left', dirtyIn('left', 'right')), 'right');
	});
	test('a clean focused side falls back to the still-dirty copy receiver', () => {
		assert.strictEqual(saveTargetSide('left', 'right', dirtyIn('right')), 'right');
		assert.strictEqual(saveTargetSide('right', 'left', dirtyIn('left')), 'left');
	});
	test('a clean diff saves nothing', () => {
		assert.strictEqual(saveTargetSide('left', undefined, dirtyIn()), undefined);
		assert.strictEqual(saveTargetSide(undefined, 'right', dirtyIn()), undefined);
		assert.strictEqual(saveTargetSide(undefined, undefined, dirtyIn('left', 'right')), undefined);
	});
});
