import { Range } from 'vscode-languageserver/node';

// Plain discriminated unions rather than classes: cheap to construct, easy
// to `switch (node.kind)` on, and trivial to assert against in tests.
// Every node carries an LSP-native 0-based range so no coordinate
// translation layer is needed by callers.

export type Expr =
	| IdentifierExpr
	| LiteralExpr
	| UnaryExpr
	| BinaryExpr
	| MemberExpr
	| WithMemberExpr
	| CallExpr
	| NewExpr
	| NamedArgExpr
	| OmittedArgExpr
	| ErrorExpr;

export interface IdentifierExpr {
	kind: 'Identifier';
	name: string;
	range: Range;
}

export type LiteralKind = 'String' | 'Integer' | 'Float' | 'Date' | 'Boolean' | 'Nothing';

export interface LiteralExpr {
	kind: 'Literal';
	literalKind: LiteralKind;
	value: string;
	range: Range;
}

export interface UnaryExpr {
	kind: 'UnaryExpr';
	op: string;
	operand: Expr;
	range: Range;
}

export interface BinaryExpr {
	kind: 'BinaryExpr';
	op: string;
	left: Expr;
	right: Expr;
	range: Range;
}

/** target.name */
export interface MemberExpr {
	kind: 'MemberExpr';
	target: Expr;
	name: string;
	nameRange: Range;
	range: Range;
}

/** Bare ".name" inside a With block, implicitly targeting the With subject. */
export interface WithMemberExpr {
	kind: 'WithMemberExpr';
	name: string;
	nameRange: Range;
	range: Range;
}

/** callee(args) — also covers array indexing, which shares the same syntax. */
export interface CallExpr {
	kind: 'CallExpr';
	callee: Expr;
	args: Expr[];
	range: Range;
}

export interface NewExpr {
	kind: 'NewExpr';
	typeName: string;
	range: Range;
}

/** A `name:=value` call argument. */
export interface NamedArgExpr {
	kind: 'NamedArgExpr';
	name: string;
	value: Expr;
	range: Range;
}

/** An omitted positional argument, e.g. the middle argument in `Foo(a, , c)`. */
export interface OmittedArgExpr {
	kind: 'OmittedArgExpr';
	range: Range;
}

/** Placeholder produced when expression parsing can't make sense of a token. */
export interface ErrorExpr {
	kind: 'ErrorExpr';
	range: Range;
}

export interface ArrayBound {
	lower?: Expr;
	upper: Expr;
}

export interface VarDecl {
	name: string;
	nameRange: Range;
	isArray: boolean;
	bounds?: ArrayBound[];
	type?: string;
	range: Range;
}

export interface ConstDecl {
	name: string;
	nameRange: Range;
	type?: string;
	value: Expr;
	range: Range;
}

export interface EnumMember {
	name: string;
	nameRange: Range;
	value?: Expr;
	range: Range;
}

export interface Param {
	name: string;
	nameRange: Range;
	byRef: boolean;
	isOptional: boolean;
	isParamArray: boolean;
	isArray: boolean;
	type?: string;
	defaultValue?: Expr;
	range: Range;
}

export interface ReDimTarget {
	target: Expr;
	type?: string;
	range: Range;
}

export type CaseTest =
	| { kind: 'Value'; expr: Expr }
	| { kind: 'Range'; from: Expr; to: Expr }
	| { kind: 'Relational'; op: string; expr: Expr };

export interface CaseClause {
	kind: 'Case' | 'CaseElse';
	tests?: CaseTest[];
	body: Stmt[];
	range: Range;
}

// Module-level declarations and procedure-level statements share one
// Statement grammar: legality of a given kind in a given position (e.g. a
// Dim inside a Type block) is left to a later semantic pass, not enforced
// by the parser, which keeps error recovery simpler.
export type Stmt =
	| ErrorStatement
	| LabelStmt
	| AttributeStmt
	| OptionStmt
	| DimStmt
	| ConstStmt
	| TypeDecl
	| EnumDecl
	| DeclareStmt
	| EventDecl
	| ImplementsStmt
	| ProcedureDecl
	| ReDimStmt
	| AssignStmt
	| CallStmt
	| IfStmt
	| ForStmt
	| ForEachStmt
	| DoLoopStmt
	| SelectCaseStmt
	| WithStmt
	| OnErrorStmt
	| ExitStmt
	| GoToStmt
	| ResumeStmt
	| RaiseEventStmt;

/** Wraps a span of tokens skipped during panic-mode error recovery. */
export interface ErrorStatement {
	kind: 'ErrorStatement';
	range: Range;
}

