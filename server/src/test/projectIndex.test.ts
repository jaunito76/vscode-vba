import * as assert from 'assert';
import { bindModule } from '../semantics/moduleBinder';
import { ProjectIndex } from '../semantics/projectIndex';

suite('moduleBinder', () => {
	test('extracts procedures, vars, consts, types, and enums keyed case-insensitively', () => {
		const info = bindModule(
			'file:///Module1.bas',
			'Public Sub Foo()\nEnd Sub\n' +
			'Private x As Integer\n' +
			'Public Const Pi As Double = 3.14\n' +
			'Private Type Point\n    X As Long\nEnd Type\n' +
			'Public Enum Color\n    Red\nEnd Enum\n'
		);
		assert.ok(info.procedures.has('FOO'));
		assert.ok(info.moduleVars.has('X'));
		assert.ok(info.consts.has('PI'));
		assert.ok(info.types.has('POINT'));
		assert.ok(info.enums.has('COLOR'));
		assert.strictEqual(info.moduleType, 'standard');
	});

	test('derives module type from file extension', () => {
		assert.strictEqual(bindModule('file:///A.bas', '').moduleType, 'standard');
		assert.strictEqual(bindModule('file:///A.cls', '').moduleType, 'class');
		assert.strictEqual(bindModule('file:///A.frm', '').moduleType, 'form');
	});

	test('prefers the VB_Name attribute over the file name', () => {
		const info = bindModule('file:///OnDisk.bas', 'Attribute VB_Name = "RealName"\n');
		assert.strictEqual(info.moduleName, 'RealName');
	});

	test('falls back to the file base name when there is no VB_Name attribute', () => {
		const info = bindModule('file:///MyModule.bas', 'Sub Foo()\nEnd Sub\n');
		assert.strictEqual(info.moduleName, 'MyModule');
	});
});

suite('ProjectIndex — global namespace rules', () => {
	test('a standard module\'s Public procedure is visible unqualified from another module', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///A.bas', 'Public Sub Helper()\nEnd Sub\n');
		const b = index.updateModule('file:///B.bas', 'Sub Caller()\nEnd Sub\n');

		const resolved = index.resolveUnqualified(b, b.procedures.get('CALLER')![0], 'Helper');
		assert.strictEqual(resolved?.kind, 'Procedure');
	});

	test('a standard module\'s Private procedure is not visible from another module', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///A.bas', 'Private Sub Secret()\nEnd Sub\n');
		const b = index.updateModule('file:///B.bas', 'Sub Caller()\nEnd Sub\n');

		assert.strictEqual(index.resolveUnqualified(b, undefined, 'Secret'), undefined);
	});

	test('a Private member is still resolvable from within its own module', () => {
		const index = new ProjectIndex();
		const a = index.updateModule('file:///A.bas', 'Private Sub Secret()\nEnd Sub\n');
		assert.strictEqual(index.resolveUnqualified(a, undefined, 'Secret')?.kind, 'Procedure');
	});

	test('class module members never enter the global table', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///MyClass.cls', 'Public Sub Foo()\nEnd Sub\n');
		const b = index.updateModule('file:///B.bas', 'Sub Caller()\nEnd Sub\n');

		assert.strictEqual(index.resolveUnqualified(b, undefined, 'Foo'), undefined);
	});

	test('class module members are reachable via member access when the target type is known', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///MyClass.cls', 'Public Sub Foo()\nEnd Sub\n');
		const resolved = index.resolveMember('MyClass', 'Foo');
		assert.strictEqual(resolved?.kind, 'Procedure');
	});

	test('a form\'s own name resolves as an implicit global default-instance variable', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///UserForm1.frm', 'Public Sub Show()\nEnd Sub\n');
		const b = index.updateModule('file:///B.bas', 'Sub Caller()\nEnd Sub\n');

		const resolved = index.resolveUnqualified(b, undefined, 'UserForm1');
		assert.strictEqual(resolved?.kind, 'Var');
		if (resolved?.kind === 'Var') {
			assert.strictEqual(resolved.type, 'UserForm1');
		}
	});

	test('re-indexing a module replaces its prior global contributions', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///A.bas', 'Public Sub Old()\nEnd Sub\n');
		const b = index.updateModule('file:///B.bas', 'Sub Caller()\nEnd Sub\n');
		assert.strictEqual(index.resolveUnqualified(b, undefined, 'Old')?.kind, 'Procedure');

		index.updateModule('file:///A.bas', 'Public Sub New_()\nEnd Sub\n');
		assert.strictEqual(index.resolveUnqualified(b, undefined, 'Old'), undefined);
		assert.strictEqual(index.resolveUnqualified(b, undefined, 'New_')?.kind, 'Procedure');
	});
});

suite('ProjectIndex — member-access type resolution', () => {
	test('resolves a local variable\'s declared type from a Dim anywhere in the procedure', () => {
		const index = new ProjectIndex();
		index.updateModule('file:///MyClass.cls', 'Public Sub Foo()\nEnd Sub\n');
		const a = index.updateModule(
			'file:///A.bas',
			'Sub Caller()\n' +
			'    If True Then\n' +
			'        Dim c As MyClass\n' +
			'    End If\n' +
			'    c.Foo\n' +
			'End Sub\n'
		);
		const proc = a.procedures.get('CALLER')![0];
		const type = index.findDeclaredType(a, proc, 'c');
		assert.strictEqual(type, 'MyClass');

		const resolved = index.resolveMember(type!, 'Foo');
		assert.strictEqual(resolved?.kind, 'Procedure');
	});

	test('resolves a declared type from "Set x = New Type" when the Dim itself had no As clause', () => {
		const index = new ProjectIndex();
		const a = index.updateModule(
			'file:///A.bas',
			'Sub Caller()\n' +
			'    Dim c\n' +
			'    Set c = New Collection\n' +
			'End Sub\n'
		);
		const proc = a.procedures.get('CALLER')![0];
		const type = index.findDeclaredType(a, proc, 'c');
		assert.strictEqual(type, 'Collection');
	});

	test('a typed Dim always wins over a later Set...New, regardless of source order', () => {
		const index = new ProjectIndex();
		const a = index.updateModule(
			'file:///A.bas',
			'Sub Caller()\n' +
			'    Dim c As ICollection\n' +
			'    Set c = New Collection\n' +
			'End Sub\n'
		);
		const proc = a.procedures.get('CALLER')![0];
		assert.strictEqual(index.findDeclaredType(a, proc, 'c'), 'ICollection');
	});

	test('an unresolvable type yields nothing rather than guessing', () => {
		const index = new ProjectIndex();
		assert.strictEqual(index.resolveMember('NoSuchType', 'Foo'), undefined);
	});
});
