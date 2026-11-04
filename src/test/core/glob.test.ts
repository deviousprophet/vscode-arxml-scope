import * as assert from 'assert';

import { compileExcludes } from '../../core/index/glob';

suite('exclusion globs (core)', () => {
	test('an empty list excludes nothing', () => {
		const excluded = compileExcludes([]);
		assert.strictEqual(excluded('a/b.arxml'), false);
	});

	test('** matches zero or more segments', () => {
		const excluded = compileExcludes(['**/_fwd/**', '**/_out/**']);
		assert.strictEqual(excluded('_fwd/a.arxml'), true);
		assert.strictEqual(excluded('project/_fwd/a.arxml'), true);
		assert.strictEqual(excluded('project/_out/deep/a.arxml'), true);
		assert.strictEqual(excluded('project/src/a.arxml'), false);
	});

	test('* and ? stay inside one segment', () => {
		const star = compileExcludes(['src/*.arxml']);
		assert.strictEqual(star('src/a.arxml'), true);
		assert.strictEqual(star('src/deep/a.arxml'), false);

		const question = compileExcludes(['src/Mod?.arxml']);
		assert.strictEqual(question('src/Mod1.arxml'), true);
		assert.strictEqual(question('src/Mod12.arxml'), false);
	});

	test('a wildcard-free trailing slash is a prefix', () => {
		const excluded = compileExcludes(['generated/']);
		assert.strictEqual(excluded('generated/a.arxml'), true);
		assert.strictEqual(excluded('generated/deep/a.arxml'), true);
		assert.strictEqual(excluded('other/generated/a.arxml'), false);
	});

	test('backslashes are normalized to workspace separators', () => {
		const excluded = compileExcludes(['gen/**']);
		assert.strictEqual(excluded('gen\\a.arxml'), true);
	});
});
