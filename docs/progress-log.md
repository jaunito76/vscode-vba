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

## Phase 4 — Diagnostics (syntax + Option Explicit) + Hover — Done (2026-09-11)

- `server/src/parser/astWalk.ts`: a shared, reusable AST walker
  (`forEachIdentifier`) visiting every genuine identifier *use* reachable from
  a statement list — assignment targets, loop variables, array bounds, call
  arguments, everything — while structurally never confusing a use with a
  declaration name or a member name (both are plain strings on their AST
  nodes, not `Identifier` nodes, so there's nothing to filter out). Also
  `collectProcLocalNames`, covering params plus every `Dim`/local `Const`
  anywhere in a procedure body (not `For`/`For Each` loop variables — VBA
  genuinely requires those declared separately under Option Explicit).
  `projectIndex.ts`'s own `getNestedBodies` moved here so both modules share
  one copy.
- `server/src/features/diagnostics.ts`: syntax diagnostics fall straight out
  of the parser's own recovery diagnostics. The Option Explicit check only
  runs on modules that declare it, resolves every identifier through
  proc-locals → module scope → `ProjectIndex` globals → a curated
  `intrinsics.ts` allowlist (~150 entries: VBA intrinsics, `vb*` constants,
  and the handful of Office host globals real code uses constantly —
  `Application`, `Range`, `ThisWorkbook`, etc.), and is deliberately biased
  toward false negatives: with no host type-library import, flagging
  legitimate host API calls would make the check unusable.
- `server/src/features/hover.ts`: token-scan-based (same technique as
  `signatureHelp.ts`, for consistency) rather than AST-position search —
  finds the token under the cursor, walks backward over a `.`-separated
  chain to detect member access, then resolves through the same
  `ProjectIndex` local→module→global→member path diagnostics uses. Renders
  the shared `formatSignature` in a `vba` code fence, plus any consecutive
  `'`-comment lines immediately above a declaration as documentation (a
  convention already common in real VBA codebases — a free win, no special
  doc-comment syntax invented).
- Wired into `server.ts`: `hoverProvider` capability + `connection.onHover`;
  real diagnostics now ride the existing debounced re-index path instead of
  publishing an empty array.
- 22 new fast unit tests (74 total, ~180ms). Caught one real gap while
  writing them: `findDeclaredType`'s proc-local scan only recognized `Dim`,
  not a local `Const` — meaning `Const Pi = 3.14` followed by using `Pi`
  would have been a false-positive "variable not defined" under Option
  Explicit. Fixed via `collectProcLocalNames` treating `Const` the same as
  `Dim`. Also hit (and had to work around, not fix) a real quirk of the LSP
  type surface: `Diagnostic.message` is typed `string | MarkupContent`, not
  plain `string`, even though every message this feature ever constructs is
  a literal string — tests narrow with a small `msg()` helper rather than
  casting inline everywhere.
- Regression-checked against the extension-host integration test — still
  green.

## Phase 5 — Go to Definition + Find References — Done (2026-09-11)

This closes out the original milestone-1 scope from
`docs/vba-language-server-plan.md`. Completion is explicitly deferred to a
later milestone (`// TODO(completion, milestone 2)` at the
capabilities-negotiation site in `server.ts` — no `completionProvider`
capability declared).

- Added `nameRange` to every AST node that didn't already have one
  (`VarDecl`, `ConstDecl`, `Param`, `TypeDecl`, `EnumDecl`, `EnumMember`,
  `MemberExpr`, `WithMemberExpr`) so "go to definition" can point at just a
  name, not the whole declaration statement — `ProcedureDecl` already had
  this from Phase 1. Small, mechanical parser change, but load-bearing for
  Phase 5's whole premise of "precise range" jumps.
- `server/src/features/resolveAtPosition.ts`: extracted from `hover.ts`
  (unchanged behavior, verified by the existing hover tests passing
  untouched) so Hover, Go to Definition, and Find References all resolve
  a cursor position through the exact same local -> module -> global ->
  member path and can never disagree about what a position refers to.
  Also hosts `getDeclarationLocations()`, shared between Definition and
  References' `includeDeclaration` option.
- `server/src/features/definition.ts`: thin — resolve, then look up the
  matching declaration's `nameRange`. Property Get/Let/Set overloads
  return one location per overload, matching how most editors present
  "go to definition" on an overloaded symbol.
- `server/src/features/references.ts`: v1 project-wide AST walk per the
  plan, matching by name case-insensitively — no reverse-reference index
  built preemptively. A procedure-local symbol (a parameter, or a
  Dim/Set-New found only via proc-local scope resolution, not registered
  in the module's own symbol table) is scoped to just its own procedure
  rather than matched by name project-wide, so an unrelated `i`/`x`/`count`
  in some other Sub never shows up as a false reference.
- Found a real gap while building references: the existing `forEachIdentifier`
  walker (built for the Option Explicit check, where member names correctly
  aren't variables) skips `MemberExpr`/`WithMemberExpr` names entirely —
  meaning `c.Greet` was invisible to a naive reuse of that walker, and
  "Find References" on a class member returned nothing. Fixed by
  generalizing `astWalk.ts`'s internals to a `Visitors` object and adding
  `forEachNameReference` (identifiers *and* member-access names) alongside
  the original `forEachIdentifier` (identifiers only, still what
  diagnostics.ts uses) rather than duplicating the whole tree walk.
- Wired into `server.ts`: `definitionProvider`/`referencesProvider`
  capabilities + `onDefinition`/`onReferences`.
- 19 new fast unit tests (93 total), plus a new extension-host integration
  test opening two fixture files (`helper.bas`, `caller.bas`) as separate
  editors and confirming Go to Definition on a call in one jumps to the
  Sub declared in the other through the live LSP connection — the
  "Integration-test real cross-module navigation" the plan asked for
  specifically, not just unit-level ProjectIndex coverage.

## Milestone 1 complete

All five phases from `docs/vba-language-server-plan.md` are done: a real
LSP client/server architecture, a hand-rolled parser producing a full AST,
a project-wide semantic layer, and document symbols/signature
help/diagnostics/hover/definition/references all built on it. Completion is
the natural next milestone.

## Post-milestone-1 fix: workspace-scan crash (2026-09-11)

First real manual test (F5, a real ~100K-line VBA codebase open as the
workspace) hit `JavaScript heap out of memory` in the server process every
time, ~30-50 seconds after launch, which the client surfaced as `Pending
response rejected since connection got disposed` — a generic-looking error
that gave no hint the real cause was a runaway directory walk. Root-caused
by forking `server/out/server.js` directly with `--node-ipc` (bypassing
VS Code entirely) and replaying the exact `initialize`/`initialized`
handshake by hand, which reproduced a fast, clean response for a small
folder — proving the server logic itself wasn't fundamentally broken, just
unbounded against a large/unusual real filesystem.

Two independent bugs, both in the Phase 3 workspace scan:

- `server/src/workspaceScanner.ts`'s recursive walk had no symlink/junction
  cycle detection — a self-referential link anywhere in the tree (not
  unusual on OneDrive/SharePoint-synced folders, which this user's
  workspace lives on) recurses forever, and since `ProjectIndex` never
  evicts a module once added, each "new" path discovered through the cycle
  permanently retains another full parsed AST until the heap is exhausted.
  Fixed with an `fs.realpathSync`-based visited-directories set, plus an
  unconditional `DEFAULT_MAX_FILES` (5000) cap as a second line of defense
  against a workspace folder that's just genuinely far larger than the
  actual VBA project (e.g. a huge shared drive opened as the workspace
  root) — `window/logMessage`s a warning if the cap is hit, rather than
  silently under-indexing.
- Separately, and a real design mistake independent of the crash:
  `indexWorkspaceFolder` ran synchronously inside `onInitialize`, blocking
  the LSP handshake itself on the full scan completing. Moved to
  `onInitialized` (the correct lifecycle point for post-handshake work per
  the LSP spec) so a large or slow scan can never delay, or break, the
  client's ability to talk to the server at all.
- 4 new fast unit tests for the scanner specifically (92 total): recursive
  discovery, skip-dir behavior, the truncation cap, and survival of an
  actual directory junction cycle created on disk (skips itself
  gracefully if the test environment can't create one).
- Verified via the same manual fork-and-handshake technique used to
  diagnose it: `initialize` now responds in ~300ms scanning this repo's
  own folder, regardless of what the workspace scan is doing.

## Post-milestone-1 fix: the OOM was actually a parser infinite loop, not the scan (2026-09-11)

The fix above was real and worth keeping, but the user's crash **persisted
after it** — still a hard OOM, no longer "the client gives up before the
scan finishes" but "the server hangs and never responds at all." That ruled
the scan back out as a red herring (confirmed directly: `findVbaFiles`
against the user's actual ~100K-line, 176-file, 459-directory real codebase
completed in 201ms with `truncated: false` — nowhere near the file/time
caps). The user then gave direct access to the real repository being
tested against, which made root-causing this by evidence rather than
guesswork possible.

Ran the compiled `parse()` directly against all 176 real `.bas`/`.cls`
files from that repo, logging each one before parsing it (so a hang would
show exactly which file it stalled on) — found it immediately:
`Classes\CApproach.cls`, 6KB, hung and then OOM'd.

Root cause: the file declares `Public Enum ApproachType` with sentinel
members `[_First]` and `[_Last]` — VBA's `[Name]` bracket-escaping for an
identifier that wouldn't otherwise be legal (here, one starting with `_`;
a common real-world pattern for enum iteration-bound sentinels). The lexer
had no support for `[...]` at all, so `[` fell through to
`scanPunctuation()` as its own token. In `parseEnumDecl`'s member loop,
hitting a bare `[` made `expectIdentifierLike()` fail *without consuming
anything*, and — unlike every other loop in the parser — this loop had no
progress guard. Every subsequent iteration re-examined the exact same `[`
token: same failed identifier, same empty-name member pushed, same
diagnostic pushed, loop condition still true. A genuine infinite loop that
grew the `members` and `diagnostics` arrays without bound until the
process ran out of heap — nothing to do with the workspace scan, the LSP
handshake, or anything Phase-3-shaped; a plain Phase-1 parser bug that
none of the (synthetic, not real-world) parser tests happened to exercise.

Fixed two ways:
- `server/src/lexer/lexer.ts`: real support for `[Name]` — scans to a
  matching `]` and emits a single `Identifier` token, brackets discarded
  (semantically `[_First]` just *is* `_First`; the brackets are pure
  escaping syntax with no independent meaning elsewhere in the language).
- `server/src/parser/parser.ts`: added the same `before = this.pos; ...;
  if (this.pos === before) { advance(); }` progress guard `parseBlockBody`
  already had, to `parseTypeDecl`'s and `parseEnumDecl`'s member loops —
  defense in depth, so *any* future token those loops don't know how to
  handle degrades to a diagnostic-and-skip instead of a repeat of this
  exact class of bug.
- 5 new tests: lexer coverage for `[Name]`, a parser test asserting
  `[_First]`/`[_Last]` now parse as real enum members, and two explicit
  regression tests (Enum and Type bodies) proving an unrecognized token
  can no longer loop forever, bounded by a 2-second mocha timeout.
- Re-verified against all 176 real files from the user's actual codebase
  directly (not just the unit suite) — every one now parses in low single-
  digit milliseconds, `CApproach.cls` included.

The concrete lesson for this project going forward: the synthetic test
fixtures, however extensive, don't substitute for throwing the parser at
real-world VBA — this bug lived in code that had "passed" every Phase 1/3
test. Real-codebase smoke testing (as done here, informally, against a
user-supplied directory) is worth turning into a standing practice before
calling a parser change done, not just when something has already broken.

## Post-milestone-1 fix: server crash-loop, a resolver NPE, and no crash visibility (2026-09-11)

Rebuilding with the previous fix, the OOM was gone — but the user still hit
a hard crash, now a clean, immediate `TypeError`, which is real progress:
it means whatever was left is a plain, traceable bug rather than a runaway
loop. The stack trace pointed straight at `ProjectIndex.resolveUnqualified`.

Root cause: module-level `Dim` vars and `Const`s share one internal
`globalVars` table (both populate the project-wide global namespace the
same way), but the map only ever recorded a plain `{moduleUri, name,
type}` — nothing said *which* of the two source maps (`moduleVars` vs
`consts`) a given entry actually came from. The resolution code always
looked the name back up in `moduleVars`, unconditionally. The moment
*any* code anywhere in the project referenced a `Public Const` declared in
a different module — extremely common, this is what constants are for —
that lookup returned `undefined` and `.decl` on it threw, taking the
whole server process down. This is exactly the kind of bug the `guard()`
wrapper below is meant to contain, but at the time it didn't exist yet, so
one crash became a crash-loop: the client restarts a dying server a
handful of times before giving up on it for the rest of the session,
which is what the user was actually seeing.

Fixed three things:

- `server/src/semantics/projectIndex.ts`: `GlobalVarEntry` now carries an
  `isConst` flag set correctly at merge time, and `resolveUnqualified`
  looks the declaration back up in the matching source map — `consts` for
  a Const, `moduleVars` for a Var — returning the correctly-shaped
  `ResolvedSymbol` (`Const` vs `Var`) either way. If the owning module or
  declaration has somehow gone missing (a re-index race), it now resolves
  to nothing rather than guessing or throwing, matching every other
  resolution path in this file.
- `server/src/server.ts`: added a `guard()` wrapper — catch, log to the
  "VBA Language Server" output channel, show an error toast, return a safe
  fallback — around every request handler (`onDocumentSymbol`,
  `onSignatureHelp`, `onHover`, `onDefinition`, `onReferences`) and the
  debounced re-index/diagnostics pass (the exact callback that crashed
  here). A bug in any one feature can no longer take the whole server
  process, and every open file's language support, down with it — and a
  failure is now visible without hunting through logs for it. The
  file-watcher re-index path gets the same treatment, logged (not
  toasted, since it fires routinely on ordinary file changes) so an
  unexpected failure there isn't silently swallowed either.
- Actually applied the "real-codebase smoke testing" practice the
  previous entry named but didn't yet do: indexed all 176 real files from
  the user's codebase into one `ProjectIndex` and ran diagnostics + hover
  (at every few lines) + document symbols over every one of them, not
  just this one crash's exact repro. That single pass found a **second**
  real bug beyond the one from the stack trace: `hover.ts`'s doc-comment
  lookup read leading `'`-comment lines from the *hovered* document using
  a line number from the *declaring* module's AST — fine when they're the
  same file, but for the very common case of hovering a call to a Sub
  declared in another (often longer) file, indexing past the end of the
  shorter file's line array threw instead of just skipping the
  doc-comment. Fixed by only attempting the lookup when the declaration's
  module URI matches the hovered document's, plus a bounds check inside
  `getLeadingComment` itself as a second line of defense.
- 4 new tests (100 total): the Const/Var resolver fix at both the
  `ProjectIndex` level and, since that's the code path that actually
  crashed, the `diagnostics.ts` level too; the cross-module hover
  doc-comment crash. Re-ran the full 176-file real-codebase pass clean
  afterward — zero errors.
