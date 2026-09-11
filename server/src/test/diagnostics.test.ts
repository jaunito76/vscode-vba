import * as assert from 'assert';
import { Diagnostic } from 'vscode-languageserver/node';
import { getDiagnostics } from '../features/diagnostics';
import { bindModule } from '../semantics/moduleBinder';
import { ProjectIndex } from '../semantics/projectIndex';

function diagnosticsFor(source: string, uri = 'file:///Module1.bas', index = new ProjectIndex()) {
	const info = index.updateModule(uri, source);
	return getDiagnostics(info, index);
}

/** All diagnostics produced here are always plain-string messages; narrows past the LSP type's `string | MarkupContent` union. */
function msg(d: Diagnostic): string {
	return typeof d.message === 'string' ? d.message : d.message.value;
}

suite('Diagnostics — syntax errors', () => {
	test('surfaces parser diagnostics as Error severity', () => {
		const diags = diagnosticsFor('Dim x As\n');
		assert.ok(diags.length > 0);
		assert.strictEqual(diags[0].severity, 1); // DiagnosticSeverity.Error
	});

	test('a syntactically clean module has no syntax diagnostics', () => {
		const diags = diagnosticsFor('Sub Foo()\nEnd Sub\n');
		assert.deepStrictEqual(diags, []);
	});
});

suite('Diagnostics — Option Explicit undeclared variables', () => {
	test('does nothing without Option Explicit present', () => {
		const diags = diagnosticsFor('Sub Foo()\n    x = 1\nEnd Sub\n');
		assert.deepStrictEqual(diags, []);
	});

	test('flags a bare undeclared identifier when Option Explicit is present', () => {
		const diags = diagnosticsFor('Option Explicit\nSub Foo()\n    x = 1\nEnd Sub\n');
		assert.strictEqual(diags.length, 1);
		assert.strictEqual(diags[0].severity, 2); // DiagnosticSeverity.Warning
		assert.ok(msg(diags[0]).includes('x'));
	});

	test('does not flag a Dim-declared local, anywhere in the procedure body', () => {
		const diags = diagnosticsFor(
			'Option Explicit\nSub Foo()\n    If True Then\n        Dim x As Integer\n    End If\n    x = 1\nEnd Sub\n'
		);
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag a parameter', () => {
		const diags = diagnosticsFor('Option Explicit\nSub Foo(x As Integer)\n    x = 1\nEnd Sub\n');
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag a module-level variable', () => {
		const diags = diagnosticsFor('Option Explicit\nDim x As Integer\nSub Foo()\n    x = 1\nEnd Sub\n');
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag a local Const', () => {
		const diags = diagnosticsFor('Option Explicit\nSub Foo()\n    Const Pi = 3.14\n    x = Pi\nEnd Sub\n');
		const undeclared = diags.filter(d => msg(d).includes('Pi'));
		assert.deepStrictEqual(undeclared, []);
	});

	test('does not flag a module-local Enum member', () => {
		const diags = diagnosticsFor(
			'Option Explicit\nPublic Enum Color\n    Red\n    Blue\nEnd Enum\nSub Foo()\n    Dim c As Color\n    c = Red\nEnd Sub\n'
		);
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag known intrinsics', () => {
		const diags = diagnosticsFor('Option Explicit\nSub Foo()\n    MsgBox "hi" & vbCrLf\nEnd Sub\n');
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag a Public procedure or variable from another standard module', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///Helper.bas', 'Public Sub DoThing()\nEnd Sub\nPublic Total As Integer\n');
		const diags = diagnosticsFor(
			'Option Explicit\nSub Foo()\n    DoThing\n    Total = 1\nEnd Sub\n',
			'file:///Caller.bas',
			index
		);
		assert.deepStrictEqual(diags, []);
	});

	test('does not flag, or throw on, a Public Const from another standard module', () => {
		// Regression test for a real production crash: the Option Explicit
		// walk resolving an identifier that turned out to be a Public Const
		// declared in a different module used to throw a TypeError instead
		// of returning a result, taking the whole server process down.
		const index = new ProjectIndex();
		index.updateModule('file:///Helper.bas', 'Public Const Pi As Double = 3.14\n');
		const diags = diagnosticsFor(
			'Option Explicit\nSub Foo()\n    MsgBox Pi\nEnd Sub\n',
			'file:///Caller.bas',
			index
		);
		assert.deepStrictEqual(diags, []);
	});

	test('flags the target of a member access but not the member name itself', () => {
		const diags = diagnosticsFor('Option Explicit\nSub Foo()\n    obj.Bar\nEnd Sub\n');
		assert.strictEqual(diags.length, 1);
		assert.ok(msg(diags[0]).includes('obj'));
		assert.ok(!msg(diags[0]).includes('Bar'));
	});

	test('checks array bound expressions and For loop variables too', () => {
		const source = 'Option Explicit\nSub Foo()\n    Dim arr(n) As Integer\n    For i = 1 To 10\n    Next i\nEnd Sub\n';
		const diags = diagnosticsFor(source);
		const names = diags.map(msg);
		assert.ok(names.some(n => n.includes('n')));
		assert.ok(names.some(n => n.includes('i')));
	});
});

// bindModule sanity check reused here for clarity of intent, not duplication
// of moduleBinder's own suite.
suite('Diagnostics — end to end via bindModule', () => {
	test('a module bound directly produces the same diagnostics as via ProjectIndex', () => {
		const index = new ProjectIndex();
		const source = 'Option Explicit\nSub Foo()\n    y = 1\nEnd Sub\n';
		const viaIndex = getDiagnostics(index.updateModule('file:///A.bas', source), index);
		const viaBind = getDiagnostics(bindModule('file:///A.bas', source), new ProjectIndex());
		assert.strictEqual(viaIndex.length, viaBind.length);
	});
});
