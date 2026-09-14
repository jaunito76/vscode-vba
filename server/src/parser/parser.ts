import { Position, Range } from 'vscode-languageserver/node';
import { Token, TokenKind } from '../lexer/tokens';
import { tokenize } from '../lexer/lexer';
import {
	ArrayBound,
	CaseClause,
	CaseTest,
	ConstDecl,
	EnumMember,
	Expr,
	Module,
	Param,
	ParseDiagnostic,
	ParseResult,
	ReDimTarget,
	Stmt,
	VarDecl
} from './ast';

const COMPARISON_OPS = ['=', '<>', '<', '>', '<=', '>='];
const BLOCK_STOP_KEYWORDS = ['ELSE', 'ELSEIF', 'END', 'NEXT', 'LOOP', 'WEND', 'CASE'];

export function parse(text: string): ParseResult {
	return new Parser(tokenize(text)).parseModule();
}

/**
 * Recursive-descent parser with panic-mode error recovery: an unexpected
 * token anywhere becomes a diagnostic plus a skip to the next statement
 * separator, so one malformed statement never blanks out the rest of the
 * file's symbols/diagnostics. Grammar accepts constructs permissively
 * regardless of nesting legality (e.g. Dim inside Type) — illegal
 * placement is left to a later semantic pass.
 */
class Parser {
	private pos = 0;
	private readonly diagnostics: ParseDiagnostic[] = [];

	constructor(private readonly tokens: Token[]) {}

	parseModule(): ParseResult {
		const start = this.peek().range.start;
		const body: Stmt[] = [];
		this.skipStatementSeparators();
		this.skipDesignerHeader();
		while (!this.isAtEnd()) {
			body.push(this.parseStatement());
			this.skipStatementSeparators();
		}
		const module: Module = { kind: 'Module', body, range: Range.create(start, this.previousEnd()) };
		return { module, diagnostics: this.diagnostics };
	}

	/**
	 * VB IDE-exported `.cls`/`.frm` files open with a designer metadata
	 * block — `VERSION x.xx [CLASS]`, then (for `.frm`, and always for
	 * `.cls`) a `Begin ... End` property list, nested once per child
	 * control on a form — before the real code starts at `Attribute
	 * VB_Name`. None of it is executable VBA grammar (property values
	 * include GUID literals and the designer's own `"file.frx":NNNN`
	 * binary-blob-offset syntax), so it's skipped wholesale at the token
	 * level rather than parsed. Neither `VERSION` nor `BEGIN` is a
	 * reserved word — this only fires when one is literally the first
	 * token of the file, so it can't misfire on real code using either as
	 * an identifier.
	 */
	private skipDesignerHeader(): void {
		if (this.peek().kind === 'Identifier' && this.peek().text.toUpperCase() === 'VERSION') {
			while (!this.check('NewLine') && !this.isAtEnd()) {
				this.advance();
			}
			this.skipStatementSeparators();
		}
		if (this.peek().kind === 'Identifier' && this.peek().text.toUpperCase() === 'BEGIN') {
			let depth = 0;
			do {
				const t = this.advance();
				if (t.kind === 'Identifier' && t.text.toUpperCase() === 'BEGIN') {
					depth++;
				} else if (t.kind === 'Keyword' && t.value === 'END') {
					depth--;
				}
			} while (depth > 0 && !this.isAtEnd());
			this.skipStatementSeparators();
		}
	}

	/**
	 * Conditional compilation (`#If`/`#ElseIf`/`#Else`/`#End If`/`#Const`).
	 * Not evaluated — there's no compile-time constant environment to
	 * resolve `#If Win64 Then` against, and every downstream feature just
	 * wants to see the code in each branch, so the directive line itself is
	 * skipped and the statements inside every branch are parsed as plain
	 * sequential statements (indistinguishable from an ordinary `If`
	 * block's body, just without the block-stop-keyword nesting `#End If`
	 * would otherwise require).
	 */
	private parseCompilerDirective(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // '#'
		while (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
			this.advance();
		}
		return { kind: 'CompilerDirectiveStmt', range: Range.create(start, this.previousEnd()) };
	}

	// ---- token cursor helpers -------------------------------------------------

	private peek(): Token {
		return this.tokens[this.pos];
	}

	private peekAt(offset: number): Token {
		return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
	}

	private advance(): Token {
		const t = this.tokens[this.pos];
		if (t.kind !== 'EOF') {
			this.pos++;
		}
		return t;
	}

	private isAtEnd(): boolean {
		return this.peek().kind === 'EOF';
	}

	private previousEnd(): Position {
		return this.tokens[Math.max(0, this.pos - 1)].range.end;
	}

	private check(kind: TokenKind): boolean {
		return this.peek().kind === kind;
	}

	private checkKeyword(word: string): boolean {
		const t = this.peek();
		return t.kind === 'Keyword' && t.value === word;
	}

	/** Like checkKeyword, but also matches a plain Identifier token with this text — for words (EXPLICIT/BASE/COMPARE) that are only reserved contextually, not globally. */
	private checkContextualWord(word: string): boolean {
		const t = this.peek();
		return (t.kind === 'Keyword' || t.kind === 'Identifier') && t.text.toUpperCase() === word;
	}

	private checkPunct(p: string): boolean {
		const t = this.peek();
		return t.kind === 'Punctuation' && t.value === p;
	}

	private currentIsKeyword(words: string[]): boolean {
		const t = this.peek();
		return t.kind === 'Keyword' && words.includes(t.value);
	}

	private expectKeyword(word: string): void {
		if (this.checkKeyword(word)) {
			this.advance();
			return;
		}
		this.error(`Expected '${word}'`, this.peek().range);
	}

	private expectPunct(p: string): void {
		if (this.checkPunct(p)) {
			this.advance();
			return;
		}
		this.error(`Expected '${p}'`, this.peek().range);
	}

	private expectIdentifierLike(): string {
		const t = this.peek();
		if (t.kind === 'Identifier' || t.kind === 'Keyword') {
			this.advance();
			return t.text;
		}
		this.error(`Expected identifier, got '${t.text}'`, t.range);
		return '';
	}

	private error(message: string, range: Range): void {
		this.diagnostics.push({ message, range });
	}

	private skipStatementSeparators(): void {
		while (this.check('NewLine') || this.check('Colon')) {
			this.advance();
		}
	}

	// ---- statements -------------------------------------------------------

	/** Always returns a Stmt: an unrecognized token becomes an ErrorStatement after recovery. */
	private parseStatement(): Stmt {
		const stmt = this.parseStatementInner();
		if (stmt) {
			return stmt;
		}
		const start = this.peek().range.start;
		this.error(`Unexpected token '${this.peek().text}'`, this.peek().range);
		while (!this.isAtEnd() && !this.check('NewLine') && !this.check('Colon')) {
			this.advance();
		}
		return { kind: 'ErrorStatement', range: Range.create(start, this.previousEnd()) };
	}

