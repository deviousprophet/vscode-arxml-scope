/**
 * One open engine document.
 *
 * The engine owns the text, the model and the rows; this adapter owns the request
 * shapes and keeps the last row store, so a change can be answered with the
 * contiguous row replacement the engine computes instead of a full rebuild.
 */
import type { EngineClient } from './engineClient';

/** The subset of an engine row the host reads. `unknown` fields pass through untouched. */
export interface EngineRow {
	id: string;
	kind: string;
	[key: string]: unknown;
}

export interface EngineHeader {
	modules: number;
	containers: number;
	parameters: number;
}

export interface EnginePlan {
	ok: boolean;
	record?: { nodeId: string; region: string; oldText: string; newText: string };
	nextNodeId?: string;
	reason?: string;
}

export interface DocumentOptions {
	sort: 'all' | 'declaration';
	sortExcept: string[];
	conditions?: Record<string, string | number | boolean>;
}

export class EngineDocument {
	private constructor(
		private readonly client: EngineClient,
		readonly docId: number,
		readonly uri: string,
		private rowStore: EngineRow[],
		private header: EngineHeader
	) {}

	/** Uploads the text once; every later change is a small delta. */
	public static async open(
		client: EngineClient,
		uri: string,
		text: string,
		options: DocumentOptions
	): Promise<EngineDocument> {
		const opened = await client.request('doc.open', { uri }, text);
		const docId = opened.header.docId;
		if (typeof docId !== 'number' || !Number.isInteger(docId)) {
			throw new Error('engine did not return a document id');
		}
		const document = new EngineDocument(client, docId, uri, [], {
			modules: Number(opened.header.modules ?? 0),
			containers: Number(opened.header.containers ?? 0),
			parameters: Number(opened.header.parameters ?? 0)
		});
		const rows = await document.loadRows(options);
		document.rowStore = rows;
		return document;
	}

	public rows(): readonly EngineRow[] {
		return this.rowStore;
	}

	public counts(): EngineHeader {
		return this.header;
	}

	private async loadRows(options: DocumentOptions): Promise<EngineRow[]> {
		const chunks = await this.client.requestStream('doc.rows', {
			docId: this.docId,
			options
		});
		const rows: EngineRow[] = [];
		for (const chunk of chunks) {
			if (chunk.body.length === 0) {
				continue;
			}
			const parsed = JSON.parse(chunk.body.toString('utf8')) as EngineRow[];
			rows.push(...parsed);
		}
		return rows;
	}

	public async plan(
		kind: 'value' | 'field',
		nodeId: string,
		value: string,
		field?: string
	): Promise<EnginePlan> {
		const result = await this.client.request('doc.plan', { docId: this.docId, kind, nodeId, value, field });
		return JSON.parse(result.body.toString('utf8')) as EnginePlan;
	}

	public async close(): Promise<void> {
		if (this.client.isClosed) {
			return;
		}
		try {
			await this.client.request('doc.close', { docId: this.docId }, undefined, 2000);
		} catch {
			// A closed engine has already dropped every handle.
		}
	}
}
