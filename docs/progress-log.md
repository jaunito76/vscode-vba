# VBA Language Server — Progress Log

Tracks phase-by-phase status of the plan in `docs/vba-language-server-plan.md`.
User-facing changes still go in `CHANGELOG.md`; this file is for implementation
history — what shipped in each phase, and anything found along the way worth
remembering before the next phase builds on it.

## Phase 0 — Client/server plumbing — Done (2026-09-11)

- Split the extension into `client/` (VS Code extension host, `vscode-languageclient`)
  and `server/` (out-of-process language server, `vscode-languageserver`), built with
  npm workspaces + TS project references (`tsc -b`).
- Ported the existing regex-based document-symbol logic as-is behind the new LSP
  boundary, to prove the architecture before investing in a real parser.
- Bumped `engines.vscode` to `^1.91.0` (required by `vscode-languageclient` 10.x) and
  the surrounding TS/ESLint toolchain off its 2020-era pins.
- Verified end-to-end: `tsc -b`, `eslint`, `vsce package`, and an extension-host
  integration test that opens a fixture `.bas` file and asserts symbols round-trip
  through the live LSP connection.
- Found and fixed a packaging bug: npm workspaces symlinks `node_modules/vba-client`
  and `node_modules/vba-server` back into the repo, which crashed `vsce`'s zip step.
  Excluded both in `.vscodeignore`.

## Phase 1 — Lexer, parser, AST — Done (2026-09-11)

- Hand-rolled, single-pass tokenizer (`server/src/lexer/`) and recursive-descent
  parser (`server/src/parser/`) producing a plain discriminated-union AST, covering
  the full statement/expression grammar listed in the plan (Sub/Function/Property
  Get|Let|Set, both If forms, For/For Each, all four Do/Loop forms plus legacy
  While/Wend, Select Case, With, Dim/ReDim/Const/Type/Enum/Declare/Event/Implements,
  On Error/Resume/GoTo/Exit, full operator-precedence expressions).
- Panic-mode error recovery: an unexpected token becomes a diagnostic plus a skip to
  the next statement separator, so one malformed statement doesn't blank out the
  rest of the file.
- 27 fast unit tests (`mocha -r ts-node/register/transpile-only`, no `vscode-*`
  imports), including a deliberately malformed fixture and a generated
  2000-procedure fixture that parses in ~100ms — well under the debounce budget.
- **Not wired into any live feature yet** — `server/src/features/documentSymbols.ts`
  still runs Phase 0's regex logic. That's Phase 2.
- Two real bugs found and fixed while writing the tests, both worth knowing about
  if similar symptoms show up again:
  - The lexer's main dispatch loop never routed `&H`/`&O` hex/octal literals into
    `scanNumber()` — it only checked for a leading digit or `.`, so `&HFF` lexed as
    stray `&` punctuation plus an `HFF` identifier.
  - The parser's statement dispatcher parsed assignment targets through the full
    expression grammar. Its relational precedence level treats bare `=` as an
    equality operator, so it silently swallowed the `=` in `x = 1` as part of the
    "expression" before the assignment check ever ran — turning every assignment
    and every paren-less call (`MsgBox x`) into multiple dangling, disconnected
    statements. Fixed by parsing assignment/call targets at the postfix
    (identifier/member/index) level instead of the full expression grammar, and by
    adding explicit paren-less call-argument parsing.

## Phase 2 — Rewire Document Symbols + Signature Help onto the AST — Done (2026-09-11)

- `documentSymbols.ts` now walks `Module.body` for `ProcedureDecl` nodes instead of
  scanning lines with a regex; Property Get/Let/Set grouping falls out of the AST
  directly. Symbol ranges now span the whole procedure (declaration through its
  matching `End`), not just the declaration line — a real improvement for outline
  "reveal in editor" behavior, not just parity with Phase 0.
- Added `signatureHelp.ts`: resolves the call the cursor is inside by scanning
  tokens backward for the nearest unmatched `(`, then counts top-level commas
  forward to the cursor for the active parameter (correctly ignores commas inside
  nested parenthesized arguments). Signatures are re-derived per request from the
  real AST, same-document-only scope (a project-wide index is Phase 3).
- Added `format.ts` for signature/display-string formatting shared between both
  features (and reusable by Hover later).
- Registered `signatureHelpProvider` in `server.ts` and wired
  `connection.onSignatureHelp` — this fixes a dormant bug from before this
  rewrite even started: the original `VbaSignatureHelpProvider` was never
  actually registered in the shipped extension (a second, unused `activate()` in
  the old `documentSymbolProvider.ts` was the only place it was wired up), so
  signature help never worked at all pre-migration.
- Regression-checked against Phase 0: the extension-host integration test
  (`sample.bas` via `vscode.executeDocumentSymbolProvider`) still passes
  unchanged. Added 10 new fast unit tests (37 total, ~100ms).

## Phase 3 — Semantic layer: project-wide symbol index — Done (2026-09-11)

- `server/src/semantics/{symbols,moduleBinder,projectIndex}.ts`: `bindModule()`
  parses one module and extracts its local symbol table (procedures keyed by
  name with Get/Let/Set arrays for overloads, module vars, consts, types,
  enums — all keyed upper-case for case-insensitive lookup, original casing
  preserved on the declaration node for display). Also honors `Attribute
  VB_Name` as the module's true name, preferred over the file's base name.
- `ProjectIndex` implements the global-namespace rules explicitly: `.bas`
  Public members merge into one project-wide table (Private stays
  module-local, verified reachable from *within* its own module but not from
  others); `.cls` members never enter the global table, only reachable via
  `resolveMember(type, name)`; `.frm` gets the same treatment plus an
  implicit default-instance global named after the form (`UserForm1.Show`
  with no `Dim`/`New`, the extremely common real-world pattern).
- Member-access type resolution (`findDeclaredType`) walks an entire
  procedure body — not just its top level, since VBA has no block scoping —
  for the nearest `Dim`/parameter/`Set x = New` for a name. A typed `Dim`
  always wins; an untyped `Dim` followed later by `Set x = New Type` still
  resolves correctly rather than stopping at the first, type-less match.
  Deliberately narrow beyond that: no type inference, no default-member
  resolution, no `Implements` polymorphism — an unresolvable type/member
  yields nothing rather than guessing.
- Wired into `server.ts` and kept genuinely live: workspace-wide scan on
  `initialize` (`workspaceScanner.ts`, plain recursive `fs.readdirSync` — no
  VBA project-file equivalent exists, so "the project" is every
  `.bas`/`.cls`/`.frm` under the workspace folder), debounced (~300ms,
  "latest wins") re-index on open-document edits, and
  `connection.onDidChangeWatchedFiles` re-indexing files changed on disk
  while not open — the client registers the matching
  `createFileSystemWatcher('**/*.{bas,cls,frm}')` and hands it to the
  `LanguageClient` via `synchronize.fileEvents`.
- **Not yet consumed by any feature** — Document Symbols and Signature Help
  still work standalone per-document, unchanged. The index becomes load-
  bearing in Phase 4 (diagnostics/hover) and Phase 5 (definition/references).
- 15 new fast unit tests (52 total, ~130ms), all against small in-memory
  synthetic multi-module projects — no filesystem, no VS Code host. Found one
  test-authoring bug while writing them (not a product bug): a fixture wrote
  invalid VBA (`Private Dim x As Integer` — VBA never combines the two), which
  the parser's permissive-by-design grammar happily accepted as garbage
  instead of the intended declaration, silently corrupting the rest of that
  test's assertions.

## Phase 4 — Diagnostics (syntax + Option Explicit) + Hover — Not started