	private parseStatementInner(): Stmt | undefined {
		const t = this.peek();

		if (t.kind === 'Identifier') {
			if (this.peekAt(1).kind === 'Colon') {
				const start = t.range.start;
				this.advance();
				this.advance();
				return { kind: 'LabelStmt', name: t.text, range: Range.create(start, this.previousEnd()) };
			}

			// Open/Close/Print/Write/Input/Line Input/Get/Put aren't reserved
			// keywords (so they stay available as ordinary identifiers
			// everywhere else — a real VBA project can and does have its own
			// Sub/variable named e.g. "Write"), but are recognized
			// contextually here when their shape unambiguously matches VBA's
			// file I/O statement forms.
			const upper = t.value.toUpperCase();
			if (upper === 'OPEN' && this.looksLikeOpenStatement()) {
				return this.parseOpenStatement();
			}
			if (upper === 'CLOSE' && this.looksLikeCloseStatement()) {
				return this.parseCloseStatement();
			}
			if (
				(upper === 'PRINT' || upper === 'WRITE' || upper === 'INPUT' || upper === 'GET' || upper === 'PUT') &&
				this.peekAt(1).kind === 'Punctuation' && this.peekAt(1).value === '#'
			) {
				return this.parseFileIOWithFileNumber(upper as 'PRINT' | 'WRITE' | 'INPUT' | 'GET' | 'PUT');
			}
			if (
				upper === 'LINE' &&
				this.peekAt(1).kind === 'Identifier' && this.peekAt(1).value.toUpperCase() === 'INPUT' &&
				this.peekAt(2).kind === 'Punctuation' && this.peekAt(2).value === '#'
			) {
				return this.parseLineInputStatement();
			}
			if (upper === 'NAME' && this.looksLikeNameStatement()) {
				return this.parseNameStatement();
			}

			return this.parseExpressionStatement();
		}

		if (t.kind === 'Punctuation' && (t.value === '.' || t.value === '!')) {
			return this.parseExpressionStatement();
		}

		if (t.kind === 'Punctuation' && t.value === '#') {
			return this.parseCompilerDirective();
		}

		if (t.kind !== 'Keyword') {
			return undefined;
		}

		switch (t.value) {
			case 'ATTRIBUTE': return this.parseAttribute();
			case 'OPTION': return this.parseOption();
			case 'DIM': case 'STATIC': return this.parseDim();
			case 'PUBLIC': case 'PRIVATE': case 'FRIEND': case 'GLOBAL': return this.parseAccessPrefixedDecl();
			case 'CONST': return this.parseConst();
			case 'TYPE': return this.parseTypeDecl();
			case 'ENUM': return this.parseEnumDecl();
			case 'DECLARE': return this.parseDeclare();
			case 'EVENT': return this.parseEvent();
			case 'IMPLEMENTS': return this.parseImplements();
			case 'WITHEVENTS':
				this.advance();
				return this.finishVarDecl('DIM', undefined, false, t.range.start, true);
			case 'SUB': case 'FUNCTION': case 'PROPERTY': return this.parseProcedure();
			case 'IF': return this.parseIf();
			case 'FOR': return this.parseFor();
			case 'DO': return this.parseDoLoop();
			case 'WHILE': return this.parseWhileWend();
			case 'SELECT': return this.parseSelectCase();
			case 'WITH': return this.parseWith();
			case 'ON': return this.parseOnError();
			case 'EXIT': return this.parseExit();
			case 'GOTO': return this.parseGoTo();
			case 'RESUME': return this.parseResume();
			case 'RAISEEVENT': return this.parseRaiseEvent();
			case 'REDIM': return this.parseReDim();
			case 'CALL': return this.parseCallStmt();
			case 'SET': case 'LET': return this.parseSetOrLet();
			default: return this.parseExpressionStatement();
		}
	}

	private parseBlockBody(stopKeywords: string[]): Stmt[] {
		const body: Stmt[] = [];
		for (;;) {
			this.skipStatementSeparators();
			if (this.isAtEnd() || this.currentIsKeyword(stopKeywords)) {
				break;
			}
			const before = this.pos;
			body.push(this.parseStatement());
			if (this.pos === before) {
				this.error(`Unexpected token '${this.peek().text}'`, this.peek().range);
				this.advance();
			}
		}
		return body;
	}

	private parseSimpleStatementList(): Stmt[] {
		const body: Stmt[] = [];
		// A leading (or doubled) colon is an empty statement — legal VBA,
		// most commonly seen right after a single-line `If cond Then:`.
		while (this.check('Colon')) {
			this.advance();
		}
		for (;;) {
			if (this.check('NewLine') || this.isAtEnd() || this.checkKeyword('ELSE')) {
				break;
			}
			const before = this.pos;
			body.push(this.parseStatement());
			if (this.pos === before) {
				this.advance();
			}
			if (this.check('Colon')) {
				while (this.check('Colon')) {
					this.advance();
				}
				continue;
			}
			break;
		}
		return body;
	}

	// A bare statement is ambiguous between "target = value" and "Call-less
	// call with arguments" until we've seen what follows the first
	// reference, and in both cases that reference must be parsed at the
	// postfix level (identifier/member/index chain only) — not through the
	// full expression grammar, whose relational level would otherwise
	// swallow a top-level '=' as an equality operator before the assignment
	// check below ever sees it.
	private parseExpressionStatement(): Stmt {
		const start = this.peek().range.start;
		// `allowSpacedCall: false` — a paren-less statement call whose first
		// argument is itself parenthesized (`MsgBox ("text"), vbExclamation,
		// "title"`) is extremely common real-world VBA. Real VBA
		// disambiguates this from true call syntax (`Foo(a, b)`) purely on
		// whether there's a space before the `(`; without that check here,
		// parsePostfix would greedily swallow `("text")` as a one-argument
		// call, leaving the target's kind as CallExpr (not Identifier) and
		// silently dropping every argument after the first comma.
		const target = this.parsePostfix({ allowSpacedCall: false });

		if (this.checkPunct('=')) {
			this.advance();
			const value = this.parseExpression();
			return { kind: 'AssignStmt', isSet: false, target, value, range: Range.create(start, this.previousEnd()) };
		}

		if (
			(target.kind === 'Identifier' || target.kind === 'MemberExpr' || target.kind === 'WithMemberExpr') &&
			this.looksLikeArgStart()
		) {
			const args = [this.parseArg()];
			while (this.checkPunct(',')) {
				this.advance();
				args.push(this.parseArg());
			}
			const expr: Expr = { kind: 'CallExpr', callee: target, args, range: Range.create(start, this.previousEnd()) };
			return { kind: 'CallStmt', expr, range: Range.create(start, this.previousEnd()) };
		}

		return { kind: 'CallStmt', expr: target, range: Range.create(start, this.previousEnd()) };
	}

	private looksLikeArgStart(): boolean {
		return !this.check('NewLine') && !this.check('Colon') && !this.isAtEnd() &&
			!this.currentIsKeyword(BLOCK_STOP_KEYWORDS);
	}

