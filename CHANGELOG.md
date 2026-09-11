# Change Log

All notable changes to the "vscode-vba" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Edit to documentSymbolProvider allowing procedure to identify proper Sub/Function/Properties and include them in the outline
- Added the ability to keep Properties together with their letter/setter/getter
- Restructured the extension into a real VBA language server: a `client`/`server` pair talking over the Language Server Protocol (`vscode-languageclient`/`vscode-languageserver`) instead of the previous in-process, regex-based providers. Document symbols now come from the server process; a real parser and further LSP features are being layered on top module by module
- Added a hand-rolled VBA tokenizer and recursive-descent parser (`server/src/lexer`, `server/src/parser`) producing a full AST with panic-mode error recovery, so a syntax error in one procedure no longer prevents the rest of a module from being understood. Not yet wired into any user-facing feature