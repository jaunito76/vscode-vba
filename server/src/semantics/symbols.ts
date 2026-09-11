import { ConstDecl, EnumDecl, Module, ParseDiagnostic, ProcedureDecl, TypeDecl, VarDecl } from '../parser/ast';

export type ModuleType = 'standard' | 'class' | 'form';

export interface DeclaredVar {
	decl: VarDecl;
	access?: string;
	isStatic: boolean;
	withEvents: boolean;
}

export interface DeclaredConst {
	decl: ConstDecl;
	access?: string;
}

export interface DeclaredType {
	decl: TypeDecl;
	access?: string;
}

export interface DeclaredEnum {
	decl: EnumDecl;
	access?: string;
}

/**
 * A single module's (.bas/.cls/.frm) parsed content plus its local symbol
 * table. All maps are keyed by upper-cased name for case-insensitive
 * lookup — VBA is case-preserving but case-insensitive, so the original
 * declared casing (used for display) lives on the declaration node itself,
 * not the map key.
 */
export interface ModuleInfo {
	uri: string;
	moduleType: ModuleType;
	moduleName: string;
	ast: Module;
	diagnostics: ParseDiagnostic[];
	procedures: Map<string, ProcedureDecl[]>;
	moduleVars: Map<string, DeclaredVar>;
	consts: Map<string, DeclaredConst>;
	types: Map<string, DeclaredType>;
	enums: Map<string, DeclaredEnum>;
}

export type ResolvedSymbol =
	| { kind: 'Procedure'; name: string; procs: { proc: ProcedureDecl; moduleUri: string }[] }
	| { kind: 'Var'; name: string; type?: string; moduleUri: string; decl: VarDecl }
	| { kind: 'Const'; name: string; moduleUri: string; decl: ConstDecl }
	| { kind: 'Type'; name: string; moduleUri: string; decl: TypeDecl }
	| { kind: 'Enum'; name: string; moduleUri: string; decl: EnumDecl }
	| { kind: 'Param'; name: string; type?: string };
