import { SymbolInformation, SymbolKind, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser/parser';
import { properCaseAccess, properCaseProcKind, properCasePropertyKind } from './format';

interface PropertyGroup {
	kinds: Set<'GET' | 'LET' | 'SET'>;
	range: Range;
	access?: string;
	isStatic: boolean;
}

export function getDocumentSymbols(document: TextDocument): SymbolInformation[] {
	const { module } = parse(document.getText());
	const result: SymbolInformation[] = [];
	const propertyGroups = new Map<string, PropertyGroup>();

	for (const stmt of module.body) {
		if (stmt.kind !== 'ProcedureDecl') {
			continue;
		}

		if (stmt.procKind === 'PROPERTY') {
			const existing = propertyGroups.get(stmt.name);
			if (existing) {
				if (stmt.propertyKind) {
					existing.kinds.add(stmt.propertyKind);
				}
				existing.range = Range.create(existing.range.start, stmt.range.end);
			} else {
				propertyGroups.set(stmt.name, {
					kinds: new Set(stmt.propertyKind ? [stmt.propertyKind] : []),
					range: stmt.range,
					access: stmt.access,
					isStatic: stmt.isStatic
				});
			}
			continue;
		}

		const displayName = `${stmt.name} (${properCaseAccess(stmt.access)} ${properCaseProcKind(stmt.procKind)})`;
		const symbolKind = stmt.procKind === 'FUNCTION' ? SymbolKind.Function : SymbolKind.Method;
		result.push(SymbolInformation.create(displayName, symbolKind, stmt.range, document.uri));
	}

	for (const [name, group] of propertyGroups) {
		const typesStr = Array.from(group.kinds).map(properCasePropertyKind).join('/');
		const displayName = `${name} (Property${typesStr ? ` ${typesStr}` : ''})`;
		result.push(
			SymbolInformation.create(
				displayName,
				SymbolKind.Property,
				group.range,
				document.uri,
				`${properCaseAccess(group.access)} ${group.isStatic ? 'Static ' : ''}Property`
			)
		);
	}

	return result;
}
