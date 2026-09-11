import { ParameterInformation, Position, SignatureHelp, SignatureInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { ProcedureDecl } from '../parser/ast';
import { formatParam, formatSignature } from './format';

// Same-document only, matching the previous provider's scope — a
// project-wide symbol index arrives in a later phase. Re-derived per
// request from the real AST rather than the old mutable, request-order-
// dependent module-level signatureMap.
function collectSignatures(source: string): Map<string, ProcedureDecl[]> {
	const { module } = parse(source);
	const map = new Map<string, ProcedureDecl[]>();
	for (const stmt of module.body) {
		if (stmt.kind !== 'ProcedureDecl') {
			continue;
		}
		const key = stmt.name.toUpperCase();
		const list = map.get(key);
		if (list) {
			list.push(stmt);
		} else {
			map.set(key, [stmt]);
		}
	}
	return map;
}

export function getSignatureHelp(document: TextDocument, position: Position): SignatureHelp | undefined {
	const offset = document.offsetAt(position);
	const tokens = tokenize(document.getText());

	let openParenIndex = -1;
	let callName: string | undefined;
	let depth = 0;

	for (let i = tokens.length - 1; i >= 0; i--) {
		const t = tokens[i];
		if (document.offsetAt(t.range.start) >= offset) {
			continue;
		}
		if (t.kind === 'Punctuation' && t.value === ')') {
			depth++;
			continue;
		}
		if (t.kind === 'Punctuation' && t.value === '(') {
			if (depth === 0) {
				openParenIndex = i;
				const prev = tokens[i - 1];
				if (prev && (prev.kind === 'Identifier' || prev.kind === 'Keyword')) {
					callName = prev.text;
				}
				break;
			}
			depth--;
			continue;
		}
		if (depth === 0 && (t.kind === 'NewLine' || t.kind === 'Colon')) {
			break;
		}
	}

	if (!callName || openParenIndex < 0) {
		return undefined;
	}

	const signatures = collectSignatures(document.getText()).get(callName.toUpperCase());
	if (!signatures || signatures.length === 0) {
		return undefined;
	}

	let activeParameter = 0;
	let argDepth = 0;
	for (let i = openParenIndex + 1; i < tokens.length; i++) {
		const t = tokens[i];
		if (document.offsetAt(t.range.start) >= offset) {
			break;
		}
		if (t.kind === 'Punctuation' && t.value === '(') {
			argDepth++;
		} else if (t.kind === 'Punctuation' && t.value === ')') {
			if (argDepth === 0) {
				break;
			}
			argDepth--;
		} else if (t.kind === 'Punctuation' && t.value === ',' && argDepth === 0) {
			activeParameter++;
		}
	}

	return {
		signatures: signatures.map(sig => {
			const info = SignatureInformation.create(formatSignature(sig));
			info.parameters = sig.params.map(p =>
				ParameterInformation.create(formatParam(p), p.isOptional ? 'Optional parameter' : 'Required parameter')
			);
			return info;
		}),
		activeSignature: 0,
		activeParameter
	};
}
