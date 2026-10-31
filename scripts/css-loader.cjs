/**
 * Test-host loader for colocated component stylesheets.
 *
 * The extension bundle gets the real text through esbuild's `.css` text loader.
 * The `tsc` output used by `vscode-test` keeps `require('./Component.css')`, so
 * this hook returns an empty string for those files. The rendered CSS is
 * asserted through the extension module side, not through `require`.
 */
const fs = require('fs');

require.extensions['.css'] = (module, filename) => {
	module.exports = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
};
