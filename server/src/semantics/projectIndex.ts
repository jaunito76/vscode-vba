import { ProcedureDecl, Stmt } from '../parser/ast';
import { getNestedBodies } from '../parser/astWalk';
import { bindModule } from './moduleBinder';
import { ModuleInfo, ResolvedSymbol } from './symbols';

interface GlobalProcEntry {
	proc: ProcedureDecl;
	moduleUri: string;
}

interface GlobalVarEntry {
	moduleUri: string;
	name: string;
	type?: string;
	/** Module vars and consts share this one global table; this says which source map to re-look-up the decl in. */
	isConst: boolean;
}

/**
 * Project-wide symbol index over every indexed .bas/.cls/.frm module.
 *
 * Global-namespace rules (deliberately explicit, not left implicit):
 *  - .bas: default-visibility (Public) procedures/module vars/consts merge
 *    into one project-wide global table; Private stays module-local.
 *  - .cls: members never enter the global table — reachable only via `.`
 *    member access off a variable whose declared type is that class.
 *  - .frm: same as .cls, plus VBA's default-instance behavior — the form's
 *    own name is usable as an implicit global variable of that form's type
 *    with no Dim/New (the extremely common `UserForm1.Show` pattern).
 *
 * v1 does not model multi-instance class variables, Implements
 * polymorphism, or default-member resolution.
 */
export class ProjectIndex {
	private readonly modules = new Map<string, ModuleInfo>();
	private readonly globalProcedures = new Map<string, GlobalProcEntry[]>();
	private readonly globalVars = new Map<string, GlobalVarEntry>();
	/** Upper-cased form module name -> that form's module URI (its implicit default-instance global). */
	private readonly formInstances = new Map<string, string>();

	updateModule(uri: string, source: string): ModuleInfo {
		this.removeModule(uri);
		const info = bindModule(uri, source);
		this.modules.set(uri, info);
		this.mergeIntoGlobals(info);
		return info;
	}

	removeModule(uri: string): void {
		if (!this.modules.delete(uri)) {
			return;
		}
		for (const [key, entries] of this.globalProcedures) {
			const kept = entries.filter(e => e.moduleUri !== uri);
			if (kept.length) {
				this.globalProcedures.set(key, kept);
			} else {
				this.globalProcedures.delete(key);
			}
		}
		for (const [key, entry] of this.globalVars) {
			if (entry.moduleUri === uri) {
				this.globalVars.delete(key);
			}
		}
		for (const [key, formUri] of this.formInstances) {
			if (formUri === uri) {
				this.formInstances.delete(key);
			}
		}
	}

	private mergeIntoGlobals(info: ModuleInfo): void {
		if (info.moduleType === 'standard') {
			for (const [key, procs] of info.procedures) {
				const visible = procs.filter(p => p.access !== 'PRIVATE');
				if (!visible.length) {
					continue;
				}
				const entries = this.globalProcedures.get(key) ?? [];
				for (const proc of visible) {
					entries.push({ proc, moduleUri: info.uri });
				}
				this.globalProcedures.set(key, entries);
			}
			for (const [key, v] of info.moduleVars) {
				if (v.access === 'PRIVATE') {
					continue;
				}
				this.globalVars.set(key, { moduleUri: info.uri, name: v.decl.name, type: v.decl.type, isConst: false });
			}
			for (const [key, c] of info.consts) {
				if (c.access === 'PRIVATE') {
					continue;
				}
				this.globalVars.set(key, { moduleUri: info.uri, name: c.decl.name, type: c.decl.type, isConst: true });
			}
		}

		if (info.moduleType === 'form') {
			this.formInstances.set(info.moduleName.toUpperCase(), info.uri);
		}
	}

	getModule(uri: string): ModuleInfo | undefined {
		return this.modules.get(uri);
	}

	allModules(): ModuleInfo[] {
		return Array.from(this.modules.values());
	}

	findModuleByName(name: string): ModuleInfo | undefined {
		const upper = name.toUpperCase();
		for (const m of this.modules.values()) {
			if (m.moduleName.toUpperCase() === upper) {
				return m;
			}
		}
		return undefined;
	}

	/** Resolves a bare (unqualified) identifier: local scope first, then module scope, then the project's global table. */
	resolveUnqualified(moduleInfo: ModuleInfo, proc: ProcedureDecl | undefined, name: string): ResolvedSymbol | undefined {
		const upper = name.toUpperCase();

		if (proc) {
			for (const param of proc.params) {
				if (param.name.toUpperCase() === upper) {
					return { kind: 'Param', name: param.name, type: param.type };
				}
			}
			const localType = findDimTypeInStatements(proc.body, upper);
			if (localType !== undefined) {
				return { kind: 'Var', name, type: localType.type, moduleUri: moduleInfo.uri, decl: localType.decl };
			}
		}

		const local = this.resolveInModule(moduleInfo, name);
		if (local) {
			return local;
		}

		if (upper === moduleInfo.moduleName.toUpperCase() && moduleInfo.moduleType === 'form') {
			return undefined; // a form's own module referring to itself isn't a useful resolution
		}

		const globalProcs = this.globalProcedures.get(upper);
		if (globalProcs) {
			return { kind: 'Procedure', name, procs: globalProcs };
		}
		const globalVar = this.globalVars.get(upper);
		if (globalVar) {
			const owningModule = this.modules.get(globalVar.moduleUri);
			if (globalVar.isConst) {
				const constInfo = owningModule?.consts.get(upper);
				if (constInfo) {
					return { kind: 'Const', name: globalVar.name, moduleUri: globalVar.moduleUri, decl: constInfo.decl };
				}
			} else {
				const varInfo = owningModule?.moduleVars.get(upper);
				if (varInfo) {
					return { kind: 'Var', name: globalVar.name, type: globalVar.type, moduleUri: globalVar.moduleUri, decl: varInfo.decl };
				}
			}
			// The global table entry outlived its owning module/declaration
			// (e.g. a re-index raced this lookup) — resolve to nothing rather
			// than guess or throw.
		}
		const formUri = this.formInstances.get(upper);
		if (formUri) {
			const formModule = this.modules.get(formUri);
			if (formModule) {
				return {
					kind: 'Var',
					name: formModule.moduleName,
					type: formModule.moduleName,
					moduleUri: formUri,
					// Implicit default-instance global — there's no real declaration
					// token to point at, so "definition" is just the top of the form module.
					decl: { name: formModule.moduleName, nameRange: formModule.ast.range, isArray: false, range: formModule.ast.range }
				};
			}
		}

		return undefined;
	}

