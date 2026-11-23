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

/** One literal grammar the host applies to a fixed field. */
interface FieldRule {
	test(value: string): boolean;
	error: string;
}

const FIELD_RULES: Record<string, FieldRule> = {
	shortName: { test: isShortNameLiteral, error: 'Invalid short name' },
	definitionRef: { test: isDefinitionRefPath, error: 'Invalid definition reference' }
};

/**
 * The parameter-type grammars. These mirror the host's `validate_value`
 * grammar so an invalid draft never leaves the page; see `validate.ts`.
 */
const TYPE_RULES: Record<string, FieldRule> = {
	Integer: { test: isIntegerLiteral, error: 'Invalid integer value' },
	Float: { test: isFloatLiteral, error: 'Invalid float value' },
	Boolean: { test: isBooleanLiteral, error: 'Invalid boolean value' }
};

function isParameterValue(row: Pick<EcucRow, 'kind' | 'parameterType'>, field: string): boolean {
	return field === 'value' && row.kind === 'parameter';
}

function ruleError(rule: FieldRule, value: string): string | undefined {
	return rule.test(value) ? undefined : rule.error;
}

function literalFieldError(field: string, value: string): string | undefined {
	const rule = FIELD_RULES[field];
	return rule === undefined ? undefined : ruleError(rule, value);
}

function typeRuleFor(type: string | undefined): FieldRule | undefined {
	return type === undefined ? undefined : TYPE_RULES[type];
}

function parameterValueError(
	row: Pick<EcucRow, 'kind' | 'parameterType'>,
	field: string,
	value: string
): string | undefined {
	if (!isParameterValue(row, field)) {
		return undefined;
	}
	const rule = typeRuleFor(row.parameterType);
	return rule === undefined ? undefined : ruleError(rule, value);
}

/** The reason a draft cannot become a host edit, or `undefined` when it can. */
export function localValueError(
	row: Pick<EcucRow, 'kind' | 'parameterType'>,
	field: string,
	value: string
): string | undefined {
	if (!isXmlRepresentable(value)) {
		return 'XML cannot represent this character';
	}
	const literalError = literalFieldError(field, value);
	if (literalError !== undefined) {
		return literalError;
	}
	return parameterValueError(row, field, value);
}
