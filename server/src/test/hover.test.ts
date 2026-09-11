import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getHover } from '../features/hover';
import { ProjectIndex } from '../semantics/projectIndex';

/** Builds a document + cursor Position from source containing a single `|` marker. */
function docWithCursor(source: string, uri = 'file:///test.bas') {
	const markerIndex = source.indexOf('|');
	assert.ok(markerIndex >= 0, 'test source must contain a | cursor marker');
	const content = source.slice(0, markerIndex) + source.slice(markerIndex + 1);
	const document = TextDocument.create(uri, 'vba', 1, content);
	return { document, position: document.positionAt(markerIndex) };
}

suite('Hover', () => {
	test('shows a Sub\'s signature when hovering its declaration', () => {
		const { document, position } = docWithCursor('Public Sub Do|Thing(x As Integer)\nEnd Sub\n');
		const hover = getHover(document, position, new ProjectIndex());
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('DoThing(x As Integer)'));
	});

	test('shows a Sub\'s signature when hovering a call to it', () => {
		const { document, position } = docWithCursor(
			'Public Sub DoThing(x As Integer)\nEnd Sub\nSub Caller()\n    Do|Thing 1\nEnd Sub\n'
		);
		const hover = getHover(document, position, new ProjectIndex());
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('DoThing(x As Integer)'));
	});

	test('includes leading \' comment lines as documentation', () => {
		const { document, position } = docWithCursor(
			"' Does the thing.\n' Second line.\nPublic Sub Do|Thing()\nEnd Sub\n"
		);
		const hover = getHover(document, position, new ProjectIndex());
		const value = (hover!.contents as { value: string }).value;
		assert.ok(value.includes('Does the thing.'));
		assert.ok(value.includes('Second line.'));
	});

	test('shows a parameter\'s declared type', () => {
		const { document, position } = docWithCursor(
			'Sub Foo(x As Integer)\n    y = |x\nEnd Sub\n'
		);
		const hover = getHover(document, position, new ProjectIndex());
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('x As Integer'));
	});

	test('shows a module-level variable\'s declared type', () => {
		const { document, position } = docWithCursor('Dim total As Integer\nSub Foo()\n    |total = 1\nEnd Sub\n');
		const hover = getHover(document, position, new ProjectIndex());
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('total As Integer'));
	});

	test('resolves a class member through a locally declared variable\'s type', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///MyClass.cls', 'Public Sub Greet()\nEnd Sub\n');
		const { document, position } = docWithCursor(
			'Sub Caller()\n    Dim c As MyClass\n    c.Gr|eet\nEnd Sub\n',
			'file:///Caller.bas'
		);
		const hover = getHover(document, position, index);
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('Greet()'));
	});

	test('hovering a call to a Public Sub declared much later in another (longer) file does not crash', () => {
		// Regression test for a real production crash: the doc-comment
		// lookup used the *hovered* document's line array but the
		// *declaring* module's line number, so a declaration living past
		// the end of the current (shorter) file's line count indexed off
		// the array and threw instead of just skipping the doc-comment.
		const index = new ProjectIndex();
		const helperLines = ['Attribute VB_Name = "Helper"', ''];
		for (let i = 0; i < 20; i++) {
			helperLines.push(`' padding line ${i}`);
		}
		helperLines.push('Public Sub Greet()', 'End Sub', '');
		index.updateModule('file:///Helper.bas', helperLines.join('\n'));

		const { document, position } = docWithCursor('Sub Caller()\n    Gre|et\nEnd Sub\n', 'file:///Caller.bas');
		const hover = getHover(document, position, index);
		assert.ok(hover);
		assert.ok((hover!.contents as { value: string }).value.includes('Greet()'));
	});

	test('returns undefined for an unresolvable identifier', () => {
		const { document, position } = docWithCursor('Sub Foo()\n    |Bar\nEnd Sub\n');
		assert.strictEqual(getHover(document, position, new ProjectIndex()), undefined);
	});

	test('returns undefined when the cursor is not on an identifier', () => {
		const { document, position } = docWithCursor('Sub Foo()\nEnd Sub\n   |   \n');
		assert.strictEqual(getHover(document, position, new ProjectIndex()), undefined);
	});
});
