import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '../parser/parser';
import { ProcedureDecl, Stmt } from '../parser/ast';

function procedures(body: Stmt[]): ProcedureDecl[] {
	return body.filter((s): s is ProcedureDecl => s.kind === 'ProcedureDecl');
}

suite('Parser', () => {
	test('parses a Sub with parameters and a body statement', () => {
		const { module, diagnostics } = parse(
			'Public Sub DoThing(x As Integer, Optional y As String = "z")\n' +
			'    MsgBox x\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		assert.strictEqual(proc.procKind, 'SUB');
		assert.strictEqual(proc.access, 'PUBLIC');
		assert.strictEqual(proc.name, 'DoThing');
		assert.strictEqual(proc.params.length, 2);
		assert.strictEqual(proc.params[0].type, 'Integer');
		assert.strictEqual(proc.params[1].isOptional, true);
		assert.strictEqual(proc.body.length, 1);
		assert.strictEqual(proc.body[0].kind, 'CallStmt');
	});

	test('parses a Function with a return type', () => {
		const { module, diagnostics } = parse(
			'Public Function GetValue() As Integer\n' +
			'    GetValue = 42\n' +
			'End Function\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		assert.strictEqual(proc.procKind, 'FUNCTION');
		assert.strictEqual(proc.returnType, 'Integer');
	});

	test('parses Property Get/Let as separate procedures sharing a name', () => {
		const { module, diagnostics } = parse(
			'Public Property Get Value() As Integer\n' +
			'    Value = 1\n' +
			'End Property\n' +
			'Public Property Let Value(v As Integer)\n' +
			'End Property\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const procs = procedures(module.body);
		assert.strictEqual(procs.length, 2);
		assert.strictEqual(procs[0].propertyKind, 'GET');
		assert.strictEqual(procs[1].propertyKind, 'LET');
		assert.strictEqual(procs[0].name, 'Value');
		assert.strictEqual(procs[1].name, 'Value');
	});

	test('parses a block If/ElseIf/Else', () => {
		const { module, diagnostics } = parse(
			'Sub S()\n' +
			'If x = 1 Then\n' +
			'    a = 1\n' +
			'ElseIf x = 2 Then\n' +
			'    a = 2\n' +
			'Else\n' +
			'    a = 3\n' +
			'End If\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		const ifStmt = proc.body[0];
		assert.strictEqual(ifStmt.kind, 'IfStmt');
		if (ifStmt.kind === 'IfStmt') {
			assert.strictEqual(ifStmt.isSingleLine, false);
			assert.strictEqual(ifStmt.branches.length, 2);
			assert.strictEqual(ifStmt.elseBody?.length, 1);
		}
	});

	test('parses a single-line If without a matching End If', () => {
		const { module, diagnostics } = parse('Sub S()\nIf x = 1 Then a = 1 Else a = 2\nEnd Sub\n');
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		const ifStmt = proc.body[0];
		assert.strictEqual(ifStmt.kind, 'IfStmt');
		if (ifStmt.kind === 'IfStmt') {
			assert.strictEqual(ifStmt.isSingleLine, true);
			assert.strictEqual(ifStmt.elseBody?.length, 1);
		}
	});

	test('parses For...Next with Step and For Each', () => {
		const { diagnostics } = parse(
			'Sub S()\n' +
			'For i = 1 To 10 Step 2\n' +
			'Next i\n' +
			'For Each c In coll\n' +
			'Next c\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('parses all four Do/Loop forms plus legacy While/Wend', () => {
		const { module, diagnostics } = parse(
			'Sub S()\n' +
			'Do While a\nLoop\n' +
			'Do Until a\nLoop\n' +
			'Do\nLoop While a\n' +
			'Do\nLoop Until a\n' +
			'While a\nWend\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		const loops = proc.body.filter(s => s.kind === 'DoLoopStmt');
		assert.strictEqual(loops.length, 5);
	});

	test('parses Select Case with value, range, Is, and Else clauses', () => {
		const { diagnostics } = parse(
			'Sub S()\n' +
			'Select Case x\n' +
			'Case 1\n' +
			'Case 2 To 5\n' +
			'Case Is > 10\n' +
			'Case Else\n' +
			'End Select\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('parses With blocks and implicit .member access', () => {
		const { diagnostics } = parse(
			'Sub S()\n' +
			'With obj\n' +
			'    .Value = 1\n' +
			'    x = .Other\n' +
			'End With\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('parses Dim with array bounds and As New', () => {
		const { module, diagnostics } = parse('Dim a(1 To 10) As Integer\nDim b As New Collection\n');
		assert.deepStrictEqual(diagnostics, []);
		const dims = module.body.filter(s => s.kind === 'DimStmt');
		assert.strictEqual(dims.length, 2);
	});

	test('parses Type, Enum, and Declare blocks', () => {
		const { module, diagnostics } = parse(
			'Private Type Point\n' +
			'    X As Long\n' +
			'    Y As Long\n' +
			'End Type\n' +
			'Public Enum Color\n' +
			'    Red = 1\n' +
			'    Blue\n' +
			'End Enum\n' +
			'Private Declare Function GetTickCount Lib "kernel32" () As Long\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		assert.ok(module.body.some(s => s.kind === 'TypeDecl'));
		assert.ok(module.body.some(s => s.kind === 'EnumDecl'));
		assert.ok(module.body.some(s => s.kind === 'DeclareStmt'));
	});

	test('joins a continued statement across lines', () => {
		const { module, diagnostics } = parse('Dim x As _\n    Integer\n');
		assert.deepStrictEqual(diagnostics, []);
		assert.strictEqual(module.body.length, 1);
	});

	test('respects VBA operator precedence (multiplication before addition)', () => {
		const { module } = parse('x = 1 + 2 * 3\n');
		const assign = module.body[0];
		assert.strictEqual(assign.kind, 'AssignStmt');
		if (assign.kind === 'AssignStmt') {
			assert.strictEqual(assign.value.kind, 'BinaryExpr');
			if (assign.value.kind === 'BinaryExpr') {
				assert.strictEqual(assign.value.op, '+');
				assert.strictEqual(assign.value.right.kind, 'BinaryExpr');
			}
		}
	});

	test('recovers from a syntax error and keeps parsing subsequent procedures', () => {
		const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'malformed.bas'), 'utf8');
		const { module, diagnostics } = parse(source);

		assert.ok(diagnostics.length > 0, 'expected at least one diagnostic from the malformed procedure');

		const procs = procedures(module.body);
		assert.deepStrictEqual(procs.map(p => p.name), ['BeforeError', 'HasSyntaxError', 'AfterError']);

		const afterError = procs[2];
		assert.strictEqual(afterError.body.length, 2);
		assert.strictEqual(afterError.body[1].kind, 'AssignStmt');
	});

	test('handles a large module (thousands of lines) within the debounce window', function () {
		this.timeout(5000);

		const lines: string[] = ['Attribute VB_Name = "Large"', 'Option Explicit', ''];
		const procCount = 2000;
		for (let i = 0; i < procCount; i++) {
			lines.push(`Public Sub Proc${i}(a As Integer, b As String)`);
			lines.push(`    Dim total As Integer`);
			lines.push(`    If a > 0 Then`);
			lines.push(`        total = a + i * 2`);
			lines.push(`    Else`);
			lines.push(`        total = 0`);
			lines.push(`    End If`);
			lines.push(`    MsgBox "value: " & total & b`);
			lines.push(`End Sub`);
			lines.push('');
		}
		const source = lines.join('\n');

		const start = Date.now();
		const { module, diagnostics } = parse(source);
		const elapsedMs = Date.now() - start;

		assert.deepStrictEqual(diagnostics, []);
		assert.strictEqual(procedures(module.body).length, procCount);
		assert.ok(elapsedMs < 2000, `expected parse of a ${lines.length}-line module to take well under the debounce window, took ${elapsedMs}ms`);
	});
});
