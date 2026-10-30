/**
 * One text/attribute escaper for the host-built HTML shells.
 *
 * The shells are static and the model data travels as JSON; this helper only
 * protects the file and package labels interpolated into text or attributes.
 * Escaping quotes is harmless in text and required in attributes, so both pages
 * share this one implementation.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
