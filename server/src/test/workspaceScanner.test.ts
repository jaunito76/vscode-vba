import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findVbaFiles } from '../workspaceScanner';

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'vba-scanner-test-'));
}

suite('workspaceScanner', () => {
	test('finds .bas/.cls/.frm files recursively and ignores other extensions', () => {
		const root = makeTempDir();
		try {
			fs.writeFileSync(path.join(root, 'Module1.bas'), '');
			fs.mkdirSync(path.join(root, 'sub'));
			fs.writeFileSync(path.join(root, 'sub', 'Class1.cls'), '');
			fs.writeFileSync(path.join(root, 'sub', 'notes.txt'), '');

			const { files, truncated } = findVbaFiles(root);
			assert.strictEqual(truncated, false);
			assert.strictEqual(files.length, 2);
			assert.ok(files.some(f => f.endsWith('Module1.bas')));
			assert.ok(files.some(f => f.endsWith('Class1.cls')));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('skips node_modules, out, and dot directories', () => {
		const root = makeTempDir();
		try {
			fs.mkdirSync(path.join(root, 'node_modules'));
			fs.writeFileSync(path.join(root, 'node_modules', 'Ignored.bas'), '');
			fs.mkdirSync(path.join(root, 'out'));
			fs.writeFileSync(path.join(root, 'out', 'Ignored.bas'), '');
			fs.mkdirSync(path.join(root, '.git'));
			fs.writeFileSync(path.join(root, '.git', 'Ignored.bas'), '');
			fs.writeFileSync(path.join(root, 'Real.bas'), '');

			const { files } = findVbaFiles(root);
			assert.strictEqual(files.length, 1);
			assert.ok(files[0].endsWith('Real.bas'));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('stops and reports truncated once the file cap is hit, rather than scanning forever', () => {
		const root = makeTempDir();
		try {
			for (let i = 0; i < 10; i++) {
				fs.writeFileSync(path.join(root, `Module${i}.bas`), '');
			}
			const { files, truncated } = findVbaFiles(root, { maxFiles: 5 });
			assert.strictEqual(truncated, true);
			assert.strictEqual(files.length, 5);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('survives a directory symlink/junction cycle without hanging or crashing', function () {
		const root = makeTempDir();
		try {
			fs.writeFileSync(path.join(root, 'Real.bas'), '');
			const subdir = path.join(root, 'sub');
			fs.mkdirSync(subdir);
			const linkPath = path.join(subdir, 'loop');
			try {
				fs.symlinkSync(root, linkPath, 'junction');
			} catch {
				this.skip(); // symlink/junction creation unavailable in this environment
				return;
			}

			const { files, truncated } = findVbaFiles(root);
			assert.strictEqual(truncated, false);
			assert.strictEqual(files.length, 1);
			assert.ok(files[0].endsWith('Real.bas'));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
