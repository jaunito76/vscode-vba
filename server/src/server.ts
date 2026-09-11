import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind,
	DocumentSymbolParams,
	TextDocumentChangeEvent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDocumentSymbols } from './features/documentSymbols';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentSymbolProvider: true
		}
	};
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return [];
	}
	return getDocumentSymbols(document);
});

// Proves the publishDiagnostics round-trip; the diagnostics themselves come
// from real parsing in a later phase.
documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
	connection.sendDiagnostics({ uri: change.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
