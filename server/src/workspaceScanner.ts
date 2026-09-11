import * as fs from 'fs';
import * as path from 'path';

const VBA_EXTENSIONS = new Set(['.bas', '.cls', '.frm']);
const SKIP_DIRS = new Set(['node_modules', 'out']);

/**
 * Safety nets, not feature limits — protect against a runaway scan rather
 * than claim a real VBA project can't exceed these. Both are needed, not
 * just the file cap: a workspace folder that's mostly *not* a VBA project
 * (a huge general-purpose file share with only a few real .bas/.cls/.frm
 * files scattered through it — plausible, and observed, on an
 * OneDrive/SharePoint-synced folder) can walk an enormous directory tree
 * without ever finding enough matching files to trip DEFAULT_MAX_FILES.
 * The time budget bounds the walk regardless of *why* it's large or slow
 * (a huge tree, a symlink cycle, or a slow network/cloud-backed drive
 * where each fs call itself is slow) — it's the one dimension that always
 * protects the server, so it's checked most often (every directory).
 */
export const DEFAULT_MAX_FILES = 5000;
export const DEFAULT_MAX_DURATION_MS = 5000;

export interface ScanResult {
	files: string[];
	truncated: boolean;
}

export interface ScanOptions {
	maxFiles?: number;
	maxDurationMs?: number;
}

/**
 * There's no VBA-project-equivalent file, so "the project" is every
 * .bas/.cls/.frm under the workspace folder. The server runs as a plain
 * Node process, so it can just walk the filesystem directly rather than
 * asking the client to enumerate files.
 */
export function findVbaFiles(rootDir: string, options: ScanOptions = {}): ScanResult {
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const deadline = Date.now() + (options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS);
	const results: string[] = [];
	// Resolved (real) directory paths already visited, to detect symlink/
	// junction cycles — without this a self-referential link recurses
	// forever, discovering "new" paths indefinitely; this alone doesn't
	// bound a merely-huge (acyclic) tree, which is what the deadline is for.
	const visitedRealDirs = new Set<string>();
	const truncated = walk(rootDir, results, visitedRealDirs, maxFiles, deadline);
	return { files: results, truncated };
}

/** Returns true if the walk stopped early (file cap or time budget hit). */
function walk(
	dir: string,
	results: string[],
	visitedRealDirs: Set<string>,
	maxFiles: number,
	deadline: number
): boolean {
	if (Date.now() > deadline) {
		return true;
	}

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
		if (results.length >= maxFiles || Date.now() > deadline) {
			return true;
		}
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
				continue;
			}
			if (walk(path.join(dir, entry.name), results, visitedRealDirs, maxFiles, deadline)) {
				return true;
			}
		} else if (entry.isFile() && VBA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			results.push(path.join(dir, entry.name));
		}
	}
	return false;
}
