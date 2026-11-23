/**
 * Local ECUC value validation.
 *
 * A draft is shown and kept locally while it is invalid; only a valid value ever
 * becomes a host edit. The literals, short-name and definition-ref grammars come
 * from the host's own `validate.ts`, so a wrong intermediate (`-`, `0x`, `tru`)
 * blocks Ctrl+S exactly when the host would refuse it.
 */
import type { EcucRow } from './renderRows';
import {
	isBooleanLiteral,
	isDefinitionRefPath,
	isFloatLiteral,
	isIntegerLiteral,
	isShortNameLiteral,
	isXmlRepresentable
} from './validate';

/** The reason a draft cannot become a host edit, or `undefined` when it can. */
export function localValueError(
	row: Pick<EcucRow, 'kind' | 'parameterType'>,
	field: string,
	value: string
): string | undefined {
	if (!isXmlRepresentable(value)) {
		return 'XML cannot represent this character';
	}
	if (field === 'shortName') {
		return isShortNameLiteral(value) ? undefined : 'Invalid short name';
	}
	if (field === 'definitionRef') {
		return isDefinitionRefPath(value) ? undefined : 'Invalid definition reference';
	}
	if (field !== 'value' || row.kind !== 'parameter') {
		return undefined;
	}
	const type = row.parameterType;
	// These mirror the host's `validate_value` grammar so an invalid draft never
	// leaves the page; see `validate.ts`.
	if (type === 'Integer' && !isIntegerLiteral(value)) {
		return 'Invalid integer value';
	}
	if (type === 'Float' && !isFloatLiteral(value)) {
		return 'Invalid float value';
	}
	if (type === 'Boolean' && !isBooleanLiteral(value)) {
		return 'Invalid boolean value';
	}
	return undefined;
}
