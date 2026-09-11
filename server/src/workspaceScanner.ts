import * as fs from 'fs';
import * as path from 'path';

const VBA_EXTENSIONS = new Set(['.bas', '.cls', '.frm']);
const SKIP_DIRS = new Set(['node_modules', 'out']);

/** Safety net, not a feature limit — protects against a runaway scan (a
 * symlink/junction cycle, or a workspace folder far bigger than expected,
 * both real-world hazards especially on OneDrive/SharePoint-synced
 * folders) rather than a claim that a real VBA project can't exceed this. */
export const DEFAULT_MAX_FILES = 5000;

export interface ScanResult {
	files: string[];
	truncated: boolean;
}

/**
 * There's no VBA-project-equivalent file, so "the project" is every
 * .bas/.cls/.frm under the workspace folder. The server runs as a plain
 * Node process, so it can just walk the filesystem directly rather than
 * asking the client to enumerate files.
 */
export function findVbaFiles(rootDir: string, maxFiles = DEFAULT_MAX_FILES): ScanResult {
	const results: string[] = [];
	// Resolved (real) directory paths already visited, to detect symlink/
	// junction cycles — without this, a self-referential link anywhere in
	// the tree recurses forever, discovering "new" paths indefinitely and
	// exhausting memory long before maxFiles would ever be reached.
	const visitedRealDirs = new Set<string>();
	const truncated = walk(rootDir, results, visitedRealDirs, maxFiles);
	return { files: results, truncated };
}

/** Returns true if the walk hit maxFiles and stopped early. */
function walk(dir: string, results: string[], visitedRealDirs: Set<string>, maxFiles: number): boolean {
	let realDir: string;
	try {
		realDir = fs.realpathSync(dir);
	} catch {
		return false;
	}
	if (visitedRealDirs.has(realDir)) {
		return false;
	}
	visitedRealDirs.add(realDir);

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return false;
	}

	for (const entry of entries) {
		if (results.length >= maxFiles) {
			return true;
		}
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
				continue;
			}
			if (walk(path.join(dir, entry.name), results, visitedRealDirs, maxFiles)) {
				return true;
			}
		} else if (entry.isFile() && VBA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			results.push(path.join(dir, entry.name));
		}
	}
	return false;
}
