import * as assert from 'assert';
import { tokenize } from '../lexer/lexer';
import { Token } from '../lexer/tokens';

function kinds(tokens: Token[]): string[] {
	return tokens.map(t => t.kind);
}

function nonTrivia(tokens: Token[]): Token[] {
	return tokens.filter(t => t.kind !== 'EOF');
}

suite('Lexer', () => {
	test('recognizes keywords case-insensitively while preserving source casing', () => {
		const tokens = nonTrivia(tokenize('function sub'));
		assert.strictEqual(tokens[0].kind, 'Keyword');
		assert.strictEqual(tokens[0].value, 'FUNCTION');
		assert.strictEqual(tokens[0].text, 'function');
		assert.strictEqual(tokens[1].value, 'SUB');
	});

	test('does not treat keywords appearing mid-identifier as keywords', () => {
		const tokens = nonTrivia(tokenize('DimValue'));
		assert.strictEqual(tokens.length, 1);
		assert.strictEqual(tokens[0].kind, 'Identifier');
		assert.strictEqual(tokens[0].text, 'DimValue');
	});

	test('joins a line-continuation into one logical line with correct positions', () => {
		const tokens = nonTrivia(tokenize('Dim x As _\n    Integer'));
		// No NewLine token should appear across the continuation.
		assert.ok(!kinds(tokens).includes('NewLine'));
		const integerTok = tokens[tokens.length - 1];
		assert.strictEqual(integerTok.text, 'Integer');
		assert.strictEqual(integerTok.range.start.line, 1);
	});

	test('does not treat a trailing underscore with no preceding space as continuation', () => {
		// "foo_" is a legal identifier; the newline after it is real.
		const tokens = nonTrivia(tokenize('foo_\nbar'));
		assert.strictEqual(tokens[0].text, 'foo_');
		assert.strictEqual(tokens[1].kind, 'NewLine');
		assert.strictEqual(tokens[2].text, 'bar');
	});

	test('treats colon as a distinct separator from newline', () => {
		const tokens = nonTrivia(tokenize('a: b'));
		assert.deepStrictEqual(kinds(tokens), ['Identifier', 'Colon', 'Identifier']);
	});

	test("consumes a ' comment to end of physical line only", () => {
		const tokens = nonTrivia(tokenize("x = 1 ' comment _\ny = 2"));
		const texts = tokens.map(t => t.text);
		assert.ok(!texts.includes('comment'));
		// the continuation-looking underscore inside the comment must not join lines
		assert.ok(kinds(tokens).includes('NewLine'));
		assert.ok(texts.includes('y'));
	});

	test('treats Rem as a comment only at the start of a statement', () => {
		const remAtStart = nonTrivia(tokenize('Rem this is a comment\nx = 1'));
		const identifiersAndKeywords = remAtStart.filter(t => t.kind === 'Identifier' || t.kind === 'Keyword');
		assert.strictEqual(identifiersAndKeywords[0].text, 'x');

		const remAsIdentifier = nonTrivia(tokenize('x = Rem'));
		const texts = remAsIdentifier.map(t => t.text);
		assert.ok(texts.includes('Rem'));
	});

	test('captures Attribute VB_Name lines as ordinary tokens', () => {
		const tokens = nonTrivia(tokenize('Attribute VB_Name = "Module1"'));
		assert.deepStrictEqual(kinds(tokens), ['Keyword', 'Identifier', 'Punctuation', 'String']);
		assert.strictEqual(tokens[1].text, 'VB_Name');
		assert.strictEqual(tokens[3].value, 'Module1');
	});

	test('parses string literals with doubled-quote escaping', () => {
		const tokens = nonTrivia(tokenize('x = "say ""hi"""'));
		const str = tokens.find(t => t.kind === 'String')!;
		assert.strictEqual(str.value, 'say "hi"');
	});

	test('parses hex, octal, float, and suffixed numeric literals', () => {
		const tokens = nonTrivia(tokenize('&HFF &O17 3.14 100&'));
		assert.strictEqual(tokens[0].kind, 'Integer');
		assert.strictEqual(tokens[0].text, '&HFF');
		assert.strictEqual(tokens[1].kind, 'Integer');
		assert.strictEqual(tokens[1].text, '&O17');
		assert.strictEqual(tokens[2].kind, 'Float');
		assert.strictEqual(tokens[3].kind, 'Integer');
		assert.strictEqual(tokens[3].text, '100&');
	});

	test('parses date literals', () => {
		const tokens = nonTrivia(tokenize('x = #1/1/2020#'));
		const date = tokens.find(t => t.kind === 'Date')!;
		assert.strictEqual(date.value, '1/1/2020');
	});

	test('parses [Name] bracket-escaped identifiers, discarding the brackets', () => {
		const tokens = nonTrivia(tokenize('[_First]'));
		assert.strictEqual(tokens.length, 1);
		assert.strictEqual(tokens[0].kind, 'Identifier');
		assert.strictEqual(tokens[0].text, '_First');
		assert.strictEqual(tokens[0].value, '_First');
	});

	test('emits an EOF token even for empty input', () => {
		const tokens = tokenize('');
		assert.strictEqual(tokens.length, 1);
		assert.strictEqual(tokens[0].kind, 'EOF');
	});
});
