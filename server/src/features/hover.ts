import { Hover, MarkupKind, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenize } from '../lexer/lexer';
import { ProcedureDecl, Stmt } from '../parser/ast';
import { bindModule } from '../semantics/moduleBinder';
import { ProjectIndex } from '../semantics/projectIndex';
import { ResolvedSymbol } from '../semantics/symbols';
import { formatSignature } from './format';

export function getHover(document: TextDocument, position: Position, projectIndex: ProjectIndex): Hover | undefined {
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
	// project index currently has for this uri) so hover stays accurate
	// mid-edit, before the debounced re-index catches up.
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

	if (!resolved) {
		return undefined;
	}

	return { contents: { kind: MarkupKind.Markdown, value: renderHover(resolved, document) } };
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

function renderHover(resolved: ResolvedSymbol, document: TextDocument): string {
	switch (resolved.kind) {
		case 'Procedure': {
			const code = resolved.procs.map(p => formatSignature(p.proc)).join('\n');
			const doc = getLeadingComment(document, resolved.procs[0].proc.range.start.line);
			return doc ? `\`\`\`vba\n${code}\n\`\`\`\n\n${doc}` : `\`\`\`vba\n${code}\n\`\`\``;
		}
		case 'Var':
			return `\`\`\`vba\n${resolved.name} As ${resolved.type || 'Variant'}\n\`\`\``;
		case 'Param':
			return `\`\`\`vba\n${resolved.name} As ${resolved.type || 'Variant'}\n\`\`\`\n\n*Parameter*`;
		case 'Const':
			return `\`\`\`vba\nConst ${resolved.name} As ${resolved.decl.type || 'Variant'}\n\`\`\``;
		case 'Type':
			return `\`\`\`vba\nType ${resolved.name}\n\`\`\``;
		case 'Enum':
			return `\`\`\`vba\nEnum ${resolved.name}\n\`\`\``;
	}
}

/** Consecutive `'`-comment lines immediately above a declaration, a doc-comment convention already common in real VBA codebases. */
function getLeadingComment(document: TextDocument, declarationLine: number): string | undefined {
	const lines = document.getText().split(/\r\n|\r|\n/);
	const collected: string[] = [];
	for (let line = declarationLine - 1; line >= 0; line--) {
		const text = lines[line].trim();
		if (!text.startsWith("'")) {
			break;
		}
		collected.unshift(text.replace(/^'+\s?/, ''));
	}
	return collected.length ? collected.join('\n') : undefined;
}
