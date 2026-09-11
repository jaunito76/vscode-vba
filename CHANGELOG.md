# Change Log

All notable changes to the "vscode-vba" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Edit to documentSymbolProvider allowing procedure to identify proper Sub/Function/Properties and include them in the outline
- Added the ability to keep Properties together with their letter/setter/getter
- Rebuilding the extension around a real VBA language server (see `docs/vba-language-server-plan.md` and `docs/progress-log.md` for status); still in progress, no user-facing behavior change yet beyond document symbols now being served from the new architecture