import { Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectIndex } from '../semantics/projectIndex';
import { getDeclarationLocations, resolveAtPosition } from './resolveAtPosition';

export function getDefinition(document: TextDocument, position: Position, projectIndex: ProjectIndex): Location[] | undefined {
	const result = resolveAtPosition(document, position, projectIndex);
	if (!result) {
		return undefined;
	}
	const locations = getDeclarationLocations(result);
	return locations.length ? locations : undefined;
}