	private parseSetOrLet(): Stmt {
		const start = this.peek().range.start;
		const isSet = this.advance().value === 'SET';
		const target = this.parsePostfix();
		this.expectPunct('=');
		const value = this.parseExpression();
		return { kind: 'AssignStmt', isSet, target, value, range: Range.create(start, this.previousEnd()) };
	}

	private parseCallStmt(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // CALL
		const expr = this.parseExpression();
		return { kind: 'CallStmt', expr, range: Range.create(start, this.previousEnd()) };
	}

	private parseAttribute(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // ATTRIBUTE
		// Usually a bare module-level name (`VB_Name`), but the VB IDE also
		// exports per-member attributes as a dotted name (`ShortName.VB_
		// Description`, right after a Property/Sub/Function declaration).
		let name = this.expectIdentifierLike();
		while (this.checkPunct('.')) {
			this.advance();
			name += '.' + this.expectIdentifierLike();
		}
		this.expectPunct('=');
		const value = this.parseExpression();
		return { kind: 'AttributeStmt', name, value, range: Range.create(start, this.previousEnd()) };
	}

	private parseOption(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // OPTION
		let name = 'UNKNOWN';
		if (this.checkContextualWord('EXPLICIT')) {
			this.advance();
			name = 'EXPLICIT';
		} else if (this.checkContextualWord('BASE')) {
			this.advance();
			name = 'BASE';
			if (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
				this.advance();
			}
		} else if (this.checkContextualWord('COMPARE')) {
			this.advance();
			name = 'COMPARE';
			if (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
				this.advance();
			}
		} else {
			while (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
				this.advance();
			}
		}
		return { kind: 'OptionStmt', name, range: Range.create(start, this.previousEnd()) };
	}

	private parseDim(): Stmt {
		const start = this.peek().range.start;
		const declKeyword = this.advance().value; // DIM | STATIC
		return this.finishVarDecl(declKeyword, undefined, declKeyword === 'STATIC', start);
	}

	private finishVarDecl(
		declKeyword: string,
		access: string | undefined,
		isStatic: boolean,
		start: Position,
		withEvents = false
	): Stmt {
		const declarations = [this.parseOneVarDecl()];
		while (this.checkPunct(',')) {
			this.advance();
			declarations.push(this.parseOneVarDecl());
		}
		return {
			kind: 'DimStmt',
			declKeyword,
			access,
			isStatic,
			withEvents,
			declarations,
			range: Range.create(start, this.previousEnd())
		};
	}

	private parseOneVarDecl(): VarDecl {
		const start = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(start, this.previousEnd());
		let isArray = false;
		let bounds: ArrayBound[] | undefined;
		if (this.checkPunct('(')) {
			isArray = true;
			this.advance();
			bounds = [];
			if (!this.checkPunct(')')) {
				bounds.push(this.parseArrayBound());
				while (this.checkPunct(',')) {
					this.advance();
					bounds.push(this.parseArrayBound());
				}
			}
			this.expectPunct(')');
		}
		let type: string | undefined;
		if (this.checkKeyword('AS')) {
			this.advance();
			if (this.checkKeyword('NEW')) {
				this.advance();
			}
			type = this.parseTypeName();
		}
		return { name, nameRange, isArray, bounds, type, range: Range.create(start, this.previousEnd()) };
	}

	private parseArrayBound(): ArrayBound {
		const first = this.parseExpression();
		if (this.checkKeyword('TO')) {
			this.advance();
			const upper = this.parseExpression();
			return { lower: first, upper };
		}
		return { upper: first };
	}

	private parseTypeName(): string {
		let name = this.expectIdentifierLike();
		while (this.checkPunct('.')) {
			this.advance();
			name += '.' + this.expectIdentifierLike();
		}
		if (this.checkPunct('(')) {
			this.advance();
			this.expectPunct(')');
			name += '()';
		}
		return name;
	}

	private parseAccessPrefixedDecl(): Stmt {
		const start = this.peek().range.start;
		const access = this.advance().value;

		if (this.checkKeyword('STATIC')) {
			this.advance();
			const decl = this.parseProcedure(access, true);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('SUB') || this.checkKeyword('FUNCTION') || this.checkKeyword('PROPERTY')) {
			const decl = this.parseProcedure(access, false);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('CONST')) {
			const decl = this.parseConst(access);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('TYPE')) {
			const decl = this.parseTypeDecl(access);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('ENUM')) {
			const decl = this.parseEnumDecl(access);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('DECLARE')) {
			const decl = this.parseDeclare(access);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('EVENT')) {
			const decl = this.parseEvent(access);
			return { ...decl, range: Range.create(start, decl.range.end) } as Stmt;
		}
		if (this.checkKeyword('WITHEVENTS')) {
			this.advance();
			return this.finishVarDecl('DIM', access, false, start, true);
		}
		return this.finishVarDecl('DIM', access, false, start);
	}

	private parseConst(access?: string): Stmt {
		const start = this.peek().range.start;
		this.advance(); // CONST
		const declarations = [this.parseOneConstDecl()];
		while (this.checkPunct(',')) {
			this.advance();
			declarations.push(this.parseOneConstDecl());
		}
		return { kind: 'ConstStmt', access, declarations, range: Range.create(start, this.previousEnd()) };
	}

	private parseOneConstDecl(): ConstDecl {
		const start = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(start, this.previousEnd());
		let type: string | undefined;
		if (this.checkKeyword('AS')) {
			this.advance();
			type = this.parseTypeName();
		}
		this.expectPunct('=');
		const value = this.parseExpression();
		return { name, nameRange, type, value, range: Range.create(start, this.previousEnd()) };
	}

	private parseTypeDecl(access?: string): Stmt {
		const start = this.peek().range.start;
		this.advance(); // TYPE
		const nameStart = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(nameStart, this.previousEnd());
		this.skipStatementSeparators();
		const fields: VarDecl[] = [];
		while (!this.checkKeyword('END') && !this.isAtEnd()) {
			const before = this.pos;
			fields.push(this.parseOneVarDecl());
			this.skipStatementSeparators();
			if (this.pos === before) {
				// A token expectIdentifierLike() couldn't accept and nothing
				// else in this pass consumed either — force progress so an
				// unrecognized field never loops here forever.
				this.error(`Unexpected token '${this.peek().text}'`, this.peek().range);
				this.advance();
			}
		}
		this.expectKeyword('END');
		this.expectKeyword('TYPE');
		return { kind: 'TypeDecl', access, name, nameRange, fields, range: Range.create(start, this.previousEnd()) };
	}

	private parseEnumDecl(access?: string): Stmt {
		const start = this.peek().range.start;
		this.advance(); // ENUM
		const nameStart = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(nameStart, this.previousEnd());
		this.skipStatementSeparators();
		const members: EnumMember[] = [];
		while (!this.checkKeyword('END') && !this.isAtEnd()) {
			const before = this.pos;
			const mStart = this.peek().range.start;
			const mName = this.expectIdentifierLike();
			const mNameRange = Range.create(mStart, this.previousEnd());
			let value: Expr | undefined;
			if (this.checkPunct('=')) {
				this.advance();
				value = this.parseExpression();
			}
			members.push({ name: mName, nameRange: mNameRange, value, range: Range.create(mStart, this.previousEnd()) });
			this.skipStatementSeparators();
			if (this.pos === before) {
				this.error(`Unexpected token '${this.peek().text}'`, this.peek().range);
				this.advance();
			}
		}
		this.expectKeyword('END');
		this.expectKeyword('ENUM');
		return { kind: 'EnumDecl', access, name, nameRange, members, range: Range.create(start, this.previousEnd()) };
	}

