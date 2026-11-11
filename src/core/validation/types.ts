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
export type CrossFileMode = 'auto' | 'always' | 'never';

export interface DiagnosticRelated {
	file: string;
	range: Range;
	message: string;
}

export interface EcucDiagnostic {
	rule: DiagnosticRule;
	severity: DiagnosticLevel;
	message: string;
	file: string;
	range: Range;
	related?: DiagnosticRelated[];
}

export type SeveritySettings = Record<DiagnosticRule, DiagnosticSeverity>;

const DIAGNOSTIC_RULES: readonly DiagnosticRule[] = [
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

/** True for an object that can carry rule keys; arrays and null are not settings. */
function isSettingsInput(input: unknown): input is Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		return false;
	}
	return true;
}

/** True for one of the four accepted severity values. */
function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
	return value === 'error' || value === 'warning' || value === 'information' || value === 'off';
}

/** Normalizes a settings object; unknown rules and values fall back to the default. */
export function normalizeSeverities(input: unknown): SeveritySettings {
	const out: SeveritySettings = { ...DEFAULT_SEVERITIES };
	if (!isSettingsInput(input)) {
		return out;
	}
	for (const rule of DIAGNOSTIC_RULES) {
		const value = input[rule];
		if (isDiagnosticSeverity(value)) {
			out[rule] = value;
		}
	}
	return out;
}
