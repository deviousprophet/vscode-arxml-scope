/**
 * The single owner of the schema-release rule, shared by the ECUC scanner and the
 * streamed workspace-index builder so both read `xsi:schemaLocation` identically.
 */

/**
 * Schema release from `xsi:schemaLocation` (legacy §2.2): last whitespace token,
 * first `.`-segment, last `_`-segment, `-` replaced by `.`. `AUTOSAR_00048.xsd`
 * therefore yields `00048`.
 */
export function schemaReleaseFrom(schemaLocation: string): string | undefined {
	const tokens = schemaLocation.trim().split(/\s+/);
	const last = tokens[tokens.length - 1];
	if (!last) {
		return undefined;
	}
	const parts = last.split('.')[0].split('_');
	return parts[parts.length - 1].replace(/-/g, '.');
}
