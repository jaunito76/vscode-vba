# VBA Language Server — Implementation Plan

## Context

`vscode-vba` currently ships only a TextMate grammar, snippets, and one in-process,
regex-based `DocumentSymbolProvider`/`SignatureHelpProvider` (`src/documentSymbolProvider.ts`,
wired from `src/extension.ts`). There is no real parser, no cross-file awareness, and no
diagnostics — VBA projects are multi-module (`.bas`/`.cls`/`.frm`) and share a global
namespace across standard modules, which regex-per-line simply can't model. The goal is to
build this out into a proper VBA language server: a real client/server LSP architecture
(decided), starting with a real parser/AST foundation, then diagnostics + hover, then
go-to-definition + find-references, with completion deliberately deferred to a later
milestone. This plan also surfaces a couple of pre-existing bugs worth fixing along the way:
`VbaSignatureHelpProvider` is currently dead code (a second, unused `activate()` in
`documentSymbolProvider.ts` is the only place it's registered), and three abandoned
`old*_documentSymbolProvider.ts` experiment files sit untracked in `src/`.

## 1. Repo restructuring (client/server split)

Adopt the standard Microsoft `lsp-sample` layout:

```text
vscode-vba/
├── package.json          # STAYS the extension manifest (contributes.* unchanged);
│                          # main -> "./client/out/extension.js"; adds "workspaces":
│                          # ["client","server"]; compile/watch delegate to `tsc -b`.
├── tsconfig.json          # root solution file: references client/ + server/ only
├── vba.configuration.json, syntaxes/, snippets/, images/   # unchanged, stay at root
├── client/
│   ├── package.json        # vscode-languageclient, @vscode/test-electron, @vscode/test-cli
│   ├── tsconfig.json        # composite:true, no reference to server (IPC boundary, not TS)
│   └── src/
│       ├── extension.ts      # thin: builds + starts LanguageClient
│       └── test/              # migrated extension-host smoke tests (see §6)
└── server/
    ├── package.json        # vscode-languageserver, vscode-languageserver-textdocument, vscode-uri
    ├── tsconfig.json        # composite:true
    └── src/
        ├── server.ts          # connection + capability wiring
        ├── lexer/{tokens,lexer}.ts
        ├── parser/{ast,parser}.ts
        ├── semantics/{symbols,moduleBinder,projectIndex}.ts
        ├── features/{documentSymbols,signatureHelp,diagnostics,hover,definition,references}.ts
        └── test/              # fast unit tests, no vscode-* imports (see §6)
```

- Use npm workspaces at the root (one `npm install` hoists both subprojects).
- Build with TS project references (`tsc -b` / `tsc -b -w`), not two independent `tsc -p`
  calls — client and server are separate composite projects; client has no reference to
  server since they only talk over LSP transport at runtime, never via TS imports.
- No bundler for v1 (matches the existing simple tsc-only setup). Flag `esbuild` bundling of
  `client/out/extension.js` and `server/out/server.js` as a good fast-follow, not required now.
- Verify `vsce package` + install still works given npm-workspaces hoisting (deps land in
  root `node_modules`, which the spawned server process resolves through fine, but confirm
  with a real package+install test at the end of Phase 0 — easy way to ship something broken).
- Delete `src/old_documentSymbolProvider.ts`, `old2__documentSymbolProvider.ts`,
  `old3_documentSymbolProvider.ts` (untracked, superseded experiments) and, once ported,
  `src/documentSymbolProvider.ts` + `src/extension.ts` — the whole `src/` dir goes away.

## 2. Lexer / parser (the core engineering work)

**Hand-rolled recursive-descent lexer + parser**, not ANTLR. `grammars-v4`'s VBA/VB6
grammars are action-free — you'd still hand-write every AST-construction step yourself —
and this project's trickiest bits (line-continuation joining with accurate positions,
`Attribute VB_*` directive lines, custom error recovery) are lexer-level specifics a generic
grammar doesn't solve for free. Hand-rolled is also trivially unit-testable with no
generated-code build step.

