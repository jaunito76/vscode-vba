import { Position, Range } from 'vscode-languageserver/node';
import { KEYWORDS, Token, TokenKind } from './tokens';

const NUMBER_SUFFIX = new Set(['%', '&', '!', '#', '@']);
/** Legacy BASIC type-declaration characters valid directly after an identifier (`Environ$`, `x%`, `y#`). Excludes `!` — see scanIdentifierOrKeyword. */
const IDENT_SUFFIX = new Set(['$', '%', '&', '#', '@']);
const TWO_CHAR_OPS = ['<=', '>=', '<>'];

/**
 * Hand-rolled, single-pass, linear-time tokenizer for VBA source text.
 *
 * Line continuation (a trailing " _") and comments are consumed as trivia
 * during scanning rather than in a pre-processing pass, so every emitted
 * token still carries an accurate (line, character) position and "logical
 * lines" fall out naturally without a second coordinate-mapping layer.
 */
export class Lexer {
	private readonly text: string;
	private pos = 0;
	private line = 0;
	private character = 0;
	private atStatementStart = true;
	private pendingSpaceBefore = false;
	private readonly tokens: Token[] = [];

	constructor(text: string) {
		this.text = text;
	}

	tokenize(): Token[] {
		for (;;) {
			this.pendingSpaceBefore = this.skipTrivia();

			if (this.isAtEnd()) {
				this.pushRange('EOF', '', '', this.currentPos(), this.currentPos());
				break;
			}

			const ch = this.peekChar();

			if (ch === '\r' || ch === '\n') {
				const start = this.currentPos();
				this.consumeNewlineSequence();
				this.pushRange('NewLine', '\n', '\n', start, this.currentPos());
				this.atStatementStart = true;
				continue;
			}

			if (ch === ':') {
				const start = this.currentPos();
				this.advanceChar();
				this.pushRange('Colon', ':', ':', start, this.currentPos());
				this.atStatementStart = true;
				continue;
			}

			if (ch === '\'') {
				this.advanceChar();
				this.skipToEndOfLine();
				continue;
			}

			if (ch === '"') {
				this.scanString();
				this.atStatementStart = false;
				continue;
			}

			if (ch === '#' && this.tryScanDate()) {
				this.atStatementStart = false;
				continue;
			}

			if (
				this.isDigit(ch) ||
				(ch === '.' && this.isDigit(this.peekChar(1))) ||
				(ch === '&' && /[HhOo]/.test(this.peekChar(1)))
			) {
				this.scanNumber();
				this.atStatementStart = false;
				continue;
			}

			if (this.isIdentStart(ch)) {
				this.scanIdentifierOrKeyword();
				continue;
			}

			if (ch === '[') {
				this.scanBracketedIdentifier();
				this.atStatementStart = false;
				continue;
			}

			this.scanPunctuation();
			this.atStatementStart = false;
		}

		return this.tokens;
	}

	/** Returns whether any inline space (or a line continuation, which is itself introduced by one) was consumed before the next token. */
	private skipTrivia(): boolean {
		let hadSpace = false;
		for (;;) {
			let sawSpace = false;
			while (!this.isAtEnd() && this.isInlineSpace(this.peekChar())) {
				this.advanceChar();
				sawSpace = true;
			}
			hadSpace = hadSpace || sawSpace;

			if (sawSpace && this.isLineContinuationUnderscore()) {
				this.advanceChar(); // '_'
				while (this.isInlineSpace(this.peekChar())) {
					this.advanceChar();
				}
				this.consumeNewlineSequence();
				continue;
			}

			break;
		}
		return hadSpace;
	}

	private isLineContinuationUnderscore(): boolean {
		if (this.peekChar() !== '_') {
			return false;
		}
		let offset = 1;
		while (this.isInlineSpace(this.peekChar(offset))) {
			offset++;
		}
		const next = this.peekChar(offset);
		return next === '' || next === '\r' || next === '\n';
	}

	private scanIdentifierOrKeyword(): void {
		const start = this.currentPos();
		const startOffset = this.pos;
		this.advanceChar();
		while (!this.isAtEnd() && this.isIdentPart(this.peekChar())) {
			this.advanceChar();
		}

		const text = this.text.slice(startOffset, this.pos);
		const upper = text.toUpperCase();

		if (upper === 'REM' && this.atStatementStart) {
			this.skipToEndOfLine();
			return;
		}

		// Legacy BASIC type-declaration suffix (`Environ$`, `Dim x%`) — part
		// of the source token but not the identifier's identity, so it's
		// consumed here without joining `text`/`value` (same treatment as
		// the brackets around a `[Name]` bracketed identifier below). `!` is
		// excluded from IDENT_SUFFIX and handled specially: it's ambiguous
		// with the bang member-access operator (`rst!field`), so it's only
		// swallowed as a suffix when NOT immediately followed by another
		// identifier.
		const suffix = this.peekChar();
		if (IDENT_SUFFIX.has(suffix) || (suffix === '!' && !this.isIdentStart(this.peekChar(1)))) {
			this.advanceChar();
		}

		const kind: TokenKind = KEYWORDS.has(upper) ? 'Keyword' : 'Identifier';
		this.pushRange(kind, text, kind === 'Keyword' ? upper : text, start, this.currentPos());
		this.atStatementStart = false;
	}