export interface LabelStmt {
	kind: 'LabelStmt';
	name: string;
	range: Range;
}

export interface AttributeStmt {
	kind: 'AttributeStmt';
	name: string;
	value: Expr;
	range: Range;
}

export interface OptionStmt {
	kind: 'OptionStmt';
	name: string;
	range: Range;
}

export interface DimStmt {
	kind: 'DimStmt';
	declKeyword: string;
	access?: string;
	isStatic: boolean;
	withEvents: boolean;
	declarations: VarDecl[];
	range: Range;
}

export interface ConstStmt {
	kind: 'ConstStmt';
	access?: string;
	declarations: ConstDecl[];
	range: Range;
}

export interface TypeDecl {
	kind: 'TypeDecl';
	access?: string;
	name: string;
	nameRange: Range;
	fields: VarDecl[];
	range: Range;
}

export interface EnumDecl {
	kind: 'EnumDecl';
	access?: string;
	name: string;
	nameRange: Range;
	members: EnumMember[];
	range: Range;
}

export interface DeclareStmt {
	kind: 'DeclareStmt';
	access?: string;
	procKind: 'SUB' | 'FUNCTION';
	name: string;
	lib: string;
	alias?: string;
	params: Param[];
	returnType?: string;
	range: Range;
}

export interface EventDecl {
	kind: 'EventDecl';
	access?: string;
	name: string;
	params: Param[];
	range: Range;
}

export interface ImplementsStmt {
	kind: 'ImplementsStmt';
	typeName: string;
	range: Range;
}

export interface ProcedureDecl {
	kind: 'ProcedureDecl';
	procKind: 'SUB' | 'FUNCTION' | 'PROPERTY';
	propertyKind?: 'GET' | 'LET' | 'SET';
	access?: string;
	isStatic: boolean;
	name: string;
	nameRange: Range;
	params: Param[];
	returnType?: string;
	body: Stmt[];
	range: Range;
}

export interface ReDimStmt {
	kind: 'ReDimStmt';
	preserve: boolean;
	targets: ReDimTarget[];
	range: Range;
}

export interface AssignStmt {
	kind: 'AssignStmt';
	isSet: boolean;
	target: Expr;
	value: Expr;
	range: Range;
}

/** A bare expression statement: a call (with or without `Call`/parens) or naked expression. */
export interface CallStmt {
	kind: 'CallStmt';
	expr: Expr;
	range: Range;
}

export interface IfStmt {
	kind: 'IfStmt';
	branches: { condition: Expr; body: Stmt[] }[];
	elseBody?: Stmt[];
	isSingleLine: boolean;
	range: Range;
}

export interface ForStmt {
	kind: 'ForStmt';
	loopVar: Expr;
	from: Expr;
	to: Expr;
	step?: Expr;
	body: Stmt[];
	range: Range;
}

export interface ForEachStmt {
	kind: 'ForEachStmt';
	loopVar: Expr;
	collection: Expr;
	body: Stmt[];
	range: Range;
}

export interface DoLoopStmt {
	kind: 'DoLoopStmt';
	conditionPosition?: 'Top' | 'Bottom';
	conditionKind?: 'While' | 'Until';
	condition?: Expr;
	body: Stmt[];
	range: Range;
}

export interface SelectCaseStmt {
	kind: 'SelectCaseStmt';
	selector: Expr;
	cases: CaseClause[];
	range: Range;
}

export interface WithStmt {
	kind: 'WithStmt';
	target: Expr;
	body: Stmt[];
	range: Range;
}

export interface OnErrorStmt {
	kind: 'OnErrorStmt';
	mode: 'ResumeNext' | 'GotoLabel' | 'GotoZero';
	label?: string;
	range: Range;
}

export interface ExitStmt {
	kind: 'ExitStmt';
	target: string;
	range: Range;
}

export interface GoToStmt {
	kind: 'GoToStmt';
	label: string;
	range: Range;
}

export interface ResumeStmt {
	kind: 'ResumeStmt';
	mode: 'Next' | 'Label' | 'Bare';
	label?: string;
	range: Range;
}

export interface RaiseEventStmt {
	kind: 'RaiseEventStmt';
	name: string;
	args: Expr[];
	range: Range;
}

export interface Module {
	kind: 'Module';
	body: Stmt[];
	range: Range;
}

export interface ParseDiagnostic {
	message: string;
	range: Range;
}

export interface ParseResult {
	module: Module;
	diagnostics: ParseDiagnostic[];
}
