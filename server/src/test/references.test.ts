import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getReferences } from '../features/references';
import { ProjectIndex } from '../semantics/projectIndex';

function docWithCursor(source: string, uri = 'file:///test.bas') {
	const markerIndex = source.indexOf('|');
	assert.ok(markerIndex >= 0, 'test source must contain a | cursor marker');
	const content = source.slice(0, markerIndex) + source.slice(markerIndex + 1);
	const document = TextDocument.create(uri, 'vba', 1, content);
	return { document, position: document.positionAt(markerIndex) };
}

suite('Find References', () => {
	test('finds calls to a Public procedure across multiple modules', () => {
		const index = new ProjectIndex();
		const { document, position } = docWithCursor('Public Sub Do|Thing()\nEnd Sub\n', 'file:///Helper.bas');
		index.updateModule('file:///Helper.bas', document.getText());
		index.updateModule('file:///CallerA.bas', 'Sub A()\n    DoThing\nEnd Sub\n');
		index.updateModule('file:///CallerB.bas', 'Sub B()\n    DoThing\n    DoThing\nEnd Sub\n');

		const refs = getReferences(document, position, index, false);
		assert.strictEqual(refs?.length, 3); // one in CallerA, two in CallerB

		const withDecl = getReferences(document, position, index, true);
		assert.strictEqual(withDecl?.length, 4);
		assert.strictEqual(withDecl![0].uri, 'file:///Helper.bas'); // declaration first
	});

	test('scopes a local variable\'s references to its own procedure only', () => {
		const index = new ProjectIndex();
		const source =
			'Sub A()\n    Dim x As Integer\n    x| = 1\n    y = x\nEnd Sub\n' +
			'Sub B()\n    Dim x As Integer\n    x = 99\nEnd Sub\n';
		const { document, position } = docWithCursor(source);
		index.updateModule('file:///test.bas', document.getText());

		const refs = getReferences(document, position, index, false);
		// Both uses of x inside Sub A only — not Sub B's unrelated local x.
		assert.strictEqual(refs?.length, 2);
		assert.ok(refs!.every(r => r.range.start.line <= 3));
	});

	test('scopes a parameter\'s references to its own procedure only', () => {
		const source = 'Sub A(n As Integer)\n    y = |n + n\nEnd Sub\nSub B(n As Integer)\n    z = n\nEnd Sub\n';
		const { document, position } = docWithCursor(source);
		const refs = getReferences(document, position, new ProjectIndex(), false);
		assert.strictEqual(refs?.length, 2);
	});

	test('finds cross-module class-member references', () => {
		const index = new ProjectIndex();
		const { document, position } = docWithCursor('Public Sub Gre|et()\nEnd Sub\n', 'file:///MyClass.cls');
		index.updateModule('file:///MyClass.cls', document.getText());
		index.updateModule(
			'file:///Caller.bas',
			'Sub A()\n    Dim c As MyClass\n    c.Greet\nEnd Sub\n' +
			'Sub B()\n    Dim c As MyClass\n    c.Greet\nEnd Sub\n'
		);

		const refs = getReferences(document, position, index, false);
		assert.strictEqual(refs?.length, 2);
	});

	test('returns undefined for an unresolvable identifier', () => {
		const { document, position } = docWithCursor('Sub Foo()\n    |Bar\nEnd Sub\n');
		assert.strictEqual(getReferences(document, position, new ProjectIndex(), false), undefined);
	});
});
