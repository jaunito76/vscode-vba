import * as path from 'path';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ['--nolazy', '--inspect=6009'] }
		}
	};

	// Lets the server's project-wide symbol index stay current for files
	// changed on disk while not open in an editor (e.g. edited outside VS
	// Code, or a VBA IDE export/import round-trip).
	const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{bas,cls,frm}');

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ language: 'vba' }],
		synchronize: { fileEvents: fileWatcher }
	};

	client = new LanguageClient('vba', 'VBA Language Server', serverOptions, clientOptions);

	context.subscriptions.push(fileWatcher, { dispose: () => client.stop() });
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
