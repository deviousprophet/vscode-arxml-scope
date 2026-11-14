/**
 * Shared fixture discovery for the parity scripts.
 *
 * Every `.arxml` under a directory, sorted, as absolute paths. Both parity runs
 * compare the same set, so the walk lives here once.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

export function fixtures(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.arxml'))
		.map((entry) => path.join(entry.parentPath ?? dir, entry.name))
		.sort();
}
