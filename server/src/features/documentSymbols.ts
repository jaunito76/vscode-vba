import { SymbolInformation, SymbolKind, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Ported as-is from the original in-process regex-based provider
// (src/documentSymbolProvider.ts) to prove the client/server LSP boundary
// works end-to-end. Will be replaced by a real AST walk in a later phase.

const regexStart = /^\s*((Public|Private|Friend)\s+)?((Static)\s+)?(Function|Sub|Property)\s+(((Let|Get|Set)\s+)?([a-zA-Z][a-zA-Z0-9_]*))\s*(\([^)]*\))?(?:\s+As\s+([a-zA-Z][a-zA-Z0-9_]*))?/i;

interface PropertyInfo {
	types: Set<string>;
	range: Range;
	access?: string;
	isStatic?: boolean;
}

export function getDocumentSymbols(document: TextDocument): SymbolInformation[] {
	const lines = document.getText().split(/\r\n|\r|\n/);
	const result: SymbolInformation[] = [];
	const propertyMap = new Map<string, PropertyInfo>();

	for (let line = 0; line < lines.length; line++) {
		const text = lines[line];
		const matches = text.match(regexStart);
		if (!matches) {
			continue;
		}

		const access = matches[2];
		const isStatic = !!matches[4];
		const kind = matches[5];
		const propType = matches[8];
		const name = matches[9];

		const range = Range.create(line, 0, line, text.length);

		if (kind === 'Property') {
			if (propertyMap.has(name)) {
				const prop = propertyMap.get(name)!;
				prop.types.add(propType || '');
				prop.range = Range.create(prop.range.start, range.end);
			} else {
				propertyMap.set(name, {
					types: new Set([propType || '']),
					range,
					access,
					isStatic
				});
			}
		} else {
			const myname = `${name} (${access || 'Public'} ${kind})`;
			const mysym = kind === 'Function' ? SymbolKind.Function : SymbolKind.Method;
			result.push(
				SymbolInformation.create(myname, mysym, range, document.uri)
			);
		}
	}

	for (const [name, info] of propertyMap) {
		const typesStr = Array.from(info.types).filter(t => t).join('/');
		const myname = `${name} (Property${typesStr ? ` ${typesStr}` : ''})`;
		result.push(
			SymbolInformation.create(
				myname,
				SymbolKind.Property,
				info.range,
				document.uri,
				`${info.access || 'Public'} ${info.isStatic ? 'Static ' : ''}Property`
			)
		);
	}

	return result;
}
