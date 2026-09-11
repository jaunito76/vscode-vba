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

/**
 * Visits every IdentifierExpr reachable from a statement list, including
 * assignment targets, loop variables, array bounds, and call arguments —
 * anywhere an identifier is genuinely a reference, never a declaration
 * name (declaration names are plain strings on VarDecl/ConstDecl/Param in
 * this AST, not Identifier nodes, so there's no ambiguity to filter out)
 * and never a member name (MemberExpr.name is a plain string too).
 */
export function forEachIdentifier(stmts: Stmt[], visit: (id: IdentifierExpr) => void): void {
	for (const stmt of stmts) {
		visitStmt(stmt, visit);
	}
}

function visitExpr(expr: Expr, visit: (id: IdentifierExpr) => void): void {
	switch (expr.kind) {
		case 'Identifier':
			visit(expr);
			return;
		case 'UnaryExpr':
			visitExpr(expr.operand, visit);
			return;
		case 'BinaryExpr':
			visitExpr(expr.left, visit);
			visitExpr(expr.right, visit);
			return;
		case 'MemberExpr':
			visitExpr(expr.target, visit);
			return;
		case 'CallExpr':
			visitExpr(expr.callee, visit);
			for (const arg of expr.args) {
				visitExpr(arg, visit);
			}
			return;
		case 'NamedArgExpr':
			visitExpr(expr.value, visit);
			return;
		case 'Literal':
		case 'WithMemberExpr':
		case 'NewExpr':
		case 'OmittedArgExpr':
		case 'ErrorExpr':
			return;
	}
}

function visitStmt(stmt: Stmt, visit: (id: IdentifierExpr) => void): void {
	switch (stmt.kind) {
		case 'AttributeStmt':
			visitExpr(stmt.value, visit);
			return;
		case 'DimStmt':
			for (const decl of stmt.declarations) {
				for (const bound of decl.bounds ?? []) {
					if (bound.lower) {
						visitExpr(bound.lower, visit);
					}
					visitExpr(bound.upper, visit);
				}
			}
			return;
		case 'ConstStmt':
			for (const decl of stmt.declarations) {
				visitExpr(decl.value, visit);
			}
			return;
		case 'EnumDecl':
			for (const member of stmt.members) {
				if (member.value) {
					visitExpr(member.value, visit);
				}
			}
			return;
		case 'DeclareStmt':
		case 'EventDecl':
			for (const param of stmt.params) {
				if (param.defaultValue) {
					visitExpr(param.defaultValue, visit);
				}
			}
			return;
		case 'ProcedureDecl':
			for (const param of stmt.params) {
				if (param.defaultValue) {
					visitExpr(param.defaultValue, visit);
				}
			}
			forEachIdentifier(stmt.body, visit);
			return;
		case 'ReDimStmt':
			for (const target of stmt.targets) {
				visitExpr(target.target, visit);
			}
			return;
		case 'AssignStmt':
			visitExpr(stmt.target, visit);
			visitExpr(stmt.value, visit);
			return;
		case 'CallStmt':
			visitExpr(stmt.expr, visit);
			return;
		case 'IfStmt':
			for (const branch of stmt.branches) {
				visitExpr(branch.condition, visit);
				forEachIdentifier(branch.body, visit);
			}
			if (stmt.elseBody) {
				forEachIdentifier(stmt.elseBody, visit);
			}
			return;
		case 'ForStmt':
			visitExpr(stmt.loopVar, visit);
			visitExpr(stmt.from, visit);
			visitExpr(stmt.to, visit);
			if (stmt.step) {
				visitExpr(stmt.step, visit);
			}
			forEachIdentifier(stmt.body, visit);
			return;
		case 'ForEachStmt':
			visitExpr(stmt.loopVar, visit);
			visitExpr(stmt.collection, visit);
			forEachIdentifier(stmt.body, visit);
			return;
		case 'DoLoopStmt':
			if (stmt.condition) {
				visitExpr(stmt.condition, visit);
			}
			forEachIdentifier(stmt.body, visit);
			return;
		case 'SelectCaseStmt':
			visitExpr(stmt.selector, visit);
			for (const caseClause of stmt.cases) {
				for (const test of caseClause.tests ?? []) {
					if (test.kind === 'Value' || test.kind === 'Relational') {
						visitExpr(test.expr, visit);
					} else {
						visitExpr(test.from, visit);
						visitExpr(test.to, visit);
					}
				}
				forEachIdentifier(caseClause.body, visit);
			}
			return;
		case 'WithStmt':
			visitExpr(stmt.target, visit);
			forEachIdentifier(stmt.body, visit);
			return;
		case 'RaiseEventStmt':
			for (const arg of stmt.args) {
				visitExpr(arg, visit);
			}
			return;
		default:
			return;
	}
}
