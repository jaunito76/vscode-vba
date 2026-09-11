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
- Fixed a real infinite loop (also an out-of-memory crash) when parsing an Enum or Type block containing a `[Name]` bracket-escaped identifier, e.g. the common `[_First]`/`[_Last]` sentinel pattern — added real support for that syntax and a safety net against any other construct an Enum/Type body doesn't yet recognize
- Fixed the server crashing (and, after a few crashes, the client giving up and not reconnecting for the rest of the session) when any code anywhere in the project referenced a `Public Const` declared in a different file; also fixed hovering a call to a Sub declared in another, often longer, file sometimes crashing the same way
- A bug in one language-server feature can no longer take the whole server down and disconnect every open file — failures are now caught, logged to the "VBA Language Server" output channel, and surfaced as an error notification instead
- Added real support for VBA's file I/O statements (`Open`, `Close`, `Print #`, `Write #`, `Input #`, `Line Input #`, `Get #`, `Put #`) — previously unrecognized entirely, which could corrupt parsing (missing symbols, false "variable not defined" diagnostics) for everything later in a file that used them