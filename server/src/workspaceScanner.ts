import * as fs from 'fs';
import * as path from 'path';

const VBA_EXTENSIONS = new Set(['.bas', '.cls', '.frm']);
const SKIP_DIRS = new Set(['node_modules', 'out']);

/**
 * There's no VBA-project-equivalent file, so "the project" is every
 * .bas/.cls/.frm under the workspace folder. The server runs as a plain
 * Node process, so it can just walk the filesystem directly rather than
 * asking the client to enumerate files.
 */
export function findVbaFiles(rootDir: string): string[] {
	const results: string[] = [];
	walk(rootDir, results);
	return results;
}

function walk(dir: string, results: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
				continue;
			}
			walk(path.join(dir, entry.name), results);
		} else if (entry.isFile() && VBA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			results.push(path.join(dir, entry.name));
		}
	}
}
