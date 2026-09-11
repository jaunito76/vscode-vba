import { Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { forEachNameReference } from '../parser/astWalk';
import { ModuleInfo, ResolvedSymbol } from '../semantics/symbols';
import { ProjectIndex } from '../semantics/projectIndex';
import { getDeclarationLocations, resolveAtPosition } from './resolveAtPosition';

/**
 * v1: a project-wide AST walk per request, matching the resolved symbol's
 * name case-insensitively — no reverse-reference index built preemptively
 * (the natural optimization if this ever proves too slow at realistic VBA
 * project sizes). Only walks procedure bodies, not module-level
 * declaration-context expressions (a Const's value, an array bound) — the
 * overwhelming majority of real references live in procedure bodies.
 *
 * A procedure-local symbol (a parameter, or a Dim/Set-New found only via
 * proc-local scope resolution, not registered in the module's own symbol
 * table) is deliberately scoped to just its own procedure rather than
 * matched by name project-wide — otherwise an unrelated `i`/`x`/`count` in
 * some other Sub would show up as a false "reference".
 */
export function getReferences(
	document: TextDocument,
	position: Position,
	projectIndex: ProjectIndex,
	includeDeclaration: boolean
): Location[] | undefined {
	const result = resolveAtPosition(document, position, projectIndex);
	if (!result) {
		return undefined;
	}
	const { resolved, moduleInfo, proc } = result;
	const upperName = resolved.name.toUpperCase();
	const locations: Location[] = [];

	if (isProcLocal(resolved, moduleInfo)) {
		if (proc) {
			forEachNameReference(proc.body, ref => {
				if (ref.name.toUpperCase() === upperName) {
					locations.push(Location.create(moduleInfo.uri, ref.range));
				}
			});
		}
	} else {
		for (const otherModule of projectIndex.allModules()) {
			for (const stmt of otherModule.ast.body) {
				if (stmt.kind !== 'ProcedureDecl') {
					continue;
				}
				forEachNameReference(stmt.body, ref => {
					if (ref.name.toUpperCase() === upperName) {
						locations.push(Location.create(otherModule.uri, ref.range));
					}
				});
			}
		}
	}

	if (includeDeclaration) {
		locations.unshift(...getDeclarationLocations(result));
	}

	return locations;
}

function isProcLocal(resolved: ResolvedSymbol, moduleInfo: ModuleInfo): boolean {
	if (resolved.kind === 'Param') {
		return true;
	}
	if (resolved.kind === 'Var') {
		return !(resolved.moduleUri === moduleInfo.uri && moduleInfo.moduleVars.has(resolved.name.toUpperCase()));
	}
	return false;
}
