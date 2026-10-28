/**
 * Shared loader for the compiled `out/` modules used by the dev scripts.
 * Plain Node, built-ins only; the dev scripts are not imported by the extension.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');

function outModule(relative) {
	const file = path.join(OUT, relative);
	if (!fs.existsSync(file)) {
		throw new Error('Missing ' + file + '. Run `npm run compile-tests` first.');
	}
	return require(file);
}

module.exports = { ROOT, outModule };
