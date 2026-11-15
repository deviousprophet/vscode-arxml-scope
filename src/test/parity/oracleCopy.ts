/**
 * Parity oracle: prints the TypeScript copy plan for one JSON request.
 *
 * Test-only. `scripts/parityCopy.mjs` bundles this entry and compares it with
 * `arxml-cli copy --request …`.
 */
import { readFileSync } from 'node:fs';

import {
	indentationAt,
	lineBreakOf,
	planCopy,
	planDelete,
	wrapWithAncestors,
	type CopyRange,
	type MissingAncestor
} from '../../core/copy/planCopy';

interface Request {
	targetText: string;
	sourceText: string;
	kind?: 'copy' | 'delete';
	source: CopyRange;
	target?: CopyRange;
	anchorAfter?: CopyRange;
	anchorBefore?: CopyRange;
	ancestors?: MissingAncestor[];
}

const request = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Request;

if (request.kind === 'delete') {
	process.stdout.write(
		JSON.stringify(
			planDelete({ targetText: request.targetText, sourceText: '', target: request.target, targetIndent: '' })
		)
	);
} else if (request.ancestors !== undefined && request.ancestors.length > 0 && request.anchorAfter !== undefined) {
	const anchor = request.anchorAfter;
	const indent = indentationAt(request.targetText, anchor.start);
	const lineBreak = lineBreakOf(request.targetText);
	const block = wrapWithAncestors(
		request.sourceText.slice(request.source.start, request.source.end),
		indentationAt(request.sourceText, request.source.start),
		request.ancestors,
		indent,
		lineBreak
	);
	process.stdout.write(
		JSON.stringify({
			ok: true,
			span: { start: anchor.end, end: anchor.end, text: `${lineBreak}${indent}${block}` }
		})
	);
} else {
	process.stdout.write(
		JSON.stringify(
			planCopy({
				targetText: request.targetText,
				sourceText: request.sourceText,
				source: request.source,
				target: request.target,
				anchorAfter: request.anchorAfter,
				anchorBefore: request.anchorBefore,
				targetIndent:
					request.target !== undefined
						? indentationAt(request.targetText, request.target.start)
						: request.anchorAfter !== undefined
							? indentationAt(request.targetText, request.anchorAfter.start)
							: request.anchorBefore !== undefined
								? indentationAt(request.targetText, request.anchorBefore.start)
								: ''
			})
		)
	);
}
