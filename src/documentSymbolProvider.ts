// Reference:
//   https://code.visualstudio.com/api/language-extensions/programmatic-language-features#show-all-symbol-definitions-within-a-document
//   https://github.com/Gimly/vscode-fortran/blob/229cddce53a2ea0b93032619efeef26376cd0d2c/src/documentSymbolProvider.ts
import vscode = require('vscode');

export class VbaDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken): vscode.SymbolInformation[] {

        console.log('VbaDocumentSymbolProvider.provideDocumentSymbols');
        // [Public | Private | Friend] [Static] Function name [(arglist)] [As type]
        // [Public | Private | Friend] [Static] Sub name [(arglist)]
        // [Public | Private } Friend] [Static] Property [Let | Get | Set] PropertyName [(arglist)] [As type]
        const regexStart = /^\s*((Public|Private|Friend)\s+)?((Static)\s+)?(Function|Sub|Property)\s+(((Let|Get|Set)\s+)?[a-zA-Z][a-zA-Z0-9_]*)(\w*)/i;
        const regexEnd =/^\s*(End)\s+(Function|Sub|Property)/i;
        const result: vscode.SymbolInformation[] = [];

        for (let line = 0; line < document.lineCount; line++) {
            var text = document.lineAt(line);
            let matches = text.text.match(regexStart);
            if (matches) {
                result.push(
                    new vscode.SymbolInformation(
                        matches[6],
                        vscode.SymbolKind.Function,
                        '',
                        new vscode.Location(document.uri, text.range)
                    ));
            }
        }

        return result;
    }
}