import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('VBA Language Server', () => {
	test('activates and returns document symbols from the language server', async function () {
		this.timeout(20000);

		const fixture = path.resolve(__dirname, '../../../client/src/test/fixtures/sample.bas');
		const doc = await vscode.workspace.openTextDocument(fixture);
		await vscode.window.showTextDocument(doc);

		const ext = vscode.extensions.getExtension('local.vba');
		assert.ok(ext, 'expected the vba extension to be installed');
		await ext!.activate();

		// The language client starts asynchronously; poll until the server
		// has registered its documentSymbolProvider capability and returned
		// results, rather than assuming activation alone is enough.
		let symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined;
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
				'vscode.executeDocumentSymbolProvider',
				doc.uri
			);
			if (symbols && symbols.length > 0) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}

		assert.ok(symbols && symbols.length > 0, 'expected symbols to be returned from the language server');
		const names = symbols!.map(s => s.name);
		assert.ok(names.some(n => n.startsWith('DoThing')), `expected DoThing symbol, got: ${names.join(', ')}`);
		assert.ok(names.some(n => n.startsWith('GetValue')), `expected GetValue symbol, got: ${names.join(', ')}`);
	});
});
