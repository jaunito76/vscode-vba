# Change Log

All notable changes to the "vscode-vba" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Edit to documentSymbolProvider allowing procedure to identify proper Sub/Function/Properties and include them in the outline
- Added the ability to keep Properties together with their letter/setter/getter
- Rebuilt the extension around a real VBA language server (see `docs/vba-language-server-plan.md` and `docs/progress-log.md`): document symbols, signature help, hover, diagnostics, go to definition, and find references are all backed by a real parser and a project-wide symbol index now, instead of the previous per-line regex matching
- Fixed signature help (the parameter hint popup while typing a call) never actually working — it existed in code but was never registered with VS Code
- Added hover: hovering a Sub/Function/Property, variable, constant, type, or enum now shows its signature/declared type, including across modules for class/form members reached via `.` access
- Added diagnostics for syntax errors, and for undeclared variables in modules that use `Option Explicit` (conservatively — see `docs/progress-log.md` for what it deliberately doesn't flag yet, like most host application object model members)
- Added Go to Definition and Find References, working across modules (e.g. jump from a call to a Public Sub declared in another file, or a class member reached via `.` access)
- Fixed the language server crashing (out of memory) on startup when opened against a large workspace folder containing a symlink/junction cycle, or one much larger than the actual VBA project; the workspace scan is also no longer able to delay or break the initial connection to the server