	private parseDeclare(access?: string): Stmt {
		const start = this.peek().range.start;
		this.advance(); // DECLARE
		if (this.peek().kind === 'Identifier' && this.peek().value.toUpperCase() === 'PTRSAFE') {
			this.advance();
		}
		let procKind: 'SUB' | 'FUNCTION' = 'SUB';
		if (this.checkKeyword('SUB')) {
			this.advance();
		} else if (this.checkKeyword('FUNCTION')) {
			this.advance();
			procKind = 'FUNCTION';
		} else {
			this.error("Expected 'Sub' or 'Function'", this.peek().range);
		}
		const nameStart = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(nameStart, this.previousEnd());
		this.expectKeyword('LIB');
		const lib = this.check('String') ? this.advance().value : (this.error('Expected library name string', this.peek().range), '');
		let alias: string | undefined;
		if (this.checkKeyword('ALIAS')) {
			this.advance();
			alias = this.check('String') ? this.advance().value : (this.error('Expected alias string', this.peek().range), '');
		}
		const params = this.checkPunct('(') ? this.parseParamList() : [];
		let returnType: string | undefined;
		if (procKind === 'FUNCTION' && this.checkKeyword('AS')) {
			this.advance();
			returnType = this.parseTypeName();
		}
		return {
			kind: 'DeclareStmt', access, procKind, name, nameRange, lib, alias, params, returnType,
			range: Range.create(start, this.previousEnd())
		};
	}

	private parseEvent(access?: string): Stmt {
		const start = this.peek().range.start;
		this.advance(); // EVENT
		const name = this.expectIdentifierLike();
		const params = this.checkPunct('(') ? this.parseParamList() : [];
		return { kind: 'EventDecl', access, name, params, range: Range.create(start, this.previousEnd()) };
	}

	private parseImplements(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // IMPLEMENTS
		const typeName = this.parseTypeName();
		return { kind: 'ImplementsStmt', typeName, range: Range.create(start, this.previousEnd()) };
	}

	private parseParamList(): Param[] {
		this.expectPunct('(');
		const params: Param[] = [];
		if (!this.checkPunct(')')) {
			params.push(this.parseOneParam());
			while (this.checkPunct(',')) {
				this.advance();
				params.push(this.parseOneParam());
			}
		}
		this.expectPunct(')');
		return params;
	}

	private parseOneParam(): Param {
		const start = this.peek().range.start;
		let isOptional = false;
		let isParamArray = false;
		let byRef = true;
		if (this.checkKeyword('OPTIONAL')) {
			this.advance();
			isOptional = true;
		}
		if (this.checkKeyword('PARAMARRAY')) {
			this.advance();
			isParamArray = true;
		}
		if (this.checkKeyword('BYVAL')) {
			this.advance();
			byRef = false;
		} else if (this.checkKeyword('BYREF')) {
			this.advance();
			byRef = true;
		}
		const nameStart = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(nameStart, this.previousEnd());
		let isArray = false;
		if (this.checkPunct('(')) {
			this.advance();
			this.expectPunct(')');
			isArray = true;
		}
		let type: string | undefined;
		if (this.checkKeyword('AS')) {
			this.advance();
			type = this.parseTypeName();
		}
		let defaultValue: Expr | undefined;
		if (this.checkPunct('=')) {
			this.advance();
			defaultValue = this.parseExpression();
		}
		return {
			name, nameRange, byRef, isOptional, isParamArray, isArray, type, defaultValue,
			range: Range.create(start, this.previousEnd())
		};
	}

	private parseProcedure(access?: string, isStatic = false): Stmt {
		const start = this.peek().range.start;
		const procKind = this.advance().value as 'SUB' | 'FUNCTION' | 'PROPERTY';
		let propertyKind: 'GET' | 'LET' | 'SET' | undefined;
		if (procKind === 'PROPERTY' && (this.checkKeyword('GET') || this.checkKeyword('LET') || this.checkKeyword('SET'))) {
			propertyKind = this.advance().value as 'GET' | 'LET' | 'SET';
		}
		const nameStart = this.peek().range.start;
		const name = this.expectIdentifierLike();
		const nameRange = Range.create(nameStart, this.previousEnd());
		const params = this.checkPunct('(') ? this.parseParamList() : [];
		let returnType: string | undefined;
		if (this.checkKeyword('AS')) {
			this.advance();
			returnType = this.parseTypeName();
		}
		this.skipStatementSeparators();
		const body = this.parseProcedureBody(name);
		this.expectKeyword('END');
		if (this.checkKeyword('SUB') || this.checkKeyword('FUNCTION') || this.checkKeyword('PROPERTY')) {
			this.advance();
		}
		return {
			kind: 'ProcedureDecl', procKind, propertyKind, access, isStatic, name, nameRange, params, returnType, body,
			range: Range.create(start, this.previousEnd())
		};
	}

	/**
	 * Like parseBlockBody(['END']), but also recognizes the early/late-
	 * binding idiom: `#If X Then \n Function Foo() As A \n <maybe some
	 * body> \n #Else \n Function Foo() As B \n #End If \n <shared body> \n
	 * End Function` — each #If branch re-declares this SAME procedure's
	 * *header* with a different signature, and the real body is shared,
	 * living once after #End If (unlike the equally common case of each
	 * branch holding a complete, self-contained procedure — header, body,
	 * and its own End — which the compiler-directive no-op in
	 * parseStatementInner already handles fine by just flattening both
	 * branches through as sequential declarations of the same name).
	 * Detected structurally at each `#Else`/`#ElseIf` encountered while
	 * parsing this procedure's body: does the line right after it start
	 * another Sub/Function/Property declaration named `name`? If so, that
	 * alternate header (and everything up to the matching `#End If`) is
	 * redundant — we already parsed the header actually in effect for this
	 * call — so it's skipped as raw tokens rather than parsed as a
	 * (nonsensical) nested declaration.
	 */
	private parseProcedureBody(name: string): Stmt[] {
		const upperName = name.toUpperCase();
		const body: Stmt[] = [];
		for (;;) {
			this.skipStatementSeparators();
			if (this.isAtEnd() || this.currentIsKeyword(['END'])) {
				break;
			}
			if (this.checkDirectiveWord('ELSEIF', 'ELSE') && this.looksLikeAlternateHeaderAfterDirective(upperName)) {
				this.skipToMatchingEndIf();
				continue;
			}
			const before = this.pos;
			body.push(this.parseStatement());
			if (this.pos === before) {
				this.error(`Unexpected token '${this.peek().text}'`, this.peek().range);
				this.advance();
			}
		}
		return body;
	}

