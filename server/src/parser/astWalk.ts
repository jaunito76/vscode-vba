import { Range } from 'vscode-languageserver/node';
import { Expr, IdentifierExpr, ProcedureDecl, Stmt } from './ast';

/**
 * The statement bodies nested directly inside a control-flow statement.
 * VBA has no block scoping, so callers generally want to keep recursing
 * into these when looking for a declaration or a use anywhere in a
 * procedure — not just at the top level of its body.
 */
export function getNestedBodies(stmt: Stmt): Stmt[][] {
	switch (stmt.kind) {
		case 'IfStmt':
			return [...stmt.branches.map(b => b.body), ...(stmt.elseBody ? [stmt.elseBody] : [])];
		case 'ForStmt':
		case 'ForEachStmt':
		case 'DoLoopStmt':
		case 'WithStmt':
			return [stmt.body];
		case 'SelectCaseStmt':
			return stmt.cases.map(c => c.body);
		default:
			return [];
	}
}

/**
 * Every name a procedure declares as its own, upper-cased: parameters plus
 * every Dim/Static and local Const anywhere in its body (VBA has no block
 * scoping, so a Dim inside an If/For is still procedure-scoped). Does not
 * include For/For Each loop variables — VBA still requires those to be
 * declared separately under Option Explicit, so treating the loop itself
 * as a declaration would hide a genuine "variable not defined" error.
 */
export function collectProcLocalNames(proc: ProcedureDecl): Set<string> {
	const names = new Set<string>();
	for (const param of proc.params) {
		names.add(param.name.toUpperCase());
	}
	collectLocalDeclarations(proc.body, names);
	return names;
}

function collectLocalDeclarations(stmts: Stmt[], names: Set<string>): void {
	for (const stmt of stmts) {
		if (stmt.kind === 'DimStmt') {
			for (const decl of stmt.declarations) {
				names.add(decl.name.toUpperCase());
			}
		} else if (stmt.kind === 'ConstStmt') {
			for (const decl of stmt.declarations) {
				names.add(decl.name.toUpperCase());
			}
		}
		for (const nested of getNestedBodies(stmt)) {
			collectLocalDeclarations(nested, names);
		}
	}
}

export interface NameRef {
	name: string;
	range: Range;
}

interface Visitors {
	onIdentifier: (id: IdentifierExpr) => void;
	onMemberName?: (name: string, range: Range) => void;
}

/**
 * Visits every IdentifierExpr reachable from a statement list, including
 * assignment targets, loop variables, array bounds, and call arguments —
 * anywhere an identifier is genuinely a reference, never a declaration
 * name (declaration names are plain strings on VarDecl/ConstDecl/Param in
 * this AST, not Identifier nodes, so there's no ambiguity to filter out)
 * and never a member name (MemberExpr.name is a separate field). Used by
 * the Option Explicit check, where a member name is never a variable.
 */
export function forEachIdentifier(stmts: Stmt[], visit: (id: IdentifierExpr) => void): void {
	walkStmts(stmts, { onIdentifier: visit });
}

/**
 * Like forEachIdentifier, but also visits member-access name sites
 * (`target.Name`, and bare `.Name` inside a With block) — real reference
 * sites for Find References/Go to Definition even though they're not
 * "variables" for Option Explicit's purposes.
 */
export function forEachNameReference(stmts: Stmt[], visit: (ref: NameRef) => void): void {
	walkStmts(stmts, {
		onIdentifier: id => visit({ name: id.name, range: id.range }),
		onMemberName: (name, range) => visit({ name, range })
	});
}

function walkStmts(stmts: Stmt[], v: Visitors): void {
	for (const stmt of stmts) {
		visitStmt(stmt, v);
	}
}

