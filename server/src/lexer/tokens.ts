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
	/**
	 * Whitespace (or a line continuation) separated this token from the
	 * previous one. Needed to disambiguate `Foo(a, b)` (real call/index
	 * syntax) from `Foo (a), b` (a paren-less statement call whose first
	 * argument happens to be a parenthesized expression, e.g.
	 * `MsgBox ("text"), vbExclamation, "title"`) — real VBA itself
	 * disambiguates the two purely on adjacency. See parser.ts's
	 * parsePostfix `allowSpacedCall` option.
	 */
	spaceBefore: boolean;
}

// Every VBA/VBA-host reserved word this parser needs to recognize structurally.
// Not case-sensitive: lexer keyword lookup always upper-cases first.
//
// EXPLICIT/BASE/COMPARE are deliberately NOT here even though they're
// meaningful right after `Option` — none of the three is actually a
// reserved word in real VBA (only "Option Compare"/"Option Base"/"Option
// Explicit" as a fixed phrase is special), and real-world code uses all
// three as ordinary identifiers (a `Function Compare(...)`, a `Dim Base As
// Long`). Making them global keywords broke exactly that: see parser.ts's
// `parseOption`, which recognizes them contextually by token text instead.
export const KEYWORDS: ReadonlySet<string> = new Set([
	'IF', 'THEN', 'ELSE', 'ELSEIF', 'END', 'FOR', 'TO', 'STEP', 'NEXT', 'EACH', 'IN',
	'DO', 'WHILE', 'UNTIL', 'LOOP', 'WEND', 'SELECT', 'CASE', 'WITH', 'ON', 'ERROR',
	'RESUME', 'GOTO', 'SUB', 'FUNCTION', 'PROPERTY', 'GET', 'LET', 'SET', 'DIM', 'REDIM',
	'STATIC', 'CONST', 'TYPE', 'ENUM', 'PUBLIC', 'PRIVATE', 'FRIEND', 'GLOBAL',
	'OPTIONAL', 'PARAMARRAY', 'BYVAL', 'BYREF', 'AS', 'NEW', 'NOTHING', 'TRUE', 'FALSE',
	'NOT', 'AND', 'OR', 'XOR', 'EQV', 'IMP', 'MOD', 'IS', 'LIKE', 'CALL', 'EXIT',
	'ATTRIBUTE', 'OPTION', 'IMPLEMENTS', 'EVENT',
	'RAISEEVENT', 'DECLARE', 'LIB', 'ALIAS', 'WITHEVENTS', 'PRESERVE', 'REM'
]);