	/** True if the current token is `#` followed by a Keyword matching one of `words` — e.g. checkDirectiveWord('ELSE') matches `#Else`. */
	private checkDirectiveWord(...words: string[]): boolean {
		if (!this.checkPunct('#')) {
			return false;
		}
		const next = this.peekAt(1);
		return next.kind === 'Keyword' && words.includes(next.value);
	}

	private static readonly ACCESS_WORDS = ['PUBLIC', 'PRIVATE', 'FRIEND', 'GLOBAL', 'STATIC'];
	private static readonly PROC_KIND_WORDS = ['SUB', 'FUNCTION', 'PROPERTY'];

	/** Pure lookahead (no consumption): does the logical line right after the `#Else`/`#ElseIf` under the cursor start a Sub/Function/Property declaration named `expectedUpperName`? */
	private looksLikeAlternateHeaderAfterDirective(expectedUpperName: string): boolean {
		let i = 1; // skip past '#'
		while (this.peekAt(i).kind !== 'NewLine' && this.peekAt(i).kind !== 'EOF') {
			i++;
		}
		i++; // past the NewLine, onto the next logical line
		while (Parser.ACCESS_WORDS.includes(this.peekAt(i).value) && this.peekAt(i).kind === 'Keyword') {
			i++;
		}
		const kindTok = this.peekAt(i);
		if (kindTok.kind !== 'Keyword' || !Parser.PROC_KIND_WORDS.includes(kindTok.value)) {
			return false;
		}
		i++;
		if (this.peekAt(i).kind === 'Keyword' && ['GET', 'LET', 'SET'].includes(this.peekAt(i).value)) {
			i++;
		}
		const nameTok = this.peekAt(i);
		return (nameTok.kind === 'Identifier' || nameTok.kind === 'Keyword') && nameTok.text.toUpperCase() === expectedUpperName;
	}

	/** Skips raw tokens up to and including a `#End If` at the same nesting depth as the `#Else`/`#ElseIf`/`#End If` the caller just found (depth 0 = that one) — see parseProcedureBody's use for why. */
	private skipToMatchingEndIf(): void {
		let depth = 0;
		while (!this.isAtEnd()) {
			if (this.checkDirectiveWord('IF')) {
				depth++;
			} else if (this.checkDirectiveWord('END') && this.peekAt(2).kind === 'Keyword' && this.peekAt(2).value === 'IF') {
				if (depth === 0) {
					this.advance(); // '#'
					this.advance(); // END
					this.advance(); // IF
					return;
				}
				depth--;
			}
			this.advance();
		}
	}

	private parseIf(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // IF
		const condition = this.parseExpression();
		this.expectKeyword('THEN');

		if (this.check('NewLine')) {
			this.skipStatementSeparators();
			const branches = [{ condition, body: this.parseBlockBody(['ELSEIF', 'ELSE', 'END']) }];
			while (this.checkKeyword('ELSEIF')) {
				this.advance();
				const cond2 = this.parseExpression();
				this.expectKeyword('THEN');
				this.skipStatementSeparators();
				branches.push({ condition: cond2, body: this.parseBlockBody(['ELSEIF', 'ELSE', 'END']) });
			}
			let elseBody: Stmt[] | undefined;
			if (this.checkKeyword('ELSE')) {
				this.advance();
				this.skipStatementSeparators();
				elseBody = this.parseBlockBody(['END']);
			}
			this.expectKeyword('END');
			this.expectKeyword('IF');
			return { kind: 'IfStmt', branches, elseBody, isSingleLine: false, range: Range.create(start, this.previousEnd()) };
		}

		const thenBody = this.parseSimpleStatementList();
		let elseBody: Stmt[] | undefined;
		if (this.checkKeyword('ELSE')) {
			this.advance();
			elseBody = this.parseSimpleStatementList();
		}
		return {
			kind: 'IfStmt',
			branches: [{ condition, body: thenBody }],
			elseBody,
			isSingleLine: true,
			range: Range.create(start, this.previousEnd())
		};
	}

	private parseFor(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // FOR

		if (this.checkKeyword('EACH')) {
			this.advance();
			const loopVar = this.parsePostfix();
			this.expectKeyword('IN');
			const collection = this.parseExpression();
			this.skipStatementSeparators();
			const body = this.parseBlockBody(['NEXT']);
			this.expectKeyword('NEXT');
			this.discardTrailingLoopVar();
			return { kind: 'ForEachStmt', loopVar, collection, body, range: Range.create(start, this.previousEnd()) };
		}

		const loopVar = this.parsePostfix();
		this.expectPunct('=');
		const from = this.parseExpression();
		this.expectKeyword('TO');
		const to = this.parseExpression();
		let step: Expr | undefined;
		if (this.checkKeyword('STEP')) {
			this.advance();
			step = this.parseExpression();
		}
		this.skipStatementSeparators();
		const body = this.parseBlockBody(['NEXT']);
		this.expectKeyword('NEXT');
		this.discardTrailingLoopVar();
		return { kind: 'ForStmt', loopVar, from, to, step, body, range: Range.create(start, this.previousEnd()) };
	}

	/** `Next i` / `Next i, j` — the trailing loop-variable name(s) are optional and not semantically load-bearing here. */
	private discardTrailingLoopVar(): void {
		while (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
			this.advance();
		}
	}

	private parseDoLoop(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // DO
		let conditionPosition: 'Top' | 'Bottom' | undefined;
		let conditionKind: 'While' | 'Until' | undefined;
		let condition: Expr | undefined;

		if (this.checkKeyword('WHILE') || this.checkKeyword('UNTIL')) {
			conditionPosition = 'Top';
			conditionKind = this.advance().value === 'WHILE' ? 'While' : 'Until';
			condition = this.parseExpression();
		}

		this.skipStatementSeparators();
		const body = this.parseBlockBody(['LOOP']);
		this.expectKeyword('LOOP');

		if (!conditionPosition && (this.checkKeyword('WHILE') || this.checkKeyword('UNTIL'))) {
			conditionPosition = 'Bottom';
			conditionKind = this.advance().value === 'WHILE' ? 'While' : 'Until';
			condition = this.parseExpression();
		}

		return {
			kind: 'DoLoopStmt', conditionPosition, conditionKind, condition, body,
			range: Range.create(start, this.previousEnd())
		};
	}

	/** Legacy `While ... Wend`, distinct from `Do While ... Loop`. */
	private parseWhileWend(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // WHILE
		const condition = this.parseExpression();
		this.skipStatementSeparators();
		const body = this.parseBlockBody(['WEND']);
		this.expectKeyword('WEND');
		return {
			kind: 'DoLoopStmt', conditionPosition: 'Top', conditionKind: 'While', condition, body,
			range: Range.create(start, this.previousEnd())
		};
	}

