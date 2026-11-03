/**
 * ECUC validation rules and severity settings.
 *
 * The rule names are stable: they are the diagnostic codes and the keys in the
 * per-rule setting. `normalizeSeverities` is the one boundary for untrusted
 * settings input.
 */
import type { Range } from '../ecuc/model';

export type DiagnosticRule =
	| 'brokenReference'
	| 'destMismatch'
	| 'duplicateShortName'
	| 'valueOutOfRange'
	| 'multiplicity'
	| 'missingDefinition'
	| 'missingRequired';

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'off';
export type DiagnosticLevel = Exclude<DiagnosticSeverity, 'off'>;

export interface EcucDiagnostic {
	rule: DiagnosticRule;
	severity: DiagnosticLevel;
	message: string;
	file: string;
	range: Range;
}

export type SeveritySettings = Record<DiagnosticRule, DiagnosticSeverity>;

export const DIAGNOSTIC_RULES: readonly DiagnosticRule[] = [
	'brokenReference',
	'destMismatch',
	'duplicateShortName',
	'valueOutOfRange',
	'multiplicity',
	'missingDefinition',
	'missingRequired',
];

export const DEFAULT_SEVERITIES: SeveritySettings = {
	brokenReference: 'error',
	destMismatch: 'warning',
	duplicateShortName: 'error',
	valueOutOfRange: 'warning',
	multiplicity: 'warning',
	missingDefinition: 'information',
	missingRequired: 'warning',
};

/** Normalizes a settings object; unknown rules and values fall back to the default. */
export function normalizeSeverities(input: unknown): SeveritySettings {
	const out: SeveritySettings = { ...DEFAULT_SEVERITIES };
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return out;
	}
	const source = input as Record<string, unknown>;
	for (const rule of DIAGNOSTIC_RULES) {
		const value = source[rule];
		if (value === 'error' || value === 'warning' || value === 'information' || value === 'off') {
			out[rule] = value;
		}
	}
	return out;
}