	/**
	 * `[Name]` — VBA's bracket-escaping for an identifier that wouldn't
	 * otherwise be legal (most commonly one starting with `_`, e.g. the
	 * `[_First]`/`[_Last]` sentinel pattern real-world enums use for
	 * iteration bounds). Semantically just an identifier: the brackets
	 * are discarded rather than kept as part of the name, so `[_First]`
	 * resolves identically to a plain `_First` reference elsewhere.
	 */
	private scanBracketedIdentifier(): void {
		const start = this.currentPos();
		this.advanceChar(); // '['
		let value = '';
		while (!this.isAtEnd() && this.peekChar() !== ']' && this.peekChar() !== '\r' && this.peekChar() !== '\n') {
			value += this.peekChar();
			this.advanceChar();
		}
		if (this.peekChar() === ']') {
			this.advanceChar();
		}
		this.pushRange('Identifier', value, value, start, this.currentPos());
	}

	private scanString(): void {
		const start = this.currentPos();
		const startOffset = this.pos;
		this.advanceChar(); // opening quote
		let value = '';

		while (!this.isAtEnd()) {
			const c = this.peekChar();
			if (c === '"') {
				if (this.peekChar(1) === '"') {
					value += '"';
					this.advanceChar();
					this.advanceChar();
					continue;
				}
				this.advanceChar(); // closing quote
				break;
			}
			if (c === '\r' || c === '\n') {
				break; // unterminated string: stop at end of line, best effort
			}
			value += c;
			this.advanceChar();
		}

		const text = this.text.slice(startOffset, this.pos);
		this.pushRange('String', text, value, start, this.currentPos());
	}

	/** Returns false (consuming nothing) if there is no closing '#' on this physical line. */
	private tryScanDate(): boolean {
		const startOffset = this.pos;
		let offset = 1;
		for (;;) {
			const c = this.peekChar(offset);
			if (c === '' || c === '\r' || c === '\n') {
				return false;
			}
			if (c === '#') {
				break;
			}
			offset++;
		}

		const start = this.currentPos();
		for (let i = 0; i <= offset; i++) {
			this.advanceChar();
		}
		const text = this.text.slice(startOffset, this.pos);
		this.pushRange('Date', text, text.slice(1, -1), start, this.currentPos());
		return true;
	}

	private scanNumber(): void {
		const start = this.currentPos();
		const startOffset = this.pos;

		const c1 = this.peekChar(1).toUpperCase();
		if (this.peekChar() === '&' && (c1 === 'H' || c1 === 'O')) {
			this.advanceChar();
			this.advanceChar();
			while (/[0-9A-Fa-f]/.test(this.peekChar())) {
				this.advanceChar();
			}
			this.consumeOptionalSuffix();
			const text = this.text.slice(startOffset, this.pos);
			this.pushRange('Integer', text, text, start, this.currentPos());
			return;
		}

		let isFloat = false;
		while (this.isDigit(this.peekChar())) {
			this.advanceChar();
		}
		if (this.peekChar() === '.' && this.isDigit(this.peekChar(1))) {
			isFloat = true;
			this.advanceChar();
			while (this.isDigit(this.peekChar())) {
				this.advanceChar();
			}
		}
		const expChar = this.peekChar();
		if (
			(expChar === 'E' || expChar === 'e') &&
			(this.isDigit(this.peekChar(1)) ||
				((this.peekChar(1) === '+' || this.peekChar(1) === '-') && this.isDigit(this.peekChar(2))))
		) {
			isFloat = true;
			this.advanceChar();
			if (this.peekChar() === '+' || this.peekChar() === '-') {
				this.advanceChar();
			}
			while (this.isDigit(this.peekChar())) {
				this.advanceChar();
			}
		}
		this.consumeOptionalSuffix();

		const text = this.text.slice(startOffset, this.pos);
		this.pushRange(isFloat ? 'Float' : 'Integer', text, text, start, this.currentPos());
	}

	private consumeOptionalSuffix(): void {
		if (NUMBER_SUFFIX.has(this.peekChar())) {
			this.advanceChar();
		}
	}

	private scanPunctuation(): void {
		const start = this.currentPos();
		const two = this.peekChar() + this.peekChar(1);
		if (TWO_CHAR_OPS.includes(two)) {
			this.advanceChar();
			this.advanceChar();
			this.pushRange('Punctuation', two, two, start, this.currentPos());
			return;
		}
		const c = this.peekChar();
		this.advanceChar();
		this.pushRange('Punctuation', c, c, start, this.currentPos());
	}

	private skipToEndOfLine(): void {
		while (!this.isAtEnd() && this.peekChar() !== '\r' && this.peekChar() !== '\n') {
			this.advanceChar();
		}
	}

	private consumeNewlineSequence(): void {
		if (this.peekChar() === '\r') {
			this.advanceChar();
		}
		if (this.peekChar() === '\n') {
			this.advanceChar();
		}
	}

	private pushRange(kind: TokenKind, text: string, value: string, start: Position, end: Position): void {
		this.tokens.push({ kind, text, value, range: Range.create(start, end), spaceBefore: this.pendingSpaceBefore });
		this.pendingSpaceBefore = false;
	}

	private currentPos(): Position {
		return Position.create(this.line, this.character);
	}

	private peekChar(offset = 0): string {
		return this.text[this.pos + offset] ?? '';
	}

	private advanceChar(): void {
		const c = this.text[this.pos++];
		if (c === '\n') {
			this.line++;
			this.character = 0;
		} else {
			this.character++;
		}
	}

	private isAtEnd(): boolean {
		return this.pos >= this.text.length;
	}

	private isInlineSpace(c: string): boolean {
		return c === ' ' || c === '\t';
	}

	private isDigit(c: string): boolean {
		return c >= '0' && c <= '9';
	}

	private isIdentStart(c: string): boolean {
		return /[A-Za-z]/.test(c);
	}

	private isIdentPart(c: string): boolean {
		return /[A-Za-z0-9_]/.test(c);
	}
}

export function tokenize(text: string): Token[] {
	return new Lexer(text).tokenize();
}
