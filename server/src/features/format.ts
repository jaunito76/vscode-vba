import { Param, ProcedureDecl } from '../parser/ast';

// Shared display formatting so Document Symbols, Signature Help, and (later)
// Hover all render a procedure's signature identically.

export function properCaseAccess(access?: string): string {
	switch (access) {
		case 'PRIVATE': return 'Private';
		case 'FRIEND': return 'Friend';
		case 'GLOBAL': return 'Global';
		default: return 'Public';
	}
}

export function properCaseProcKind(procKind: ProcedureDecl['procKind']): string {
	switch (procKind) {
		case 'SUB': return 'Sub';
		case 'FUNCTION': return 'Function';
		case 'PROPERTY': return 'Property';
	}
}

export function properCasePropertyKind(kind?: 'GET' | 'LET' | 'SET'): string {
	switch (kind) {
		case 'LET': return 'Let';
		case 'SET': return 'Set';
		default: return 'Get';
	}
}

export function formatParam(param: Param): string {
	return `${param.isOptional ? '[Optional] ' : ''}${param.name} As ${param.type || 'Variant'}`;
}

export function formatSignature(proc: Pick<ProcedureDecl, 'name' | 'params' | 'returnType'>): string {
	const paramsStr = proc.params.map(formatParam).join(', ');
	return `${proc.name}(${paramsStr})${proc.returnType ? ` As ${proc.returnType}` : ''}`;
}