	/**
	 * Resolves `target.member` given the declared type name of `target`
	 * (from findDeclaredType below). Deliberately narrow: no type
	 * inference, no default-member resolution — an unresolvable type or
	 * member simply yields nothing rather than guessing.
	 */
	resolveMember(targetType: string, memberName: string): ResolvedSymbol | undefined {
		const typeModule = this.findModuleByName(targetType);
		if (!typeModule) {
			return undefined;
		}
		return this.resolveInModule(typeModule, memberName);
	}

	private resolveInModule(moduleInfo: ModuleInfo, name: string): ResolvedSymbol | undefined {
		const upper = name.toUpperCase();
		const procs = moduleInfo.procedures.get(upper);
		if (procs) {
			return { kind: 'Procedure', name, procs: procs.map(p => ({ proc: p, moduleUri: moduleInfo.uri })) };
		}
		const v = moduleInfo.moduleVars.get(upper);
		if (v) {
			return { kind: 'Var', name: v.decl.name, type: v.decl.type, moduleUri: moduleInfo.uri, decl: v.decl };
		}
		const c = moduleInfo.consts.get(upper);
		if (c) {
			return { kind: 'Const', name: c.decl.name, moduleUri: moduleInfo.uri, decl: c.decl };
		}
		const t = moduleInfo.types.get(upper);
		if (t) {
			return { kind: 'Type', name: t.decl.name, moduleUri: moduleInfo.uri, decl: t.decl };
		}
		const e = moduleInfo.enums.get(upper);
		if (e) {
			return { kind: 'Enum', name: e.decl.name, moduleUri: moduleInfo.uri, decl: e.decl };
		}
		return undefined;
	}

	/**
	 * Finds the declared type name of a simple local reference by walking
	 * the enclosing procedure (VBA has no nested block scoping — a Dim
	 * anywhere in a Sub is proc-scoped), then module scope.
	 */
	findDeclaredType(moduleInfo: ModuleInfo, proc: ProcedureDecl | undefined, name: string): string | undefined {
		const upper = name.toUpperCase();
		if (proc) {
			for (const param of proc.params) {
				if (param.name.toUpperCase() === upper) {
					return param.type;
				}
			}
			const found = findDimTypeInStatements(proc.body, upper);
			if (found) {
				return found.type;
			}
		}
		return moduleInfo.moduleVars.get(upper)?.decl.type;
	}
}

type DimTypeMatch = { type?: string; decl: import('../parser/ast').VarDecl };

/**
 * Scans an entire procedure body (VBA has no nested block scoping, so a
 * later `Dim x As Integer` inside an If/For is still procedure-scoped) for
 * how `upperName` was declared. A typed `Dim`/parameter wins outright; an
 * untyped `Dim x` followed later by `Set x = New Type` (a common real-world
 * pattern) still resolves to that type rather than stopping at the first,
 * type-less declaration.
 */
function findDimTypeInStatements(stmts: Stmt[], upperName: string): DimTypeMatch | undefined {
	let dimResult: DimTypeMatch | undefined;
	let newAssignment: DimTypeMatch | undefined;

	function visit(list: Stmt[]): void {
		for (const stmt of list) {
			if (stmt.kind === 'DimStmt') {
				for (const decl of stmt.declarations) {
					if (decl.name.toUpperCase() === upperName) {
						if (decl.type) {
							dimResult = { type: decl.type, decl };
							return;
						}
						dimResult ??= { type: undefined, decl };
					}
				}
			}
			if (
				stmt.kind === 'AssignStmt' &&
				stmt.isSet &&
				stmt.target.kind === 'Identifier' &&
				stmt.target.name.toUpperCase() === upperName &&
				stmt.value.kind === 'NewExpr'
			) {
				newAssignment ??= {
					type: stmt.value.typeName,
					decl: {
						name: stmt.target.name,
						nameRange: stmt.target.range,
						isArray: false,
						type: stmt.value.typeName,
						range: stmt.range
					}
				};
			}
			for (const nested of getNestedBodies(stmt)) {
				visit(nested);
			}
		}
	}
	visit(stmts);

	if (dimResult?.type) {
		return dimResult;
	}
	return newAssignment ?? dimResult;
}
