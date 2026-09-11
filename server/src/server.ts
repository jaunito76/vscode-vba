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
	MessageType,
	WorkspaceFolder,
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

let pendingWorkspaceFolders: WorkspaceFolder[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
	// Just record the folders here — actually scanning them happens in
	// onInitialized, below, so a large workspace can never delay (or, if
	// something goes wrong, break) the initialize handshake itself.
	pendingWorkspaceFolders = params.workspaceFolders ?? [];
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

connection.onInitialized(() => {
	for (const folder of pendingWorkspaceFolders) {
		indexWorkspaceFolder(folder.uri);
	}
});

/**
 * A bug in any one feature must never take the whole server process down —
 * that disconnects every open file's language support at once, and (per an
 * earlier real incident) the client only restarts a crashing server a
 * handful of times before giving up on it entirely for the session. Every
 * request handler and the background re-index below runs through this:
 * catch, log to the "VBA Language Server" output channel, surface a toast
 * so a failure is never silently invisible, and fail that one request/pass
 * rather than the process.
 */
function guard<T>(context: string, fallback: T, fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		connection.console.error(`[${context}] ${message}`);
		void connection.window.showErrorMessage(
			`VBA Language Server: ${context} failed unexpectedly and was skipped — see the "VBA Language Server" output channel for details.`
		);
		return fallback;
	}
}

function indexWorkspaceFolder(folderUri: string): void {
	const rootPath = URI.parse(folderUri).fsPath;
	const { files, truncated } = findVbaFiles(rootPath);
	for (const filePath of files) {
		try {
			const content = fs.readFileSync(filePath, 'utf8');
			projectIndex.updateModule(URI.file(filePath).toString(), content);
		} catch (error) {
			// Unreadable file (permissions, disappeared mid-scan) or an
			// unexpected parser failure on this one file: skip it, but log
			// it — silently losing a module from the index without a trace
			// is its own kind of confusing bug report later.
			const message = error instanceof Error ? error.message : String(error);
			connection.console.error(`[Workspace scan] skipped "${filePath}": ${message}`);
		}
	}
	if (truncated) {
		connection.sendNotification('window/logMessage', {
			type: MessageType.Warning,
			message: `VBA: stopped scanning "${rootPath}" after finding a very large number of .bas/.cls/.frm files. ` +
				'Some modules outside this limit will not have project-wide symbol resolution (hover/definition/references across files).'
		});
	}
}

connection.onDocumentSymbol((params: DocumentSymbolParams) =>
	guard('Document Symbols', [], () => {
		const document = documents.get(params.textDocument.uri);
		return document ? getDocumentSymbols(document) : [];
	})
);

connection.onSignatureHelp((params: SignatureHelpParams) =>
	guard('Signature Help', undefined, () => {
		const document = documents.get(params.textDocument.uri);
		return document ? getSignatureHelp(document, params.position) : undefined;
	})
);

connection.onHover((params: HoverParams) =>
	guard('Hover', undefined, () => {
		const document = documents.get(params.textDocument.uri);
		return document ? getHover(document, params.position, projectIndex) : undefined;
	})
);

connection.onDefinition((params: DefinitionParams) =>
	guard('Go to Definition', undefined, () => {
		const document = documents.get(params.textDocument.uri);
		return document ? getDefinition(document, params.position, projectIndex) : undefined;
	})
);

connection.onReferences((params: ReferenceParams) =>
	guard('Find References', undefined, () => {
		const document = documents.get(params.textDocument.uri);
		return document ? getReferences(document, params.position, projectIndex, params.context.includeDeclaration) : undefined;
	})
);

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
			guard('Re-index / Diagnostics', undefined, () => {
				const document = documents.get(uri);
				if (!document) {
					return;
				}
				const moduleInfo = projectIndex.updateModule(uri, document.getText());
				connection.sendDiagnostics({ uri, diagnostics: getDiagnostics(moduleInfo, projectIndex) });
			});
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
		const filePath = URI.parse(change.uri).fsPath;
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf8');
		} catch {
			continue; // File may have been removed between the event and this read.
		}
		guard('Re-index (file watcher)', undefined, () => {
			projectIndex.updateModule(change.uri, content);
		});
	}
});

documents.listen(connection);
connection.listen();
