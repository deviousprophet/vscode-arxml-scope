/**
 * Details panel: the one panel body that turns host-provided row fields into
 * labels, values, actions and status. It owns the markup and the pure row ->
 * fields projection; the composition root paints the body from row data.
 */
import './detailsPanel.css';
import type { EcucRow, MetaPart, ParameterFormat, RowCondition } from '../../../../core/ecuc/renderRows';

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
}

/**
 * Reads the inspector's fields from the row data. The panel therefore works for
 * a selected row that is outside the rendered window; it never queries the tree
 * DOM. The test and the panel share one definition.
 */
export function inspectorFields(row: EcucRow): InspectorFields {
	const parts = (cls: MetaPart['cls']): string[] =>
		row.meta.filter((part) => part.cls === cls).map((part) => part.text);
	const contextText = parts('context')[0] ?? '';
	const context =
		row.contextPaths && row.contextPaths.length > 0
			? row.contextPaths.join(', ')
			: contextText.startsWith('context ')
				? contextText.slice('context '.length)
				: contextText;
	const ownCondition = row.condition === undefined ? undefined : `[${row.condition.text}]`;
	return {
		kind: row.kind,
		label: row.label,
		definitionRef: row.definitionRef,
		shortName: row.shortName ?? '',
		variant: parts('variant')[0] ?? '',
		type: row.parameterType ?? '',
		value: row.value ?? '',
		formats: row.formats ?? [],
		target: row.target ?? '',
		context,
		// The own syscond has its own Condition rows; this one keeps the post-build
		// conditions so the same text is never shown twice.
		conditions: parts('condition')
			.filter((text) => text !== ownCondition)
			.join('\n'),
		annotations: parts('annotation').join('\n'),
		...(row.condition === undefined ? {} : { condition: row.condition }),
	};
}

/**
 * Whether a field refusal is already shown beside the field in the details panel.
 * Field edits are answered inline by the details editor; the page must not also
 * write a second, stale copy elsewhere.
 */
export function refusalShownInDetails(message: { inline?: boolean }, detailsHidden: boolean): boolean {
	return message.inline === true && detailsHidden === false;
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