function visitExpr(expr: Expr, v: Visitors): void {
	switch (expr.kind) {
		case 'Identifier':
			v.onIdentifier(expr);
			return;
		case 'UnaryExpr':
			visitExpr(expr.operand, v);
			return;
		case 'BinaryExpr':
			visitExpr(expr.left, v);
			visitExpr(expr.right, v);
			return;
		case 'MemberExpr':
			visitExpr(expr.target, v);
			v.onMemberName?.(expr.name, expr.nameRange);
			return;
		case 'CallExpr':
			visitExpr(expr.callee, v);
			for (const arg of expr.args) {
				visitExpr(arg, v);
			}
			return;
		case 'NamedArgExpr':
			visitExpr(expr.value, v);
			return;
		case 'WithMemberExpr':
			v.onMemberName?.(expr.name, expr.nameRange);
			return;
		case 'Literal':
		case 'NewExpr':
		case 'OmittedArgExpr':
		case 'ErrorExpr':
			return;
	}
}

function visitStmt(stmt: Stmt, v: Visitors): void {
	switch (stmt.kind) {
		case 'AttributeStmt':
			visitExpr(stmt.value, v);
			return;
		case 'DimStmt':
			for (const decl of stmt.declarations) {
				for (const bound of decl.bounds ?? []) {
					if (bound.lower) {
						visitExpr(bound.lower, v);
					}
					visitExpr(bound.upper, v);
				}
			}
			return;
		case 'ConstStmt':
			for (const decl of stmt.declarations) {
				visitExpr(decl.value, v);
			}
			return;
		case 'EnumDecl':
			for (const member of stmt.members) {
				if (member.value) {
					visitExpr(member.value, v);
				}
			}
			return;
		case 'DeclareStmt':
		case 'EventDecl':
			for (const param of stmt.params) {
				if (param.defaultValue) {
					visitExpr(param.defaultValue, v);
				}
			}
			return;
		case 'ProcedureDecl':
			for (const param of stmt.params) {
				if (param.defaultValue) {
					visitExpr(param.defaultValue, v);
				}
			}
			walkStmts(stmt.body, v);
			return;
		case 'ReDimStmt':
			for (const target of stmt.targets) {
				visitExpr(target.target, v);
			}
			return;
		case 'AssignStmt':
			visitExpr(stmt.target, v);
			visitExpr(stmt.value, v);
			return;
		case 'CallStmt':
			visitExpr(stmt.expr, v);
			return;
		case 'IfStmt':
			for (const branch of stmt.branches) {
				visitExpr(branch.condition, v);
				walkStmts(branch.body, v);
			}
			if (stmt.elseBody) {
				walkStmts(stmt.elseBody, v);
			}
			return;
		case 'ForStmt':
			visitExpr(stmt.loopVar, v);
			visitExpr(stmt.from, v);
			visitExpr(stmt.to, v);
			if (stmt.step) {
				visitExpr(stmt.step, v);
			}
			walkStmts(stmt.body, v);
			return;
		case 'ForEachStmt':
			visitExpr(stmt.loopVar, v);
			visitExpr(stmt.collection, v);
			walkStmts(stmt.body, v);
			return;
		case 'DoLoopStmt':
			if (stmt.condition) {
				visitExpr(stmt.condition, v);
			}
			walkStmts(stmt.body, v);
			return;
		case 'SelectCaseStmt':
			visitExpr(stmt.selector, v);
			for (const caseClause of stmt.cases) {
				for (const test of caseClause.tests ?? []) {
					if (test.kind === 'Value' || test.kind === 'Relational') {
						visitExpr(test.expr, v);
					} else {
						visitExpr(test.from, v);
						visitExpr(test.to, v);
					}
				}
				walkStmts(caseClause.body, v);
			}
			return;
		case 'WithStmt':
			visitExpr(stmt.target, v);
			walkStmts(stmt.body, v);
			return;
		case 'RaiseEventStmt':
			for (const arg of stmt.args) {
				visitExpr(arg, v);
			}
			return;
		case 'FileIOStmt':
			for (const expr of stmt.exprs) {
				visitExpr(expr, v);
			}
			return;
		default:
			return;
	}
}