**Lexer** (`server/src/lexer/`) scans raw text directly (no pre-joined buffer — a
continuation `_` at end-of-line is consumed as trivia during scanning so logical lines fall
out naturally while every token keeps accurate `(line, character)` positions). Must handle:
case-insensitive keyword matching (original casing preserved on the token for display);
`:` as a statement separator distinct from `NEWLINE`; `'`-comments to physical EOL;
contextual `Rem` (only a comment when first token of a statement); `Attribute VB_*` lines as
their own statement form (capture `VB_Name` — it's the module's true name, preferred over
the file's base name on mismatch); standard literals (strings, `&H`/`&O`, type suffixes,
`#date#`).

**Parser** (`server/src/parser/`): one `Module` root = ordered top-level items
(`Attribute`/`Option`/`Dim`/`Const`/`Type...End Type`/`Enum...End Enum`/`Declare`/`Event`/
`Implements`/`Sub`/`Function`/`Property Get|Let|Set`). Covers single-line vs. block `If`,
`For`/`For Each`, all four `Do...Loop` variants, `Select Case`, `With`, `On Error`,
`ReDim`/`Preserve`, `WithEvents`, `RaiseEvent`. Grammar accepts constructs permissively
regardless of nesting legality (e.g. `Dim` inside `Type`) — illegal placement becomes a
*semantic* diagnostic later, not a parse failure; this keeps error recovery simpler.

**Error recovery** (present from day one, not bolted on later): panic-mode — on an
unexpected token, emit a diagnostic at that token, skip to the next `NEWLINE`/`COLON`/
statement-starting keyword, wrap the skipped span as an `ErrorStatement` node, and resume.
Same idea at the declaration level so one broken `Sub` never blanks out symbols/diagnostics
for the rest of the file.

**AST**: plain TS discriminated unions (`{ kind: 'SubDecl'; ... }`), not classes — cheap to
build, easy to `switch` on, trivial to assert against in tests. Every node carries an
LSP-native 0-based `range` so no coordinate-translation layer is needed downstream.

## 3. Semantic layer: project-wide symbol index

`server/src/semantics/projectIndex.ts`:

- **Discovery**: on `initialize`, scan workspace folder(s) for `**/*.{bas,cls,frm}` (no
  project-file equivalent exists, so "the project" = all such files under the workspace).
- **Per-module data**: `{ uri, moduleType: standard|class|form (from extension),
  moduleName (VB_Name attribute if present, else file base name), ast, diagnostics,
  locals: { procedures, moduleVars, consts, types, enums } }` (map keys uppercase for
  case-insensitive lookup, with a preserved `declaredName` for display).
- **Global-namespace rules** (the VBA-specific nuance, made explicit rather than assumed):
  - `.bas`: default-visibility (`Public`) procs/module vars/consts merge into one
    project-wide global table; `Private` stays module-local.
  - `.cls`: members never enter the global table — reachable only via `.` member access off
    a variable whose declared type is that class.
  - `.frm`: same as `.cls`, **plus** VBA's default-instance behavior — inject one implicit
    global symbol per form, named after its `moduleName`, typed as that form (covers the
    very common `UserForm1.Show` pattern with no explicit `Dim`/`New`).
  - v1 explicitly does **not** model multi-instance class variables, `Implements`
    polymorphism, or default-member resolution — call this out as a documented limitation.
- **Member-access (`x.Foo`) resolution**, kept narrow on purpose: find `x`'s declared type
  via the nearest enclosing `Dim`/`Static`/parameter/`Set x = New` in the current
  procedure or module scope; look up that type as a class/form module in the index; look up
  `Foo` in its locals. Unresolvable (no declaration, `As Object`/`Variant`, unindexed host
  type like `Excel.Range`) yields nothing — no guessing, no crash. No type inference beyond
  this in v1.
