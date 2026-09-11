import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolKind } from 'vscode-languageserver/node';
import { getDocumentSymbols } from '../features/documentSymbols';

function doc(content: string): TextDocument {
	return TextDocument.create('file:///test.bas', 'vba', 1, content);
}

suite('Document Symbols (AST-based)', () => {
	test('lists Subs and Functions with their access and kind', () => {
		const symbols = getDocumentSymbols(doc(
			'Public Sub Foo()\nEnd Sub\n' +
			'Private Function Bar() As Integer\nEnd Function\n'
		));
		assert.strictEqual(symbols.length, 2);
		assert.strictEqual(symbols[0].name, 'Foo (Public Sub)');
		assert.strictEqual(symbols[0].kind, SymbolKind.Method);
		assert.strictEqual(symbols[1].name, 'Bar (Private Function)');
		assert.strictEqual(symbols[1].kind, SymbolKind.Function);
	});

	test('defaults to Public when no access modifier is present', () => {
		const symbols = getDocumentSymbols(doc('Sub Foo()\nEnd Sub\n'));
		assert.strictEqual(symbols[0].name, 'Foo (Public Sub)');
	});

	test('groups Property Get/Let/Set sharing a name into one symbol', () => {
		const symbols = getDocumentSymbols(doc(
			'Public Property Get X() As Integer\nEnd Property\n' +
			'Public Property Let X(v As Integer)\nEnd Property\n'
		));
		assert.strictEqual(symbols.length, 1);
		assert.strictEqual(symbols[0].name, 'X (Property Get/Let)');
		assert.strictEqual(symbols[0].kind, SymbolKind.Property);
		assert.strictEqual(symbols[0].containerName, 'Public Property');
	});

	test('a symbol range spans the whole procedure, not just the declaration line', () => {
		const symbols = getDocumentSymbols(doc('Sub Foo()\n    Dim x As Integer\nEnd Sub\n'));
		assert.strictEqual(symbols[0].location.range.start.line, 0);
		assert.strictEqual(symbols[0].location.range.end.line, 2);
	});

	test('ignores non-procedure module-level declarations', () => {
		const symbols = getDocumentSymbols(doc('Option Explicit\nDim x As Integer\nSub Foo()\nEnd Sub\n'));
		assert.strictEqual(symbols.length, 1);
		assert.strictEqual(symbols[0].name, 'Foo (Public Sub)');
	});
});
