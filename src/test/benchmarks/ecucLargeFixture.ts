/**
 * The synthetic large ECUC-Values document shared by the benchmarks.
 *
 * Test-only. `arxmlDocument`/`arxmlPreamble` come from `benchmarkUtils`; the shape
 * is 12 modules x 36 containers x 3 containers x 56 parameters, about 26 MiB, with
 * a right-side variant that removes and changes values for the diff benchmark.
 */
import { arxmlDocument, arxmlPreamble, indent as indentBy } from './benchmarkUtils';

/** Synthetic document shape. */
const MODULE_COUNT = 12;
const CONTAINERS_PER_MODULE = 36;
const SUB_CONTAINERS_PER_CONTAINER = 2;
const PARAMETERS_PER_CONTAINER = 56;

export type FixtureSide = 'left' | 'right';

/** This fixture indents with four spaces per level. */
function indent(depth: number): string {
	return indentBy(depth, 4);
}

function parameterIndex(moduleIndex: number, containerIndex: number, slot: number, parameter: number): number {
	const containerId =
		(moduleIndex * CONTAINERS_PER_MODULE + containerIndex) * (SUB_CONTAINERS_PER_CONTAINER + 1) + slot;
	return containerId * PARAMETERS_PER_CONTAINER + parameter;
}

function isRemovedParameter(side: FixtureSide, index: number): boolean {
	return side === 'right' && index % 313 === 0;
}

function isNumericParameter(index: number): boolean {
	return index % 2 === 0;
}

function parameterValue(side: FixtureSide, index: number): number {
	// Every 97th value differs on the right side, giving the diff a `changed` row.
	return side === 'right' && index % 97 === 0 ? index + 1 : index % 100000;
}

function parameterTag(numeric: boolean): string {
	return numeric ? 'ECUC-NUMERICAL-PARAM-VALUE' : 'ECUC-TEXTUAL-PARAM-VALUE';
}

function parameterDest(numeric: boolean): string {
	return numeric ? 'ECUC-INTEGER-PARAM-DEF' : 'ECUC-STRING-PARAM-DEF';
}

function shownValue(numeric: boolean, value: number): string {
	return numeric ? String(value) : `value_${value}`;
}

function parameterBlock(
	lines: string[],
	depth: number,
	path: string,
	index: number,
	side: FixtureSide
): void {
	// A removed parameter on the right side gives the diff a `removed` row.
	if (isRemovedParameter(side, index)) {
		return;
	}
	const numeric = isNumericParameter(index);
	const value = parameterValue(side, index);
	const tag = parameterTag(numeric);
	const dest = parameterDest(numeric);
	lines.push(`${indent(depth)}<${tag}>`);
	lines.push(`${indent(depth + 1)}<DEFINITION-REF DEST="${dest}">${path}/Parameter${index}</DEFINITION-REF>`);
	lines.push(`${indent(depth + 1)}<VALUE>${shownValue(numeric, value)}</VALUE>`);
	lines.push(`${indent(depth)}</${tag}>`);
}

function containerShortName(moduleIndex: number, containerIndex: number, subIndex: number | null): string {
	return subIndex === null
		? `Container${moduleIndex}_${containerIndex}`
		: `SubContainer${moduleIndex}_${containerIndex}_${subIndex}`;
}

function containerSlot(subIndex: number | null): number {
	return subIndex === null ? 0 : subIndex + 1;
}

function pushParameters(
	lines: string[],
	depth: number,
	path: string,
	moduleIndex: number,
	containerIndex: number,
	slot: number,
	side: FixtureSide
): void {
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		parameterBlock(
			lines,
			depth + 2,
			path,
			parameterIndex(moduleIndex, containerIndex, slot, parameter),
			side
		);
	}
}

function pushSubContainers(
	lines: string[],
	depth: number,
	moduleIndex: number,
	containerIndex: number,
	side: FixtureSide
): void {
	lines.push(`${indent(depth + 1)}<SUB-CONTAINERS>`);
	for (let sub = 0; sub < SUB_CONTAINERS_PER_CONTAINER; sub++) {
		containerBlock(lines, depth + 2, moduleIndex, containerIndex, sub, side);
	}
	lines.push(`${indent(depth + 1)}</SUB-CONTAINERS>`);
}

function containerBlock(
	lines: string[],
	depth: number,
	moduleIndex: number,
	containerIndex: number,
	subIndex: number | null,
	side: FixtureSide
): void {
	const shortName = containerShortName(moduleIndex, containerIndex, subIndex);
	const path = `/SyntheticPkg/ModuleDefs/Module${moduleIndex}/${shortName}`;
	const slot = containerSlot(subIndex);
	lines.push(`${indent(depth)}<ECUC-CONTAINER-VALUE>`);
	lines.push(`${indent(depth + 1)}<SHORT-NAME>${shortName}</SHORT-NAME>`);
	lines.push(
		`${indent(depth + 1)}<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${path}</DEFINITION-REF>`
	);
	lines.push(`${indent(depth + 1)}<PARAMETER-VALUES>`);
	pushParameters(lines, depth, path, moduleIndex, containerIndex, slot, side);
	lines.push(`${indent(depth + 1)}</PARAMETER-VALUES>`);
	if (subIndex === null) {
		pushSubContainers(lines, depth, moduleIndex, containerIndex, side);
	}
	lines.push(`${indent(depth)}</ECUC-CONTAINER-VALUE>`);
}

/** Builds the synthetic ECUC-Values ARXML for one side of the comparison. */
export function buildEcucArxml(side: FixtureSide): string {
	const lines = arxmlPreamble(indent);
	for (let module = 0; module < MODULE_COUNT; module++) {
		lines.push(`${indent(4)}<ECUC-MODULE-CONFIGURATION-VALUES>`);
		lines.push(`${indent(5)}<SHORT-NAME>Module${module}</SHORT-NAME>`);
		lines.push(
			`${indent(5)}<DEFINITION-REF DEST="ECUC-MODULE-DEF">/SyntheticPkg/ModuleDefs/Module${module}</DEFINITION-REF>`
		);
		lines.push(
			`${indent(5)}<IMPLEMENTATION-CONFIG-VARIANT>VARIANT-PRE-COMPILE</IMPLEMENTATION-CONFIG-VARIANT>`
		);
		lines.push(`${indent(5)}<CONTAINERS>`);
		for (let container = 0; container < CONTAINERS_PER_MODULE; container++) {
			containerBlock(lines, 6, module, container, null, side);
		}
		lines.push(`${indent(5)}</CONTAINERS>`);
		lines.push(`${indent(4)}</ECUC-MODULE-CONFIGURATION-VALUES>`);
	}
	return arxmlDocument(lines, indent);
}
