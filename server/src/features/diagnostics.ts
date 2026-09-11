import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { collectProcLocalNames, forEachIdentifier } from '../parser/astWalk';
import { ProjectIndex } from '../semantics/projectIndex';
import { ModuleInfo } from '../semantics/symbols';
import { INTRINSICS } from './intrinsics';

export function getDiagnostics(moduleInfo: ModuleInfo, projectIndex: ProjectIndex): Diagnostic[] {
	return [...getSyntaxDiagnostics(moduleInfo), ...getOptionExplicitDiagnostics(moduleInfo, projectIndex)];
}

function getSyntaxDiagnostics(moduleInfo: ModuleInfo): Diagnostic[] {
	return moduleInfo.diagnostics.map(d => ({
		severity: DiagnosticSeverity.Error,
		range: d.range,
		message: d.message,
		source: 'vba'
	}));
}

/**
 * Only runs on modules that actually declare `Option Explicit` — implicit
 * Variant declaration is otherwise legal VBA. Deliberately conservative:
 * with no host type-library import to validate `Application`/
 * `ActiveWorkbook`-style host API calls against, this biases toward false
 * negatives over false positives (see intrinsics.ts).
 */
function getOptionExplicitDiagnostics(moduleInfo: ModuleInfo, projectIndex: ProjectIndex): Diagnostic[] {
	const hasOptionExplicit = moduleInfo.ast.body.some(s => s.kind === 'OptionStmt' && s.name === 'EXPLICIT');
	if (!hasOptionExplicit) {
		return [];
	}

	const enumMemberNames = collectEnumMemberNames(moduleInfo);
	const diagnostics: Diagnostic[] = [];

	for (const procs of moduleInfo.procedures.values()) {
		for (const proc of procs) {
			const localNames = collectProcLocalNames(proc);
			forEachIdentifier(proc.body, id => {
				const upper = id.name.toUpperCase();
				if (localNames.has(upper) || enumMemberNames.has(upper) || INTRINSICS.has(upper)) {
					return;
				}
				if (projectIndex.resolveUnqualified(moduleInfo, proc, id.name)) {
					return;
				}
				diagnostics.push({
					severity: DiagnosticSeverity.Warning,
					range: id.range,
					message: `Variable not defined: '${id.name}'`,
					source: 'vba'
				});
			});
		}
	}

	return diagnostics;
}

function collectEnumMemberNames(moduleInfo: ModuleInfo): Set<string> {
	const names = new Set<string>();
	for (const { decl } of moduleInfo.enums.values()) {
		for (const member of decl.members) {
			names.add(member.name.toUpperCase());
		}
	}
	return names;
}
