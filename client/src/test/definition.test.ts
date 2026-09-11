import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('VBA Language Server - cross-module navigation', () => {
	test('Go to Definition jumps from a call in one open document to a Sub declared in another', async function () {
		this.timeout(20000);

		const helperPath = path.resolve(__dirname, '../../../client/src/test/fixtures/helper.bas');
		const callerPath = path.resolve(__dirname, '../../../client/src/test/fixtures/caller.bas');

		// Both files are opened as editors, matching the common real-world
		// case of a multi-module VBA project with several tabs open, and
		// sidestepping any question of whether the test run's workspace
		// folder is configured for the server's own directory scan.
		const helperDoc = await vscode.workspace.openTextDocument(helperPath);
		await vscode.window.showTextDocument(helperDoc);
		const callerDoc = await vscode.workspace.openTextDocument(callerPath);
		await vscode.window.showTextDocument(callerDoc);

		const ext = vscode.extensions.getExtension('local.vba');
		assert.ok(ext, 'expected the vba extension to be installed');
		await ext!.activate();

		const offset = callerDoc.getText().indexOf('Greet');
		assert.ok(offset >= 0, 'expected the Caller fixture to call Greet');
		const position = callerDoc.positionAt(offset);

		let locations: vscode.Location[] | undefined;
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			locations = await vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeDefinitionProvider',
				callerDoc.uri,
				position
			);
			if (locations && locations.length > 0) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}

		assert.ok(locations && locations.length > 0, 'expected a definition location for Greet');
		assert.strictEqual(locations![0].uri.fsPath, helperDoc.uri.fsPath);
	});
});
