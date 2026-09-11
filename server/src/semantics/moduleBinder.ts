import { parse } from '../parser/parser';
import { ModuleInfo, ModuleType } from './symbols';

/**
 * Parses one module's source and extracts its local symbol table. Does not
 * know about any other module — merging into the project-wide global
 * namespace (§ standard-module Public members share one scope, class/form
 * members don't) is ProjectIndex's job.
 */
export function bindModule(uri: string, source: string): ModuleInfo {
	const { module, diagnostics } = parse(source);
	const info: ModuleInfo = {
		uri,
		moduleType: inferModuleType(uri),
		moduleName: deriveModuleNameFromUri(uri),
		ast: module,
		diagnostics,
		procedures: new Map(),
		moduleVars: new Map(),
		consts: new Map(),
		types: new Map(),
		enums: new Map()
	};

	for (const stmt of module.body) {
		switch (stmt.kind) {
			case 'AttributeStmt':
				if (
					stmt.name.toUpperCase() === 'VB_NAME' &&
					stmt.value.kind === 'Literal' &&
					stmt.value.literalKind === 'String'
				) {
					info.moduleName = stmt.value.value;
				}
				break;
			case 'ProcedureDecl': {
				const key = stmt.name.toUpperCase();
				const list = info.procedures.get(key);
				if (list) {
					list.push(stmt);
				} else {
					info.procedures.set(key, [stmt]);
				}
				break;
			}
			case 'DimStmt':
				for (const decl of stmt.declarations) {
					info.moduleVars.set(decl.name.toUpperCase(), {
						decl,
						access: stmt.access,
						isStatic: stmt.isStatic,
						withEvents: stmt.withEvents
					});
				}
				break;
			case 'ConstStmt':
				for (const decl of stmt.declarations) {
					info.consts.set(decl.name.toUpperCase(), { decl, access: stmt.access });
				}
				break;
			case 'TypeDecl':
				info.types.set(stmt.name.toUpperCase(), { decl: stmt, access: stmt.access });
				break;
			case 'EnumDecl':
				info.enums.set(stmt.name.toUpperCase(), { decl: stmt, access: stmt.access });
				break;
			default:
				break;
		}
	}

	return info;
}

function inferModuleType(uri: string): ModuleType {
	const lower = uri.toLowerCase();
	if (lower.endsWith('.cls')) {
		return 'class';
	}
	if (lower.endsWith('.frm')) {
		return 'form';
	}
	return 'standard';
}

function deriveModuleNameFromUri(uri: string): string {
	const base = uri.split(/[\\/]/).pop() ?? uri;
	return base.replace(/\.[^./]+$/, '');
}
