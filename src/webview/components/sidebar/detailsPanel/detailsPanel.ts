/**
 * Details panel: the one panel body that turns host-provided row fields into
 * labels, values, actions and status. It owns the markup and the pure row ->
 * fields projection; the composition root paints the body from row data.
 */
import './detailsPanel.css';
import type { EcucRow, MetaPart, ParameterFormat, RowCondition } from '../../../../core/ecuc/renderRows';
import type { DefinitionInfo } from '../../../../core/index/definitions';

/** The fields the details panel shows, read from a row (not from a DOM node). */
export interface InspectorFields {
	kind: string;
	label: string;
	definitionRef: string;
	shortName: string;
	variant: string;
	type: string;
	value: string;
	formats: ParameterFormat[];
	target: string;
	context: string;
	conditions: string;
	annotations: string;
	condition?: RowCondition;
	definition?: DefinitionInfo;
	definitionCount?: number;
}

/**
 * Reads the inspector's fields from the row data. The panel therefore works for
 * a selected row that is outside the rendered window; it never queries the tree
 * DOM. The test and the panel share one definition.
 */
export function inspectorFields(row: EcucRow): InspectorFields {
	return {
		...identityFields(row),
		...variantFields(row),
		...parameterFields(row),
		...referenceFields(row),
		...contextFields(row),
		...optionalFields(row),
	};
}

function identityFields(row: EcucRow): Pick<InspectorFields, 'kind' | 'label' | 'definitionRef' | 'shortName'> {
	return {
		kind: row.kind,
		label: row.label,
		definitionRef: row.definitionRef,
		shortName: row.shortName ?? '',
	};
}

function variantFields(row: EcucRow): Pick<InspectorFields, 'variant'> {
	return { variant: firstMetaText(row, 'variant') };
}

function parameterFields(row: EcucRow): Pick<InspectorFields, 'type' | 'value' | 'formats'> {
	return {
		type: row.parameterType ?? '',
		value: row.value ?? '',
		formats: row.formats ?? [],
	};
}

function referenceFields(row: EcucRow): Pick<InspectorFields, 'target'> {
	return { target: row.target ?? '' };
}

function contextFields(row: EcucRow): Pick<InspectorFields, 'context' | 'conditions' | 'annotations'> {
	return {
		context: inspectorContext(row),
		// The own syscond has its own Condition rows; this one keeps the post-build
		// conditions so the same text is never shown twice.
		conditions: inspectorConditions(row),
		annotations: metaTexts(row, 'annotation').join('\n'),
	};
}

function optionalFields(row: EcucRow): Pick<InspectorFields, 'condition' | 'definition' | 'definitionCount'> {
	return {
		...(row.condition === undefined ? {} : { condition: row.condition }),
		...(row.definition === undefined ? {} : { definition: row.definition }),
		...(row.definitionCount === undefined ? {} : { definitionCount: row.definitionCount }),
	};
}

/** Every meta part text of one class, in display order. */
function metaTexts(row: EcucRow, cls: MetaPart['cls']): string[] {
	return row.meta.filter((part) => part.cls === cls).map((part) => part.text);
}

function firstMetaText(row: EcucRow, cls: MetaPart['cls']): string {
	return metaTexts(row, cls)[0] ?? '';
}

function inspectorContext(row: EcucRow): string {
	return contextValue(row.contextPaths, firstMetaText(row, 'context'));
}

function contextValue(paths: readonly string[] | undefined, text: string): string {
	if (paths && paths.length > 0) {
		return paths.join(', ');
	}
	return stripContextPrefix(text);
}

function stripContextPrefix(text: string): string {
	return text.startsWith('context ') ? text.slice('context '.length) : text;
}

function inspectorConditions(row: EcucRow): string {
	const ownCondition = row.condition === undefined ? undefined : `[${row.condition.text}]`;
	return metaTexts(row, 'condition')
		.filter((text) => text !== ownCondition)
		.join('\n');
}

/**
 * Whether a field refusal is already shown beside the field in the details panel.
 * Field edits are answered inline by the details editor; the page must not also
 * write a second, stale copy elsewhere.
 */
export function refusalShownInDetails(message: { inline?: boolean }, detailsHidden: boolean): boolean {
	return message.inline === true && detailsHidden === false;
}

/** One label/value row the Details body paints. */
export interface InspectorField {
	label: string;
	value: string;
}

/**
 * The definition block, in the documented order. Only fields the definition
 * provides appear; the file row is always last so provenance never reads as a
 * declaration detail.
 */
export function definitionRows(definition: DefinitionInfo): InspectorField[] {
	const rows: InspectorField[] = [{ label: 'Definition type', value: definition.type }];
	appendOptionalDefinitionRows(rows, definition);
	// The file row is always last so provenance never reads as a declaration detail.
	rows.push({ label: 'Definition file', value: definition.fileName });
	return rows;
}

function appendOptionalDefinitionRows(rows: InspectorField[], definition: DefinitionInfo): void {
	appendField(rows, 'Range', definition.range);
	appendField(rows, 'Default', definition.defaultValue);
	appendField(rows, 'Multiplicity', definition.multiplicity);
	appendLiterals(rows, definition);
	appendField(rows, 'Destination', definition.destination);
	appendField(rows, 'Definition description', definition.description);
}

function appendField(rows: InspectorField[], label: string, value: string | undefined): void {
	if (value !== undefined) {
		rows.push({ label, value });
	}
}

function appendLiterals(rows: InspectorField[], definition: DefinitionInfo): void {
	if (definition.literals !== undefined && definition.literals.length > 0) {
		rows.push({ label: 'Values', value: definition.literals.join(', ') });
	}
}

/** The Details tab panel: one stable section header and body. */
export function renderDetailsPanelHtml(): string {
	return `<div id="sbp-details" class="sb-tab-panel active" role="tabpanel" aria-labelledby="stab-details">
<div id="inspector" class="inspector sb-pane-view" role="region" aria-label="Node details">
<section class="sb-section sb-pane" id="sb-details" data-pane-id="sb-details">
<div class="sb-section-head" role="button" tabindex="0" aria-expanded="true" aria-controls="sb-details-body" aria-label="Details">
<span class="sb-section-chevron" aria-hidden="true"></span>
<h3 class="sb-section-title" id="sb-details-title"><span class="sb-section-label">Details</span></h3>
</div>
<div class="sb-body" id="sb-details-body" role="region" aria-labelledby="sb-details-title">
<div class="inspector-empty"><p>Select a line to see its details.</p><p class="inspector-hint">Click a line or press Space.</p></div>
</div>
</section>
</div>
<div id="details-status" class="details-status" role="status" aria-live="polite"></div>
</div>`;
}

