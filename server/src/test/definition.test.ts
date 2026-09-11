import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDefinition } from '../features/definition';
import { ProjectIndex } from '../semantics/projectIndex';

function docWithCursor(source: string, uri = 'file:///test.bas') {
	const markerIndex = source.indexOf('|');
	assert.ok(markerIndex >= 0, 'test source must contain a | cursor marker');
	const content = source.slice(0, markerIndex) + source.slice(markerIndex + 1);
	const document = TextDocument.create(uri, 'vba', 1, content);
	return { document, position: document.positionAt(markerIndex) };
}

suite('Go to Definition', () => {
	test('jumps from a call site to the procedure name, not the whole declaration', () => {
		const source = 'Public Sub DoThing()\nEnd Sub\nSub Caller()\n    Do|Thing\nEnd Sub\n';
		const { document, position } = docWithCursor(source);
		const locations = getDefinition(document, position, new ProjectIndex());
		assert.strictEqual(locations?.length, 1);
		const [loc] = locations!;
		assert.strictEqual(loc.uri, 'file:///test.bas');
		// "DoThing" starts right after "Public Sub " on line 0.
		assert.strictEqual(loc.range.start.line, 0);
		assert.strictEqual(loc.range.start.character, 'Public Sub '.length);
		assert.strictEqual(loc.range.end.character, 'Public Sub '.length + 'DoThing'.length);
	});

	test('jumps to a parameter\'s own declaration', () => {
		const source = 'Sub Foo(x As Integer)\n    y = |x\nEnd Sub\n';
		const { document, position } = docWithCursor(source);
		const locations = getDefinition(document, position, new ProjectIndex());
		assert.strictEqual(locations?.length, 1);
		assert.strictEqual(locations![0].range.start.character, 'Sub Foo('.length);
	});

	test('jumps across modules to a class member', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///MyClass.cls', 'Public Sub Greet()\nEnd Sub\n');
		const source = 'Sub Caller()\n    Dim c As MyClass\n    c.Gr|eet\nEnd Sub\n';
		const { document, position } = docWithCursor(source, 'file:///Caller.bas');
		const locations = getDefinition(document, position, index);
		assert.strictEqual(locations?.length, 1);
		assert.strictEqual(locations![0].uri, 'file:///MyClass.cls');
	});

	test('returns both overloads for a Property Get/Let pair', () => {
		const source =
			'Public Property Get Value() As Integer\nEnd Property\n' +
			'Public Property Let Value(v As Integer)\nEnd Property\n' +
			'Sub Caller()\n    x = Va|lue\nEnd Sub\n';
		const { document, position } = docWithCursor(source);
		const locations = getDefinition(document, position, new ProjectIndex());
		assert.strictEqual(locations?.length, 2);
	});

	test('returns undefined for an unresolvable identifier', () => {
		const { document, position } = docWithCursor('Sub Foo()\n    |Bar\nEnd Sub\n');
		assert.strictEqual(getDefinition(document, position, new ProjectIndex()), undefined);
	});
});
