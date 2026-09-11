import { Range } from 'vscode-languageserver/node';

export type TokenKind =
	| 'Identifier'
	| 'Keyword'
	| 'String'
	| 'Integer'
	| 'Float'
	| 'Date'
	| 'Punctuation'
	| 'Colon'
	| 'NewLine'
	| 'EOF';

export interface Token {
	kind: TokenKind;
	/** Original source text, casing preserved. */
	text: string;
	/** Canonical form: upper-cased keyword name, or unescaped literal value. */
	value: string;
	range: Range;
}

// Every VBA/VBA-host reserved word this parser needs to recognize structurally.
// Not case-sensitive: lexer keyword lookup always upper-cases first.
export const KEYWORDS: ReadonlySet<string> = new Set([
	'IF', 'THEN', 'ELSE', 'ELSEIF', 'END', 'FOR', 'TO', 'STEP', 'NEXT', 'EACH', 'IN',
	'DO', 'WHILE', 'UNTIL', 'LOOP', 'WEND', 'SELECT', 'CASE', 'WITH', 'ON', 'ERROR',
	'RESUME', 'GOTO', 'SUB', 'FUNCTION', 'PROPERTY', 'GET', 'LET', 'SET', 'DIM', 'REDIM',
	'STATIC', 'CONST', 'TYPE', 'ENUM', 'PUBLIC', 'PRIVATE', 'FRIEND', 'GLOBAL',
	'OPTIONAL', 'PARAMARRAY', 'BYVAL', 'BYREF', 'AS', 'NEW', 'NOTHING', 'TRUE', 'FALSE',
	'NOT', 'AND', 'OR', 'XOR', 'EQV', 'IMP', 'MOD', 'IS', 'LIKE', 'CALL', 'EXIT',
	'ATTRIBUTE', 'OPTION', 'EXPLICIT', 'BASE', 'COMPARE', 'IMPLEMENTS', 'EVENT',
	'RAISEEVENT', 'DECLARE', 'LIB', 'ALIAS', 'WITHEVENTS', 'PRESERVE', 'REM'
]);
