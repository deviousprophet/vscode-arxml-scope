/**
 * Shared fixtures and measurement primitives for the synthetic benchmarks.
 *
 * Test-only: production code never imports this module, and nothing here runs
 * at import time. Each benchmark keeps its own fixture sizes, thresholds,
 * `_type` records and console messages; this module owns only the shapes they
 * genuinely share.
 */
import { performance } from 'node:perf_hooks';
import { buildDiffDocument } from '../../core/diff/diffModel';
import type { DiffDocument } from '../../core/diff/diffModel';
import type { EcucRow } from '../../core/ecuc/renderRows';

/** Synthetic ARXML indentation: two spaces per level unless a fixture differs. */
export function indent(depth: number, size = 2): string {
	return ' '.repeat(depth * size);
}

/** Forces a collection, then returns the retained heap plus array buffers in bytes. */
export function retainedBytes(): number {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	global.gc();
	const memory = process.memoryUsage();
	return memory.heapUsed + memory.arrayBuffers;
}

export interface RetainedDelta {
	/** Unrounded byte delta, for a byte-exact limit check. */
	retained: number;
	/** Rounded MiB delta, the value every record reports. */
	retainedMiB: number;
}

/** The heap growth since `before`. */
export function retainedDelta(before: number): RetainedDelta {
	const retained = Math.max(0, retainedBytes() - before);
	return { retained, retainedMiB: Math.round(retained / 1048576) };
}

export interface Measurement<T> extends RetainedDelta {
	value: T;
	elapsedMs: number;
}

/** Runs one stage and returns its value, elapsed milliseconds and retained bytes. */
export function measureStage<T>(action: () => T): Measurement<T> {
	const before = retainedBytes();
	const started = performance.now();
	const value = action();
	const elapsedMs = Math.round(performance.now() - started);
	return { value, elapsedMs, ...retainedDelta(before) };
}

/** One container row of the nested `Parent -> Child -> parameter` fixtures. */
export function containerRow(
	id: string,
	parentId: string | null,
	shortName: string,
	definitionRef: string,
	children: number
): EcucRow {
	return {
		id,
		kind: 'container',
		level: parentId === null ? 1 : 2,
		parentId,
		subtreeSize: children,
		posinset: 1,
		setsize: 1,
		hasChildren: children > 0,
		label: shortName,
		shortName,
		definitionRef,
		title: definitionRef,
		meta: [],
		haystack: shortName.toLowerCase(),
	};
}

export interface ParameterRowOptions {
	id: string;
	parentId: string;
	/** The definition-ref tail; also the default label and the haystack word. */
	name: string;
	value: string;
	parameterType: string;
	valueKind: 'numeric' | 'textual';
	/** Defaults to `name`. */
	label?: string;
	/** Defaults to `/D/Child/<name>`. */
	definitionRef?: string;
	/** Defaults to the lower-cased `<name> <value>`. */
	haystack?: string;
}

/** One parameter row at tree level 3, the shape every rename fixture uses. */
export function parameterRow(options: ParameterRowOptions): EcucRow {
	const definitionRef = options.definitionRef ?? `/D/Child/${options.name}`;
	return {
		id: options.id,
		kind: 'parameter',
		level: 3,
		parentId: options.parentId,
		subtreeSize: 0,
		posinset: 1,
		setsize: 1,
		hasChildren: false,
		label: options.label ?? options.name,
		definitionRef,
		parameterType: options.parameterType,
		value: options.value,
		valueKind: options.valueKind,
		shownValue: options.value,
		title: definitionRef,
		meta: [],
		haystack: options.haystack ?? `${options.name} ${options.value}`.toLowerCase(),
	};
}

/**
 * `ParentN` containers, each with `childCounts[parent]` children and one `P`
 * parameter per child. A parent's `subtreeSize` counts its two rows per child.
 */
export function containerRows(prefix: string, childCounts: readonly number[]): EcucRow[] {
	const out: EcucRow[] = [];
	for (let parent = 0; parent < childCounts.length; parent++) {
		const parentId = `container:Root/Parent${parent}#0`;
		const children = childCounts[parent];
		out.push(containerRow(parentId, null, `Parent${parent}`, '/D/Parent', children * 2));
		for (let child = 0; child < children; child++) {
			const childId = `${parentId}/${prefix}_MO_${parent}_${child}#0`;
			const value = String(child);
			out.push(containerRow(childId, parentId, `${prefix}_MO_${parent}_${child}`, '/D/Child', 1));
			out.push(
				parameterRow({
					id: `${childId}/param:P#0`,
					parentId: childId,
					name: 'P',
					value,
					parameterType: 'Integer',
					valueKind: 'numeric',
					haystack: `p ${value}`,
				})
			);
		}
	}
	return out;
}

export interface SemanticDiffMeasurement {
	document: DiffDocument;
	/** Both row sets together, the record's `sourceRows`. */
	sourceRows: number;
	elapsedMs: number;
	retainedMiB: number;
}

/** Measures the two-file semantic diff the rename fixtures compare. */
export function measureSemanticDiff(leftRows: EcucRow[], rightRows: EcucRow[]): SemanticDiffMeasurement {
	const sourceRows = leftRows.length + rightRows.length;
	const measured = measureStage(() =>
		buildDiffDocument(
			{ name: 'left.arxml', path: '/work/left.arxml' },
			{ name: 'right.arxml', path: '/work/right.arxml' },
			leftRows,
			rightRows,
			undefined,
			undefined,
			undefined,
			{ semanticMatching: true }
		)
	);
	return {
		document: measured.value,
		sourceRows,
		elapsedMs: measured.elapsedMs,
		retainedMiB: measured.retainedMiB,
	};
}

/**
 * Opens the AUTOSAR package scaffold both synthetic ECUC fixtures share.
 * `indentOf` owns that fixture's indentation width.
 */
export function arxmlPreamble(indentOf: (depth: number) => string): string[] {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">',
		`${indentOf(1)}<AR-PACKAGES>`,
		`${indentOf(2)}<AR-PACKAGE>`,
		`${indentOf(3)}<SHORT-NAME>SyntheticPkg</SHORT-NAME>`,
		`${indentOf(3)}<ELEMENTS>`,
	];
}

/** Closes the scaffold and returns the joined source. */
export function arxmlDocument(lines: string[], indentOf: (depth: number) => string): string {
	lines.push(`${indentOf(3)}</ELEMENTS>`);
	lines.push(`${indentOf(2)}</AR-PACKAGE>`);
	lines.push(`${indentOf(1)}</AR-PACKAGES>`);
	lines.push('</AUTOSAR>');
	return lines.join('\n');
}
