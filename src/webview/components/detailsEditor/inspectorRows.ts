/**
 * The Details inspector rows shared by the Monaco editor page and the legacy
 * DOM editor. The two pages differ only in where the body lives and whether a
 * container/value control receives local draft text; everything else is one
 * tree of labelled rows, condition tokens and host actions.
 */
import type { EcucRow } from '../../../core/ecuc/renderRows';
import {
	definitionRows,
	inspectorFields,
	type InspectorFields
} from '../sidebar/detailsPanel/detailsPanel';
import { detailsSelectionChanged } from './detailsEditor';
import { inspectorElement } from '../../render/dom';
import { appendConditionTokens } from '../../render/rowView';
import { postToHost } from '../../vscodeApi';

export interface InspectorRowsHost {
	/** The current Details body; null while the shell is not mounted. */
	body(): HTMLElement | null;
	emptyHint: string;
	containerFields(row: EcucRow, data: InspectorFields): HTMLElement;
	valueInput(row: EcucRow, data: InspectorFields): HTMLElement;
}

export interface InspectorRows {
	appendField(key: string, value: string): void;
	renderEmpty(): void;
	renderSelected(row: EcucRow): void;
}

export function createInspectorRows(host: InspectorRowsHost): InspectorRows {
	function appendElement(element: HTMLElement): void {
		host.body()?.appendChild(element);
	}

	function inspectorRow(key: string, value: string): HTMLElement {
		const row = inspectorElement('div', 'inspector-row');
		row.appendChild(inspectorElement('span', 'inspector-key', key));
		row.appendChild(inspectorElement('div', 'inspector-code', value));
		return row;
	}

	function conditionCodeRow(key: string, text: string): HTMLElement {
		const row = inspectorElement('div', 'inspector-row');
		row.appendChild(inspectorElement('span', 'inspector-key', key));
		const code = inspectorElement('div', 'inspector-code condition-code');
		appendConditionTokens(code, text, '');
		row.appendChild(code);
		return row;
	}

	function paneActions(): HTMLElement | undefined {
		const body = host.body();
		if (body === null) {
			return undefined;
		}
		const actions = inspectorElement('div', 'inspector-actions');
		body.appendChild(actions);
		return actions;
	}

	function appendField(key: string, value: string): void {
		appendElement(inspectorRow(key, value));
	}

	function renderEmpty(): void {
		detailsSelectionChanged(undefined);
		const emptyPanel = inspectorElement('div', 'inspector-empty');
		emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
		emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', host.emptyHint));
		appendElement(emptyPanel);
	}

	function renderIdentity(row: EcucRow, data: InspectorFields): void {
		appendElement(inspectorElement('div', 'inspector-kind', data.kind));
		appendElement(inspectorElement('div', 'inspector-label', data.label));
		if (row.kind === 'container') {
			appendElement(host.containerFields(row, data));
			return;
		}
		if (data.definitionRef) {
			appendField('Definition', data.definitionRef);
		}
		if (data.shortName) {
			appendField('Short name', data.shortName);
		}
	}

	function renderType(data: InspectorFields): void {
		if (data.variant) {
			appendField('Variant', data.variant);
		}
		if (data.type) {
			appendField('Type', data.type);
		}
	}

	function renderParameterValue(row: EcucRow, data: InspectorFields): void {
		if (data.kind === 'parameter') {
			appendElement(host.valueInput(row, data));
		}
		for (const format of data.formats) {
			appendField(format.label, format.value);
		}
	}

	function renderReferenceFields(row: EcucRow, data: InspectorFields): void {
		if (data.target) {
			appendField('Target', data.target);
		}
		if (row.followReason !== undefined) {
			appendField('Target note', row.followReason);
		}
		if (data.context) {
			appendField('Context', data.context);
		}
	}

	function renderCondition(condition: NonNullable<InspectorFields['condition']>): void {
		appendElement(conditionCodeRow('Condition', condition.text));
		appendField('Condition state', condition.state);
		if (condition.reason) {
			appendField('Condition note', condition.reason);
		}
	}

	function renderConditionFields(row: EcucRow, data: InspectorFields): void {
		if (data.condition) {
			renderCondition(data.condition);
		} else if (row.disabled && row.disabledBy === 'ancestor') {
			appendField('Disabled', 'Disabled by an ancestor condition.');
		}
	}

	function renderConditionSummary(data: InspectorFields): void {
		if (data.conditions) {
			appendElement(conditionCodeRow('Conditions', data.conditions));
		}
		if (data.annotations) {
			appendField('Annotations', data.annotations);
		}
	}

	function appendDefinitionCount(data: InspectorFields): void {
		if (data.definitionCount !== undefined && data.definitionCount >= 2) {
			appendField('Definition type', `${data.definitionCount} definitions found`);
		}
	}

	function renderDefinitionFields(data: InspectorFields): void {
		if (data.definition) {
			for (const field of definitionRows(data.definition)) {
				appendField(field.label, field.value);
			}
			return;
		}
		appendDefinitionCount(data);
	}

	function isFollowableReference(row: EcucRow): boolean {
		return row.kind === 'reference' && row.followable === true;
	}

	function appendJumpAction(actions: HTMLElement, row: EcucRow): void {
		if (!isFollowableReference(row)) {
			return;
		}
		const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target') as HTMLButtonElement;
		jump.type = 'button';
		jump.addEventListener('click', function () {
			postToHost({ type: 'follow', nodeId: row.id });
		});
		actions.appendChild(jump);
	}

	function appendReferencesAction(actions: HTMLElement, row: EcucRow): void {
		if (row.kind !== 'module' && row.kind !== 'container') {
			return;
		}
		const references = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Find references') as HTMLButtonElement;
		references.type = 'button';
		references.addEventListener('click', function () {
			postToHost({ type: 'references', nodeId: row.id });
		});
		actions.appendChild(references);
	}

	function appendRevealAction(actions: HTMLElement, row: EcucRow): void {
		const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source') as HTMLButtonElement;
		reveal.type = 'button';
		reveal.addEventListener('click', function () {
			postToHost({ type: 'reveal', nodeId: row.id });
		});
		actions.appendChild(reveal);
	}

	function renderActions(row: EcucRow): void {
		const actions = paneActions();
		if (actions === undefined) {
			return;
		}
		appendJumpAction(actions, row);
		appendReferencesAction(actions, row);
		appendRevealAction(actions, row);
	}

	function renderSelected(row: EcucRow): void {
		detailsSelectionChanged(row.id);
		const data = inspectorFields(row);
		renderIdentity(row, data);
		renderType(data);
		renderParameterValue(row, data);
		renderReferenceFields(row, data);
		renderConditionFields(row, data);
		renderConditionSummary(data);
		renderDefinitionFields(data);
		renderActions(row);
	}

	return { appendField, renderEmpty, renderSelected };
}
