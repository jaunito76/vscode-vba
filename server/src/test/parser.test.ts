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

	test('parses Open/Close and #-file-number I/O statements without corrupting subsequent code', () => {
		// Regression test for a real production bug: none of these were
		// recognized at all, so `Open ... For Append As #n` got misparsed as
		// a call to a nonexistent "Open" followed by an unrelated For loop,
		// swallowing every statement after it (including whole procedures)
		// into that bogus loop's body looking for a Next that never came.
		const source =
			'Sub WriteLog()\n' +
			'    Dim n As Integer\n' +
			'    n = FreeFile\n' +
			'    Open "log.txt" For Append As #n\n' +
			'    Print #n, "hello", x\n' +
			'    Write #n, y\n' +
			'    Close #n\n' +
			'End Sub\n' +
			'\n' +
			'Sub ReadLog()\n' +
			'    Dim n As Integer, line As String\n' +
			'    n = FreeFile\n' +
			'    Open "log.txt" For Input As #n\n' +
			'    Line Input #n, line\n' +
			'    Close\n' +
			'End Sub\n' +
			'\n' +
			'Public Sub AfterFileIO()\n' +
			'End Sub\n';
		const { module, diagnostics } = parse(source);
		assert.deepStrictEqual(diagnostics, []);

		const procs = procedures(module.body);
		assert.deepStrictEqual(procs.map(p => p.name), ['WriteLog', 'ReadLog', 'AfterFileIO']);

		const fileIOKinds = procs[0].body.filter(s => s.kind === 'FileIOStmt').map(s => (s as { op: string }).op);
		assert.deepStrictEqual(fileIOKinds, ['OPEN', 'PRINT', 'WRITE', 'CLOSE']);
	});

	test('does not treat "Open"/"Close" used as ordinary identifiers as file I/O statements', () => {
		const { module, diagnostics } = parse(
			'Sub Foo()\n' +
			'    Open 1, 2\n' + // no "For" -> not the Open statement
			'    Close\n' + // bare Close is still ambiguous in real VBA too; accept ambiguity here
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		assert.strictEqual(proc.body[0].kind, 'CallStmt');
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

	test('parses [_First]/[_Last] bracket-escaped enum members', () => {
		const { module, diagnostics } = parse(
			'Public Enum ApproachType\n' +
			'    [_First]\n' +
			'    ILS\n' +
			'    [_Last]\n' +
			'End Enum\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const enumDecl = module.body.find(s => s.kind === 'EnumDecl');
		assert.strictEqual(enumDecl?.kind, 'EnumDecl');
		if (enumDecl?.kind === 'EnumDecl') {
			assert.deepStrictEqual(enumDecl.members.map(m => m.name), ['_First', 'ILS', '_Last']);
		}
	});

	test('never loops forever on a token an Enum/Type body can\'t make into a member', function () {
		// Regression test for a real production bug: a token
		// expectIdentifierLike() rejects (here `@`, standing in for whatever
		// unrecognized construct a real file might contain) that is also not
		// '=', ':', or a newline sails straight through every branch of the
		// Enum-body loop without being consumed. The loop had no progress
		// guard, so this was a genuine infinite loop that grew its
		// diagnostics/members arrays without bound until the process ran out
		// of memory — a bracket-escaped enum member ([_First]) hit exactly
		// this before bracket support was added to the lexer.
		this.timeout(2000);
		const { diagnostics } = parse(
			'Public Enum Broken\n' +
			'    @ @ @\n' +
			'End Enum\n'
		);
		assert.ok(diagnostics.length < 100, 'diagnostics should stay bounded, not grow without limit');
	});

	test('never loops forever on a token a Type body can\'t make into a field', function () {
		this.timeout(2000);
		const { diagnostics } = parse(
			'Private Type Broken\n' +
			'    @ @ @\n' +
			'End Type\n'
		);
		assert.ok(diagnostics.length < 100, 'diagnostics should stay bounded, not grow without limit');
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

	test('skips a .cls/.frm designer header (VERSION/BEGIN...END, nested) before real code', () => {
		const source =
			'VERSION 1.0 CLASS\n' +
			'BEGIN\n' +
			'  MultiUse = -1\n' +
			'  Begin VB.CommandButton cmdOK\n' +
			'    Caption = "OK"\n' +
			'  End\n' +
			'END\n' +
			'Attribute VB_Name = "Class1"\n' +
			'Public Sub Foo()\n' +
			'End Sub\n';
		const { module, diagnostics } = parse(source);
		assert.deepStrictEqual(diagnostics, []);
		assert.deepStrictEqual(procedures(module.body).map(p => p.name), ['Foo']);
	});

	test('flattens self-contained #If/#Else branches (each with its own full header+body+End) as sequential declarations', () => {
		const source =
			'#If VBA7 Then\n' +
			'Public Function GetPtr(ByVal p As LongPtr) As Object\n' +
			'    Set GetPtr = Nothing\n' +
			'End Function\n' +
			'#Else\n' +
			'Public Function GetPtr(ByVal p As Long) As Object\n' +
			'    Set GetPtr = Nothing\n' +
			'End Function\n' +
			'#End If\n';
		const { module, diagnostics } = parse(source);
		assert.deepStrictEqual(diagnostics, []);
		assert.strictEqual(procedures(module.body).length, 2);
	});

	test('shares one body between #If/#Else header-only branches (early/late-binding idiom)', () => {
		// Regression test: each branch supplies only an alternate *header* for
		// the same procedure (no body statements before #Else/#End If); the
		// real, shared body lives once after #End If. Without special
		// handling, the alternate header parses as bogus nested code inside
		// the first branch's body, and the outer Function never finds its own
		// matching End Function.
		const source =
			'#If EarlyBind = True Then\n' +
			'Public Function GetIt() As Scripting.FileSystemObject\n' +
			'    Debug.Print "early"\n' +
			'#Else\n' +
			'Public Function GetIt() As Object\n' +
			'#End If\n' +
			'    Set GetIt = Nothing\n' +
			'End Function\n';
		const { module, diagnostics } = parse(source);
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		assert.strictEqual(proc.name, 'GetIt');
		// Whichever header is reached first (top-to-bottom) is "the"
		// declaration in effect; the alternate header in the other branch is
		// the one skipped. Which branch "wins" isn't semantically meaningful
		// here (no #If condition is actually evaluated) — what matters is
		// that exactly one header applies and the shared body attaches to it.
		assert.strictEqual(proc.returnType, 'Scripting.FileSystemObject');
		assert.ok(proc.body.some(s => s.kind === 'AssignStmt'));
	});

	test('parses a paren-less statement call whose first argument is itself parenthesized', () => {
		// `MsgBox ("text"), buttons, title` — the space before `(` means this
		// is NOT call syntax; `("text")` is just a parenthesized first
		// argument of a normal paren-less call, with more arguments after it.
		const { module, diagnostics } = parse('MsgBox ("hello"), vbExclamation, "Title"\n');
		assert.deepStrictEqual(diagnostics, []);
		const stmt = module.body[0];
		assert.strictEqual(stmt.kind, 'CallStmt');
		if (stmt.kind === 'CallStmt') {
			assert.strictEqual(stmt.expr.kind, 'CallExpr');
			if (stmt.expr.kind === 'CallExpr') {
				assert.strictEqual(stmt.expr.args.length, 3);
			}
		}
	});

	test('parses a paren-less statement call whose first argument is a spaced bare .member (implicit With target)', () => {
		const { module, diagnostics } = parse(
			'Sub S()\n' +
			'With Target\n' +
			'    flight.PutList .Range(.Cells(1, 2), .Cells(3, 4)), DayOnly:=False\n' +
			'End With\n' +
			'End Sub\n'
		);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('parses ReDim with an explicit lower bound ("0 To N")', () => {
		const { module, diagnostics } = parse('ReDim arr(0 To 5)\nReDim Preserve arr(0 To UBound(arr) + 1)\n');
		assert.deepStrictEqual(diagnostics, []);
		const redim = module.body[0];
		assert.strictEqual(redim.kind, 'ReDimStmt');
		if (redim.kind === 'ReDimStmt') {
			assert.strictEqual(redim.targets[0].bounds?.[0].lower?.kind, 'Literal');
		}
	});

	test('parses the Name...As... file rename statement', () => {
		const { module, diagnostics } = parse('Name oldPath As newPath\n');
		assert.deepStrictEqual(diagnostics, []);
		assert.strictEqual(module.body[0].kind, 'FileIOStmt');
	});

	test('does not treat "Name" used as an ordinary identifier as the Name statement', () => {
		const { module, diagnostics } = parse('x = Name\n');
		assert.deepStrictEqual(diagnostics, []);
		assert.strictEqual(module.body[0].kind, 'AssignStmt');
	});

	test('accepts a leading/doubled colon (empty statement) in a single-line If', () => {
		const { module, diagnostics } = parse('Sub S()\nIf x = 0 Then: Exit Sub\nEnd Sub\n');
		assert.deepStrictEqual(diagnostics, []);
		const [proc] = procedures(module.body);
		const ifStmt = proc.body[0];
		assert.strictEqual(ifStmt.kind, 'IfStmt');
		if (ifStmt.kind === 'IfStmt') {
			assert.strictEqual(ifStmt.branches[0].body[0].kind, 'ExitStmt');
		}
	});

	test('parses "Not" as a tight unary operator nested inside a concatenation, not just at its own precedence tier', () => {
		const { module, diagnostics } = parse('x = "found=" & Not (y Is Nothing)\n');
		assert.deepStrictEqual(diagnostics, []);
	});

	test('parses bang member access (rst!Field) the same as dot access', () => {
		const { module, diagnostics } = parse('x = rst!Field\n');
		assert.deepStrictEqual(diagnostics, []);
		const stmt = module.body[0];
		assert.strictEqual(stmt.kind, 'AssignStmt');
		if (stmt.kind === 'AssignStmt') {
			assert.strictEqual(stmt.value.kind, 'MemberExpr');
			if (stmt.value.kind === 'MemberExpr') {
				assert.strictEqual(stmt.value.name, 'Field');
			}
		}
	});

	test('treats EXPLICIT/BASE/COMPARE as ordinary identifiers outside of Option', () => {
		// None of the three is actually a reserved word in real VBA — only
		// meaningful directly after "Option". A user Function/variable named
		// Compare (a very natural name for a comparison method) must still
		// parse as a normal declaration and assignment target.
		const { module, diagnostics } = parse(
			'Option Compare Binary\n' +
			'Option Base 1\n' +
			'Option Explicit\n' +
			'Function Compare(a As Long) As Boolean\n' +
			'    Compare = True\n' +
			'End Function\n'
		);
		assert.deepStrictEqual(diagnostics, []);
		const options = module.body.filter(s => s.kind === 'OptionStmt');
		assert.deepStrictEqual(options.map(o => (o as { name: string }).name), ['COMPARE', 'BASE', 'EXPLICIT']);
		assert.deepStrictEqual(procedures(module.body).map(p => p.name), ['Compare']);
	});

	test('accepts a dotted (per-member) Attribute name', () => {
		const { module, diagnostics } = parse('Attribute ShortName.VB_Description = "Gets or sets the short name"\n');
		assert.deepStrictEqual(diagnostics, []);
		const attr = module.body[0];
		assert.strictEqual(attr.kind, 'AttributeStmt');
		if (attr.kind === 'AttributeStmt') {
			assert.strictEqual(attr.name, 'ShortName.VB_Description');
		}
	});

	test('accepts a reserved word as a named-argument name (Type:=)', () => {
		const { diagnostics } = parse('customMenu.Controls.Add Type:=msoControlPopup, Before:=1\n');
		assert.deepStrictEqual(diagnostics, []);
	});
});