	private parseSelectCase(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // SELECT
		this.expectKeyword('CASE');
		const selector = this.parseExpression();
		this.skipStatementSeparators();

		const cases: CaseClause[] = [];
		while (this.checkKeyword('CASE')) {
			const caseStart = this.peek().range.start;
			this.advance();
			if (this.checkKeyword('ELSE')) {
				this.advance();
				this.skipStatementSeparators();
				const body = this.parseBlockBody(['CASE', 'END']);
				cases.push({ kind: 'CaseElse', body, range: Range.create(caseStart, this.previousEnd()) });
			} else {
				const tests = [this.parseCaseTest()];
				while (this.checkPunct(',')) {
					this.advance();
					tests.push(this.parseCaseTest());
				}
				this.skipStatementSeparators();
				const body = this.parseBlockBody(['CASE', 'END']);
				cases.push({ kind: 'Case', tests, body, range: Range.create(caseStart, this.previousEnd()) });
			}
		}
		this.expectKeyword('END');
		this.expectKeyword('SELECT');
		return { kind: 'SelectCaseStmt', selector, cases, range: Range.create(start, this.previousEnd()) };
	}

	private parseCaseTest(): CaseTest {
		if (this.checkKeyword('IS')) {
			this.advance();
			const op = this.parseComparisonOpToken();
			const expr = this.parseExpression();
			return { kind: 'Relational', op, expr };
		}
		const first = this.parseExpression();
		if (this.checkKeyword('TO')) {
			this.advance();
			const to = this.parseExpression();
			return { kind: 'Range', from: first, to };
		}
		return { kind: 'Value', expr: first };
	}

	private parseComparisonOpToken(): string {
		const t = this.peek();
		if (t.kind === 'Punctuation' && COMPARISON_OPS.includes(t.value)) {
			this.advance();
			return t.value;
		}
		this.error(`Expected comparison operator, got '${t.text}'`, t.range);
		return '=';
	}

	private parseWith(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // WITH
		const target = this.parseExpression();
		this.skipStatementSeparators();
		const body = this.parseBlockBody(['END']);
		this.expectKeyword('END');
		this.expectKeyword('WITH');
		return { kind: 'WithStmt', target, body, range: Range.create(start, this.previousEnd()) };
	}

	private parseOnError(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // ON
		this.expectKeyword('ERROR');
		if (this.checkKeyword('RESUME')) {
			this.advance();
			this.expectKeyword('NEXT');
			return { kind: 'OnErrorStmt', mode: 'ResumeNext', range: Range.create(start, this.previousEnd()) };
		}
		if (this.checkKeyword('GOTO')) {
			this.advance();
			if (this.check('Integer') && this.peek().value === '0') {
				this.advance();
				return { kind: 'OnErrorStmt', mode: 'GotoZero', range: Range.create(start, this.previousEnd()) };
			}
			const label = this.expectIdentifierLike();
			return { kind: 'OnErrorStmt', mode: 'GotoLabel', label, range: Range.create(start, this.previousEnd()) };
		}
		this.error("Expected 'Resume' or 'GoTo'", this.peek().range);
		return { kind: 'OnErrorStmt', mode: 'ResumeNext', range: Range.create(start, this.previousEnd()) };
	}

	private parseExit(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // EXIT
		const target = this.peek().kind === 'Keyword' ? this.advance().value : 'UNKNOWN';
		return { kind: 'ExitStmt', target, range: Range.create(start, this.previousEnd()) };
	}

	private parseGoTo(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // GOTO
		const label = this.check('Integer') ? this.advance().text : this.expectIdentifierLike();
		return { kind: 'GoToStmt', label, range: Range.create(start, this.previousEnd()) };
	}

	private parseResume(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // RESUME
		if (this.checkKeyword('NEXT')) {
			this.advance();
			return { kind: 'ResumeStmt', mode: 'Next', range: Range.create(start, this.previousEnd()) };
		}
		if (this.check('NewLine') || this.check('Colon') || this.isAtEnd()) {
			return { kind: 'ResumeStmt', mode: 'Bare', range: Range.create(start, this.previousEnd()) };
		}
		const label = this.expectIdentifierLike();
		return { kind: 'ResumeStmt', mode: 'Label', label, range: Range.create(start, this.previousEnd()) };
	}

	private parseRaiseEvent(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // RAISEEVENT
		const name = this.expectIdentifierLike();
		const args = this.checkPunct('(') ? this.parseArgList() : [];
		return { kind: 'RaiseEventStmt', name, args, range: Range.create(start, this.previousEnd()) };
	}

	private parseReDim(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // REDIM
		let preserve = false;
		if (this.checkKeyword('PRESERVE')) {
			this.advance();
			preserve = true;
		}
		const targets = [this.parseReDimTarget()];
		while (this.checkPunct(',')) {
			this.advance();
			targets.push(this.parseReDimTarget());
		}
		return { kind: 'ReDimStmt', preserve, targets, range: Range.create(start, this.previousEnd()) };
	}

	/**
	 * Parses `name(bounds)` (optionally `.member(bounds)`, optionally
	 * repeated — `ReDim` can resize a member array too) with the array
	 * bounds read via parseArrayBound, same as Dim, instead of through
	 * parsePostfix's generic call-args parsing: a bound's explicit lower
	 * form (`ReDim x(0 To 5)`) uses the `To` keyword, which isn't valid
	 * expression grammar and would otherwise abort argument parsing.
	 */
	private parseReDimTarget(): ReDimTarget {
		const start = this.peek().range.start;
		// The callee: an identifier/member chain, deliberately not through
		// parsePostfix so it stops right before the bounds' '(' instead of
		// consuming it as a call.
		let target: Expr = this.parsePrimary();
		while (this.checkPunct('.') || this.checkPunct('!')) {
			this.advance();
			const nameStart = this.peek().range.start;
			const name = this.expectIdentifierLike();
			const nameRange = Range.create(nameStart, this.previousEnd());
			target = { kind: 'MemberExpr', target, name, nameRange, range: Range.create(target.range.start, this.previousEnd()) };
		}
		let bounds: ArrayBound[] | undefined;
		if (this.checkPunct('(')) {
			this.advance();
			bounds = [];
			if (!this.checkPunct(')')) {
				bounds.push(this.parseArrayBound());
				while (this.checkPunct(',')) {
					this.advance();
					bounds.push(this.parseArrayBound());
				}
			}
			this.expectPunct(')');
		}
		let type: string | undefined;
		if (this.checkKeyword('AS')) {
			this.advance();
			type = this.parseTypeName();
		}
		return { target, bounds, type, range: Range.create(start, this.previousEnd()) };
	}

	// ---- file I/O -----------------------------------------------------------

	/** True if a top-level `For` keyword appears before this logical line ends — distinguishes the Open statement from a user's own identically-named procedure/variable. */
	private looksLikeOpenStatement(): boolean {
		for (let i = 1; ; i++) {
			const t = this.peekAt(i);
			if (t.kind === 'NewLine' || t.kind === 'Colon' || t.kind === 'EOF') {
				return false;
			}
			if (t.kind === 'Keyword' && t.value === 'FOR') {
				return true;
			}
		}
	}

