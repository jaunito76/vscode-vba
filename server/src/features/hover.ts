import { Hover, MarkupKind, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectIndex } from '../semantics/projectIndex';
import { ResolvedSymbol } from '../semantics/symbols';
import { formatSignature } from './format';
import { resolveAtPosition } from './resolveAtPosition';

export function getHover(document: TextDocument, position: Position, projectIndex: ProjectIndex): Hover | undefined {
	const result = resolveAtPosition(document, position, projectIndex);
	if (!result) {
		return undefined;
	}
	return { contents: { kind: MarkupKind.Markdown, value: renderHover(result.resolved, document) } };
}

function renderHover(resolved: ResolvedSymbol, document: TextDocument): string {
	switch (resolved.kind) {
		case 'Procedure': {
			const code = resolved.procs.map(p => formatSignature(p.proc)).join('\n');
			// A resolved overload may live in a different module than the one
			// being hovered (the common cross-module call-site case) — its
			// range.start.line is a line number in THAT file, not this one,
			// so only look for a leading doc-comment when it's local.
			const first = resolved.procs[0];
			const doc = first.moduleUri === document.uri
				? getLeadingComment(document, first.proc.range.start.line)
				: undefined;
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
	for (let line = declarationLine - 1; line >= 0 && line < lines.length; line--) {
		const text = lines[line].trim();
		if (!text.startsWith("'")) {
			break;
		}
		collected.unshift(text.replace(/^'+\s?/, ''));
	}
	return collected.length ? collected.join('\n') : undefined;
}
