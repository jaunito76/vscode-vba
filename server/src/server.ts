import * as fs from 'fs';
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind,
	DocumentSymbolParams,
	SignatureHelpParams,
	HoverParams,
	DefinitionParams,
	ReferenceParams,
	DidChangeWatchedFilesParams,
	FileChangeType,
	TextDocumentChangeEvent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { getDefinition } from './features/definition';
import { getDiagnostics } from './features/diagnostics';
import { getDocumentSymbols } from './features/documentSymbols';
import { getHover } from './features/hover';
import { getReferences } from './features/references';
import { getSignatureHelp } from './features/signatureHelp';
import { ProjectIndex } from './semantics/projectIndex';
import { findVbaFiles } from './workspaceScanner';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Kept live (workspace scan on init, debounced updates on edit, file-watcher
// updates for unopened files); powers diagnostics/hover (Phase 4) and
// definition/references (Phase 5).
const projectIndex = new ProjectIndex();

connection.onInitialize((params: InitializeParams): InitializeResult => {
	for (const folder of params.workspaceFolders ?? []) {
		indexWorkspaceFolder(folder.uri);
	}
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentSymbolProvider: true,
			signatureHelpProvider: { triggerCharacters: ['(', ','] },
			hoverProvider: true,
			definitionProvider: true,
			referencesProvider: true
			// TODO(completion, milestone 2): no completionProvider capability yet.
		}
	};
});

function indexWorkspaceFolder(folderUri: string): void {
	const rootPath = URI.parse(folderUri).fsPath;
	for (const filePath of findVbaFiles(rootPath)) {
		try {
			const content = fs.readFileSync(filePath, 'utf8');
			projectIndex.updateModule(URI.file(filePath).toString(), content);
		} catch {
			// Unreadable file (permissions, disappeared mid-scan): skip it.
		}
	}
}

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return [];
	}
	return getDocumentSymbols(document);
});

connection.onSignatureHelp((params: SignatureHelpParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return undefined;
	}
	return getSignatureHelp(document, params.position);
});

connection.onHover((params: HoverParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return undefined;
	}
	return getHover(document, params.position, projectIndex);
});

connection.onDefinition((params: DefinitionParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return undefined;
	}
	return getDefinition(document, params.position, projectIndex);
});

connection.onReferences((params: ReferenceParams) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return undefined;
	}
	return getReferences(document, params.position, projectIndex, params.context.includeDeclaration);
});

// Real VBA modules run thousands of lines, so re-indexing on every keystroke
// is debounced; "latest wins" — a pending reparse is cancelled and replaced
// by the next edit rather than queued, so a fast typist never backs up a
// chain of stale reparses.
const REINDEX_DEBOUNCE_MS = 300;
const pendingReindex = new Map<string, NodeJS.Timeout>();

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
	const uri = change.document.uri;
	const timer = pendingReindex.get(uri);
	if (timer) {
		clearTimeout(timer);
	}
	pendingReindex.set(
		uri,
		setTimeout(() => {
			pendingReindex.delete(uri);
			const document = documents.get(uri);
			if (!document) {
				return;
			}
			const moduleInfo = projectIndex.updateModule(uri, document.getText());
			connection.sendDiagnostics({ uri, diagnostics: getDiagnostics(moduleInfo, projectIndex) });
		}, REINDEX_DEBOUNCE_MS)
	);
});

// Files changed on disk while not open in an editor. The client is
// responsible for actually watching '**/*.{bas,cls,frm}' (see
// client/src/extension.ts's synchronize.fileEvents) and forwarding change
// notifications here.
connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
	for (const change of params.changes) {
		if (change.type === FileChangeType.Deleted) {
			projectIndex.removeModule(change.uri);
			continue;
		}
		if (documents.get(change.uri)) {
			continue; // an open document's edits are handled by onDidChangeContent
		}
		try {
			const filePath = URI.parse(change.uri).fsPath;
			projectIndex.updateModule(change.uri, fs.readFileSync(filePath, 'utf8'));
		} catch {
			// File may have been removed between the event and this read.
		}
	}
});

documents.listen(connection);
connection.listen();