	/** Bare `Close` (closes every open file) or `Close #n[, #n...]` — anything else falls through to being treated as an ordinary identifier. */
	private looksLikeCloseStatement(): boolean {
		const next = this.peekAt(1);
		if (next.kind === 'NewLine' || next.kind === 'Colon' || next.kind === 'EOF') {
			return true;
		}
		return next.kind === 'Punctuation' && next.value === '#';
	}

	private parseOpenStatement(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // OPEN
		const exprs: Expr[] = [this.parseExpression()]; // path
		if (this.checkKeyword('FOR')) {
			this.advance();
			// Mode (Input/Output/Append/Random/Binary) plus optional Access/
			// Lock clauses are all just bare words here — none of them are
			// expressions worth tracking, so skip to `As` generically rather
			// than modeling each sub-clause.
			while (!this.checkKeyword('AS') && !this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
				this.advance();
			}
		}
		if (this.checkKeyword('AS')) {
			this.advance();
			exprs.push(this.parseFileNumber());
		}
		if (this.peek().kind === 'Identifier' && this.peek().value.toUpperCase() === 'LEN') {
			this.advance();
			if (this.checkPunct('=')) {
				this.advance();
			}
			exprs.push(this.parseExpression());
		}
		return { kind: 'FileIOStmt', op: 'OPEN', exprs, range: Range.create(start, this.previousEnd()) };
	}

	/** True if a top-level `As` keyword appears before this logical line ends — distinguishes the `Name oldpath As newpath` statement (renames/moves a file) from a user's own identically-named procedure/variable. */
	private looksLikeNameStatement(): boolean {
		for (let i = 1; ; i++) {
			const t = this.peekAt(i);
			if (t.kind === 'NewLine' || t.kind === 'Colon' || t.kind === 'EOF') {
				return false;
			}
			if (t.kind === 'Keyword' && t.value === 'AS') {
				return true;
			}
		}
	}

	private parseNameStatement(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // NAME
		const exprs: Expr[] = [this.parseExpression()]; // old path
		this.expectKeyword('AS');
		exprs.push(this.parseExpression()); // new path
		return { kind: 'FileIOStmt', op: 'NAME', exprs, range: Range.create(start, this.previousEnd()) };
	}

	private parseCloseStatement(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // CLOSE
		const exprs: Expr[] = [];
		if (!this.check('NewLine') && !this.check('Colon') && !this.isAtEnd()) {
			exprs.push(this.parseFileNumber());
			while (this.checkPunct(',')) {
				this.advance();
				exprs.push(this.parseFileNumber());
			}
		}
		return { kind: 'FileIOStmt', op: 'CLOSE', exprs, range: Range.create(start, this.previousEnd()) };
	}

	private parseFileIOWithFileNumber(op: 'PRINT' | 'WRITE' | 'INPUT' | 'GET' | 'PUT'): Stmt {
		const start = this.peek().range.start;
		this.advance(); // PRINT | WRITE | INPUT | GET | PUT
		const exprs: Expr[] = [this.parseFileNumber()];
		while (this.checkPunct(',') || this.checkPunct(';')) {
			this.advance();
			if (this.checkPunct(',') || this.checkPunct(';') || this.check('NewLine') || this.check('Colon') || this.isAtEnd()) {
				continue; // omitted argument, e.g. `Get #1, , var`
			}
			exprs.push(this.parseExpression());
		}
		return { kind: 'FileIOStmt', op, exprs, range: Range.create(start, this.previousEnd()) };
	}

	private parseLineInputStatement(): Stmt {
		const start = this.peek().range.start;
		this.advance(); // LINE
		this.advance(); // INPUT
		const exprs: Expr[] = [this.parseFileNumber()];
		if (this.checkPunct(',')) {
			this.advance();
			exprs.push(this.parseExpression());
		}
		return { kind: 'FileIOStmt', op: 'LINE_INPUT', exprs, range: Range.create(start, this.previousEnd()) };
	}

	/** An optional leading `#` (VBA allows `As #1` / `As 1` and `Close #1` / `Close 1` interchangeably) followed by the file-number expression. */
	private parseFileNumber(): Expr {
		if (this.checkPunct('#')) {
			this.advance();
		}
		return this.parseExpression();
	}

	// ---- expressions --------------------------------------------------------
	// Precedence climbing, lowest to highest: Imp, Eqv, Xor, Or, And, Not,
	// relational, concat (&), additive, Mod, integer-div (\), mul/div, unary
	// -/+, exponent (^, right-assoc), postfix (. and calls/indexing), primary.

	private parseExpression(): Expr {
		return this.parseImp();
	}

	private parseBinaryLevel(next: () => Expr, isOp: (t: Token) => boolean): Expr {
		let left = next();
		while (isOp(this.peek())) {
			const opTok = this.advance();
			const right = next();
			left = {
				kind: 'BinaryExpr',
				op: opTok.kind === 'Keyword' ? opTok.value : opTok.text,
				left,
				right,
				range: Range.create(left.range.start, this.previousEnd())
			};
		}
		return left;
	}

	private parseImp(): Expr {
		return this.parseBinaryLevel(() => this.parseEqv(), t => t.kind === 'Keyword' && t.value === 'IMP');
	}
	private parseEqv(): Expr {
		return this.parseBinaryLevel(() => this.parseXor(), t => t.kind === 'Keyword' && t.value === 'EQV');
	}
	private parseXor(): Expr {
		return this.parseBinaryLevel(() => this.parseOr(), t => t.kind === 'Keyword' && t.value === 'XOR');
	}
	private parseOr(): Expr {
		return this.parseBinaryLevel(() => this.parseAnd(), t => t.kind === 'Keyword' && t.value === 'OR');
	}
	private parseAnd(): Expr {
		return this.parseBinaryLevel(() => this.parseNot(), t => t.kind === 'Keyword' && t.value === 'AND');
	}

	private parseNot(): Expr {
		if (this.checkKeyword('NOT')) {
			const t = this.advance();
			const operand = this.parseNot();
			return { kind: 'UnaryExpr', op: 'NOT', operand, range: Range.create(t.range.start, this.previousEnd()) };
		}
		return this.parseRelational();
	}

	private parseRelational(): Expr {
		return this.parseBinaryLevel(
			() => this.parseConcat(),
			t => (t.kind === 'Punctuation' && COMPARISON_OPS.includes(t.value)) ||
				(t.kind === 'Keyword' && (t.value === 'LIKE' || t.value === 'IS'))
		);
	}
	private parseConcat(): Expr {
		return this.parseBinaryLevel(() => this.parseAdditive(), t => t.kind === 'Punctuation' && t.value === '&');
	}
	private parseAdditive(): Expr {
		return this.parseBinaryLevel(
			() => this.parseModLevel(),
			t => t.kind === 'Punctuation' && (t.value === '+' || t.value === '-')
		);
	}
	private parseModLevel(): Expr {
		return this.parseBinaryLevel(() => this.parseIntDiv(), t => t.kind === 'Keyword' && t.value === 'MOD');
	}
	private parseIntDiv(): Expr {
		return this.parseBinaryLevel(() => this.parseMul(), t => t.kind === 'Punctuation' && t.value === '\\');
	}
	private parseMul(): Expr {
		return this.parseBinaryLevel(
			() => this.parseUnaryMinus(),
			t => t.kind === 'Punctuation' && (t.value === '*' || t.value === '/')
		);
	}

