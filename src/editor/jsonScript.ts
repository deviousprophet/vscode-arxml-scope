/**
 * One JSON encoder for every inline `<script type="application/json">` payload.
 *
 * JSON itself allows `<`, `>`, `&` and the JavaScript line separators inside a
 * string. Escaping them keeps a model value from closing the script element or
 * changing how the page's script is parsed. Both the ECUC editor page and the
 * diff page embed data this way, so they must not grow separate encoders.
 */
export function encodeJsonForScript(value: unknown): string {
	const json = JSON.stringify(value);
	return (json === undefined ? 'null' : json)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}