- **Incremental re-indexing**: open-doc edits debounce (~250–300ms, "latest wins" — never
  queue overlapping reparses, always reparse the most recent content once the debounce
  fires) → whole-file re-lex/re-parse of just that document → splice that module's old
  entries out of the global table and insert the new ones. Files changed on disk while
  unopened: client's `createFileSystemWatcher('**/*.{bas,cls,frm}')` forwards
  `workspace/didChangeWatchedFiles` to trigger a targeted re-parse.
  **Real VBA modules are not small** — production modules can run over 4,000 lines, some
  larger — so whole-file reparse-on-every-edit is a real performance question, not a
  simplification to wave away. No partial/incremental reparse in v1 (real complexity for a
  first cut), but this is mitigated deliberately rather than assumed fine: (1) lexer and
  parser must both be single-pass/linear-time — no quadratic string-concat or repeated
  rescans — verified directly by benchmarking against large synthetic fixture files (5k,
  10k+ lines) in Phase 1, not just small hand-written ones; (2) statement *lists* are parsed
  with an iterative loop, not recursion, so only genuine nesting (expressions, nested
  `If`/`Select Case`/`With`) recurses — this also avoids call-stack-depth failures on large
  real files with long flat procedures; (3) if Phase 1 benchmarking shows whole-file
  reparse on a 4k–10k+ line module can't stay comfortably under the debounce window,
  fall back to reparsing only the edited procedure(s) (VBA's `Sub`/`Function`/`Property`
  boundaries make this a natural incremental-reparse unit) — flagged here as the concrete
  next step if needed, not designed in detail until the benchmark says it's necessary.

## 4. Milestone-1 features

- **Document Symbols**: AST walk replaces the regex; reuse the existing display-string
  formatting from `src/documentSymbolProvider.ts` (`` `${name} (${access} ${kind})` ``,
  Property Get/Let/Set grouping, params-as-`(name As type)`) fed from real AST nodes.
- **Signature Help**: port `VbaSignatureHelpProvider`'s formatting, sourced from the real
  symbol table instead of the fragile module-level `signatureMap`. Actually register it in
  `server.ts` capabilities this time — fixes the dormant/never-shipped bug.
- **Diagnostics**: syntax errors fall out of parser error-recovery directly. `Option
  Explicit` undeclared-variable check runs only on modules that contain that statement;
  resolves each identifier use through proc-locals → module scope → project globals → a
  curated ~100-entry intrinsics allowlist (`MsgBox`, `CStr`, `UBound`, `Err`, ...).
  Deliberately biased toward false negatives over false positives, since there's no host
  type-library import to validate `Application`/`ActiveWorkbook`-style host API calls
  against — document this bias so it isn't mistaken for a bug later.
- **Hover**: same shared local→module→global→member resolver as diagnostics/definition,
  rendering the same signature formatting plus any immediately-preceding `'`-comment lines
  as description text.
- **Go to Definition**: same resolver → `Location` at the declaration identifier's precise
  range.
- **Find References**: v1 = project-wide AST walk per request, matching resolved symbol
  case-insensitively (fine at realistic VBA project sizes); note a reverse-reference index
  as the natural future optimization if this proves too slow, not built preemptively.

## 5. Phased delivery (de-risk plumbing before investing in the parser)

1. **Phase 0 — plumbing only.** Restructure per §1; port the *existing regex logic* as-is
   into `server/src/features/documentSymbols.ts` behind a real `vscode-languageclient` /
   `vscode-languageserver` boundary; prove `textDocument/documentSymbol` and a trivial
   `publishDiagnostics` round-trip end-to-end; verify dual-process debugging
   (`.vscode/launch.json` compound config) and `vsce package`+install. Delete the old files
   (§1). **Deliverable: functionally identical to today, now genuinely LSP-based.**
2. **Phase 1 — lexer + parser + AST**, built and unit-tested in complete isolation (not
   wired to any live feature yet) per §2/§6.
3. **Phase 2 — rewire Document Symbols + Signature Help onto the real AST**, replacing
   Phase 0's ported regex; regression-check against Phase 0 fixtures.
4. **Phase 3 — semantic layer** (`projectIndex`/binder) per §3, unit-tested against small
   in-memory synthetic multi-module projects.
5. **Phase 4 — Diagnostics (syntax + Option Explicit) + Hover.**
6. **Phase 5 — Go to Definition + Find References**, with real cross-module integration
   tests. Leave completion as an explicit `// TODO(milestone 2)` at the capabilities site in
   `server.ts` — not designed now.

## 6. Testing strategy

- **Fast unit tests** (`server/src/test/{lexer,parser,binder}.test.ts`): plain Mocha via
  `mocha -r ts-node/register`, no `vscode`/`vscode-languageserver` imports where possible,
  fixtures under `server/src/test/fixtures/*.bas` with structural assertions (declaration
  counts, specific statement kinds, diagnostic positions on intentionally-broken fixtures)
  rather than brittle full-AST snapshots. This is the layer that makes the parser genuinely
  test-driven without needing the VS Code extension host. Include at least one large
  generated fixture (several thousand lines, reflecting real-world module sizes) with a
  timed assertion (parse completes well within the debounce window) so a performance
  regression in the lexer/parser shows up as a failing test, not a bug report.
- **Binder tests**: feed `ProjectIndex.addModule(uri, sourceText)` synthetic in-memory
  multi-module strings, assert global-vs-instance scoping and `Private` non-leakage — no
  filesystem, no host.
- **Extension-host smoke tests** (`client/src/test/`): migrate existing scaffolding,
  swapping the ancient `vscode-test` for `@vscode/test-electron` + `@vscode/test-cli`;
  extend to confirm the `LanguageClient` reaches running state and that opening a fixture
  `.bas`/`.cls` file returns real symbols/diagnostics/hover over the live connection. `npm
  run test` runs unit tests first (fast fail), then this slower suite.

## 7. New dependencies

- **client**: `vscode-languageclient` `^10.1.0` (its own manifest requires VS Code
  `^1.91.0` — see below); dev: `@vscode/test-electron` `^3.0.0`, `@vscode/test-cli`
  `^0.0.15` (replacing `vscode-test`), bumped `@types/node`.
- **server**: `vscode-languageserver` `^10.1.0`, `vscode-languageserver-textdocument`
  `^1.0.12`, `vscode-uri` `^3.x`; dev: `mocha`, `ts-node`, `@types/node`.
- **root/shared**: `typescript` bumped from the current `^3.8.3` (2020-era) to a current
  5.x line (not the brand-new TS 7 Go rewrite — surrounding tooling like `ts-node`/
  `@typescript-eslint` should be assumed to lag it for now); `eslint`/`@typescript-eslint/*`
  bumped from `^6.8.0`/`^2.30.0` to a current v7/v8 line, staying on ESLint 8's classic
  `.eslintrc.json` format (skip the ESLint 9 flat-config migration — unrelated cleanup).
- **Required, not optional**: bump `engines.vscode` from `^1.47.0` to at least `^1.91.0`
  and `@types/vscode` to match, since `vscode-languageclient` 10.x requires it.

## 8. Disposition of old files

- `src/old_documentSymbolProvider.ts`, `old2__documentSymbolProvider.ts`,
  `old3_documentSymbolProvider.ts` — deleted in Phase 0 (untracked, superseded).
- `src/documentSymbolProvider.ts` — display/signature-formatting logic ported forward
  (Phase 0 regex version, Phase 2 AST version); file deleted once Phase 0's port is
  verified. `src/extension.ts` deleted once `client/src/extension.ts` replaces it.

## Verification

- Phase 0: `npm run compile` builds both projects via `tsc -b`; launch the extension
  (`F5`/`Run Extension`) against a sample `.bas` file and confirm Outline/breadcrumbs still
  populate exactly as before, now via the LSP round-trip; `vsce package` then install the
  VSIX in a clean profile to confirm workspace-hoisted deps resolve at runtime.
- Phase 1: `npm run test:unit` (or `test:unit` scoped to `server`) green, including the
  deliberately-malformed fixtures asserting no throw + correct recovery, and the large
  (multi-thousand-line) fixture's timing assertion.
- Phase 3: binder unit tests green (global vs. instance scoping, `Private` non-leakage).
- Phase 4/5: extension-host suite (`npm test`) green — real diagnostics/hover/definition/
  references observed against fixture files opened in a live VS Code test instance.
