import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenize } from '../lexer/lexer';
import { Token } from '../lexer/tokens';
import { ProcedureDecl, Stmt } from '../parser/ast';
import { bindModule } from '../semantics/moduleBinder';
import { ProjectIndex } from '../semantics/projectIndex';
import { ModuleInfo, ResolvedSymbol } from '../semantics/symbols';

export interface PositionResolution {
	token: Token;
	moduleInfo: ModuleInfo;
	proc: ProcedureDecl | undefined;
	resolved: ResolvedSymbol;
}

/**
 * Shared by Hover, Go to Definition, and Find References: finds the token
 * under the cursor and resolves it through the same local -> module ->
 * global -> member path (via ProjectIndex), so the three features can
 * never disagree about what a given position refers to.
 */
export function resolveAtPosition(
	document: TextDocument,
	position: Position,
	projectIndex: ProjectIndex
): PositionResolution | undefined {
	const offset = document.offsetAt(position);
	const tokens = tokenize(document.getText());
	const tokenIndex = tokens.findIndex(t => {
		const start = document.offsetAt(t.range.start);
		const end = document.offsetAt(t.range.end);
		return offset >= start && offset <= end;
	});
	if (tokenIndex < 0) {
		return undefined;
	}
	const token = tokens[tokenIndex];
	if (token.kind !== 'Identifier' && token.kind !== 'Keyword') {
		return undefined;
	}

	// Bind fresh from this document's current text (not whatever the
	// project index currently has for this uri) so resolution stays
	// accurate mid-edit, before the debounced re-index catches up.
	const moduleInfo = bindModule(document.uri, document.getText());
	const proc = findEnclosingProcedure(moduleInfo.ast.body, position);

	// Walk backward over a '.'-separated chain (a.b.c) to see whether this
	// is a member access and, if so, what it's a member of.
	const chain: string[] = [];
	let i = tokenIndex - 1;
	while (
		i >= 1 &&
		tokens[i].kind === 'Punctuation' && tokens[i].value === '.' &&
		(tokens[i - 1].kind === 'Identifier' || tokens[i - 1].kind === 'Keyword')
	) {
		chain.unshift(tokens[i - 1].text);
		i -= 2;
	}

	let resolved: ResolvedSymbol | undefined;
	if (chain.length === 0) {
		resolved = projectIndex.resolveUnqualified(moduleInfo, proc, token.text);
	} else {
		let type: string | undefined = projectIndex.findDeclaredType(moduleInfo, proc, chain[0]);
		for (const step of chain.slice(1)) {
			if (!type) {
				break;
			}
			const member = projectIndex.resolveMember(type, step);
			type = member?.kind === 'Var' ? member.type : undefined;
		}
		resolved = type ? projectIndex.resolveMember(type, token.text) : undefined;
	}

	return resolved ? { token, moduleInfo, proc, resolved } : undefined;
}

/**
 * The precise (name-only, not whole-statement) declaration location(s) for
 * a resolved symbol — shared by Go to Definition and Find References'
 * `includeDeclaration` option, so the two features never disagree about
 * where a symbol "lives".
 */
export function getDeclarationLocations(result: PositionResolution): Location[] {
	const { resolved, moduleInfo, proc } = result;
	switch (resolved.kind) {
		case 'Procedure':
			return resolved.procs.map(p => Location.create(p.moduleUri, p.proc.nameRange));
		case 'Var':
			return [Location.create(resolved.moduleUri, resolved.decl.nameRange)];
		case 'Const':
			return [Location.create(resolved.moduleUri, resolved.decl.nameRange)];
		case 'Type':
			return [Location.create(resolved.moduleUri, resolved.decl.nameRange)];
		case 'Enum':
			return [Location.create(resolved.moduleUri, resolved.decl.nameRange)];
		case 'Module':
			return [Location.create(resolved.moduleUri, resolved.range)];
		case 'Param': {
			const upper = resolved.name.toUpperCase();
			const param = proc?.params.find(p => p.name.toUpperCase() === upper);
			return param ? [Location.create(moduleInfo.uri, param.nameRange)] : [];
		}
	}
}

function findEnclosingProcedure(body: Stmt[], position: Position): ProcedureDecl | undefined {
	for (const stmt of body) {
		if (stmt.kind === 'ProcedureDecl' && rangeContains(stmt.range, position)) {
			return stmt;
		}
	}
	return undefined;
}

function rangeContains(range: Range, position: Position): boolean {
	if (position.line < range.start.line || position.line > range.end.line) {
		return false;
	}
	if (position.line === range.start.line && position.character < range.start.character) {
		return false;
	}
	if (position.line === range.end.line && position.character > range.end.character) {
		return false;
	}
	return true;
}
