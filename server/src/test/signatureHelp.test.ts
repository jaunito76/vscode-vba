import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getSignatureHelp } from '../features/signatureHelp';

/** Builds a document + cursor Position from source containing a single `|` marker. */
function docWithCursor(source: string) {
	const markerIndex = source.indexOf('|');
	assert.ok(markerIndex >= 0, 'test source must contain a | cursor marker');
	const content = source.slice(0, markerIndex) + source.slice(markerIndex + 1);
	const document = TextDocument.create('file:///test.bas', 'vba', 1, content);
	return { document, position: document.positionAt(markerIndex) };
}

suite('Signature Help (AST-based)', () => {
	const decl = 'Public Sub Foo(a As Integer, Optional b As String)\nEnd Sub\n\n';

	test('resolves the signature for the first parameter', () => {
		const { document, position } = docWithCursor(`${decl}Call Foo(|)`);
		const help = getSignatureHelp(document, position);
		assert.ok(help);
		assert.strictEqual(help!.signatures.length, 1);
		assert.strictEqual(help!.signatures[0].label, 'Foo(a As Integer, [Optional] b As String)');
		assert.strictEqual(help!.activeParameter, 0);
	});

	test('advances the active parameter past each top-level comma', () => {
		const { document, position } = docWithCursor(`${decl}Call Foo(1, |)`);
		const help = getSignatureHelp(document, position);
		assert.ok(help);
		assert.strictEqual(help!.activeParameter, 1);
	});

	test('does not count commas nested inside a parenthesized argument', () => {
		const { document, position } = docWithCursor(`${decl}Call Foo(Bar(1, 2), |)`);
		const help = getSignatureHelp(document, position);
		assert.ok(help);
		assert.strictEqual(help!.activeParameter, 1);
	});

	test('returns undefined for an unknown call target', () => {
		const { document, position } = docWithCursor(`${decl}Call DoesNotExist(|)`);
		assert.strictEqual(getSignatureHelp(document, position), undefined);
	});

	test('returns undefined outside of any call', () => {
		const { document, position } = docWithCursor(`${decl}Dim x As Integer|`);
		assert.strictEqual(getSignatureHelp(document, position), undefined);
	});
});