	private parseUnaryMinus(): Expr {
		if (this.checkPunct('-') || this.checkPunct('+')) {
			const t = this.advance();
			const operand = this.parseUnaryMinus();
			return { kind: 'UnaryExpr', op: t.value, operand, range: Range.create(t.range.start, this.previousEnd()) };
		}
		// `Not` also recognized here, tightly binding like unary minus, not
		// just up at parseNot's own (looser, real-VBA-spec) precedence tier
		// between And and comparisons. That tier alone only ever fires for
		// a *freshly started* expression (an `If`/`And`/statement-initial
		// parse always descends through parseNot first) — it can never be
		// reached for `Not` appearing as an *operand* of a tighter operator
		// partway through precedence climbing, e.g. the extremely common
		// `"label: " & Not (x Is Nothing)`, where by the time concatenation
		// parses its right operand, recursion is already down at this
		// level and would otherwise never see `Not` as valid at all.
		if (this.checkKeyword('NOT')) {
			const t = this.advance();
			const operand = this.parseUnaryMinus();
			return { kind: 'UnaryExpr', op: 'NOT', operand, range: Range.create(t.range.start, this.previousEnd()) };
		}
		return this.parseExponent();
	}

	private parseExponent(): Expr {
		const left = this.parsePostfix();
		if (this.checkPunct('^')) {
			this.advance();
			const right = this.parseExponent(); // right-associative
			return { kind: 'BinaryExpr', op: '^', left, right, range: Range.create(left.range.start, this.previousEnd()) };
		}
		return left;
	}

	/**
	 * `allowSpacedCall: false` (only passed from parseExpressionStatement's
	 * statement-initial target) refuses to consume a `(` preceded by
	 * whitespace as call-args syntax — see that call site for why.
	 * Everywhere else (general expression parsing, nested arguments,
	 * assignment targets) a space before `(` is just style and always means
	 * a real call/index, so the default stays permissive.
	 */
	private parsePostfix(opts: { allowSpacedCall?: boolean } = {}): Expr {
		const allowSpacedCall = opts.allowSpacedCall ?? true;
		let expr = this.parsePrimary();
		for (;;) {
			// `.` and `!` (VBA's "bang" notation, e.g. `rst!FieldName` on a
			// DAO/ADO Recordset) are both member access syntactically — same
			// AST node either way, since nothing downstream (resolution,
			// hover, references) needs to tell them apart. Same spacing
			// caveat as the '(' case below: a *space* before '.'/'!' at
			// statement-initial position means "start of the next
			// paren-less argument" (very often a bare `.Member` implicitly
			// off the enclosing With target, e.g. `flight.PutNavyList
			// .Range(...), other:=x`), not "continue this member chain".
			if ((this.checkPunct('.') || this.checkPunct('!')) && (allowSpacedCall || !this.peek().spaceBefore)) {
				this.advance();
				const nameStart = this.peek().range.start;
				const name = this.expectIdentifierLike();
				const nameRange = Range.create(nameStart, this.previousEnd());
				expr = { kind: 'MemberExpr', target: expr, name, nameRange, range: Range.create(expr.range.start, this.previousEnd()) };
				continue;
			}
			if (this.checkPunct('(') && (allowSpacedCall || !this.peek().spaceBefore)) {
				const args = this.parseArgList();
				expr = { kind: 'CallExpr', callee: expr, args, range: Range.create(expr.range.start, this.previousEnd()) };
				continue;
			}
			break;
		}
		return expr;
	}

	private parseArgList(): Expr[] {
		this.expectPunct('(');
		const args: Expr[] = [];
		if (!this.checkPunct(')')) {
			args.push(this.parseArg());
			while (this.checkPunct(',')) {
				this.advance();
				args.push(this.parseArg());
			}
		}
		this.expectPunct(')');
		return args;
	}

	private parseArg(): Expr {
		if (this.checkPunct(',') || this.checkPunct(')')) {
			return { kind: 'OmittedArgExpr', range: this.peek().range };
		}
		const start = this.peek().range.start;
		// The argument-name side of `name:=value` is a plain label, not a
		// general identifier reference — real Office APIs commonly have
		// parameters named after reserved words (`.Add Type:=msoControlPopup`
		// on CommandBarControls), so a Keyword token is accepted here too.
		if ((this.peek().kind === 'Identifier' || this.peek().kind === 'Keyword') && this.peekAt(1).kind === 'Colon' &&
			this.peekAt(2).kind === 'Punctuation' && this.peekAt(2).value === '=') {
			const name = this.advance().text;
			this.advance(); // colon
			this.advance(); // equals
			const value = this.parseExpression();
			return { kind: 'NamedArgExpr', name, value, range: Range.create(start, this.previousEnd()) };
		}
		return this.parseExpression();
	}

	private parsePrimary(): Expr {
		const t = this.peek();

		if (t.kind === 'Punctuation' && t.value === '(') {
			this.advance();
			const inner = this.parseExpression();
			this.expectPunct(')');
			return { ...inner, range: Range.create(t.range.start, this.previousEnd()) } as Expr;
		}
		if (t.kind === 'Punctuation' && (t.value === '.' || t.value === '!')) {
			this.advance();
			const nameStart = this.peek().range.start;
			const name = this.expectIdentifierLike();
			const nameRange = Range.create(nameStart, this.previousEnd());
			return { kind: 'WithMemberExpr', name, nameRange, range: Range.create(t.range.start, this.previousEnd()) };
		}
		if (t.kind === 'Keyword' && t.value === 'NEW') {
			this.advance();
			const typeName = this.parseTypeName();
			return { kind: 'NewExpr', typeName, range: Range.create(t.range.start, this.previousEnd()) };
		}
		if (t.kind === 'Keyword' && t.value === 'NOTHING') {
			this.advance();
			return { kind: 'Literal', literalKind: 'Nothing', value: 'Nothing', range: t.range };
		}
		if (t.kind === 'Keyword' && (t.value === 'TRUE' || t.value === 'FALSE')) {
			this.advance();
			return { kind: 'Literal', literalKind: 'Boolean', value: t.value, range: t.range };
		}
		if (t.kind === 'String' || t.kind === 'Integer' || t.kind === 'Float' || t.kind === 'Date') {
			this.advance();
			return { kind: 'Literal', literalKind: t.kind, value: t.value, range: t.range };
		}
		if (t.kind === 'Identifier') {
			this.advance();
			return { kind: 'Identifier', name: t.text, range: t.range };
		}

		this.error(`Unexpected token '${t.text}' in expression`, t.range);
		if (t.kind !== 'EOF') {
			this.advance();
		}
		return { kind: 'ErrorExpr', range: t.range };
	}
}
