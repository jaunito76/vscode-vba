/**
 * Curated allowlist of VBA language intrinsics plus the handful of Office
 * host-application globals real-world VBA code uses constantly. There's no
 * host type-library import in v1, so anything from the Excel/Word/Access
 * object model beyond this short list (a Range's members, a Worksheet's
 * methods, etc.) is invisible to the Option Explicit check — deliberately
 * biased toward false negatives, since flagging legitimate host API calls
 * as "undefined" would make the check unusable. See docs/progress-log.md.
 */
export const INTRINSICS: ReadonlySet<string> = new Set([
	// Conversion functions
	'CBOOL', 'CBYTE', 'CCUR', 'CDATE', 'CDBL', 'CDEC', 'CINT', 'CLNG', 'CLNGLNG', 'CLNGPTR',
	'CSNG', 'CSTR', 'CVAR', 'CVERR', 'STR', 'VAL', 'HEX', 'OCT',
	// Type-checking / introspection
	'ISARRAY', 'ISDATE', 'ISEMPTY', 'ISERROR', 'ISMISSING', 'ISNULL', 'ISNUMERIC', 'ISOBJECT',
	'TYPENAME', 'VARTYPE', 'REFTYPESTR',
	// String functions
	'LEN', 'LEFT', 'RIGHT', 'MID', 'INSTR', 'INSTRREV', 'REPLACE', 'SPLIT', 'JOIN',
	'TRIM', 'LTRIM', 'RTRIM', 'UCASE', 'LCASE', 'STRCONV', 'STRCOMP', 'STRREVERSE',
	'SPACE', 'STRING', 'CHR', 'CHRW', 'ASC', 'ASCW', 'FORMAT', 'FORMATCURRENCY',
	'FORMATDATETIME', 'FORMATNUMBER', 'FORMATPERCENT', 'LIKE', 'FILTER',
	// Math functions
	'ABS', 'INT', 'FIX', 'ROUND', 'SQR', 'EXP', 'LOG', 'SIN', 'COS', 'TAN', 'ATN',
	'RND', 'RANDOMIZE', 'SGN',
	// Array functions
	'ARRAY', 'UBOUND', 'LBOUND', 'ERASE',
	// Date/time functions
	'NOW', 'DATE', 'TIME', 'TIMER', 'DATEADD', 'DATEDIFF', 'DATEPART', 'DATESERIAL',
	'DATEVALUE', 'TIMESERIAL', 'TIMEVALUE', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'WEEKDAYNAME',
	'MONTHNAME', 'HOUR', 'MINUTE', 'SECOND', 'DATEADD',
	// Interaction / misc
	'MSGBOX', 'INPUTBOX', 'CREATEOBJECT', 'GETOBJECT', 'ENVIRON', 'SHELL', 'DOEVENTS',
	'CHOOSE', 'SWITCH', 'IIF', 'CALLBYNAME', 'GETSETTING', 'SAVESETTING', 'DELETESETTING',
	'PARTITION', 'RGB', 'QBCOLOR', 'RUN',
	// File system
	'DIR', 'KILL', 'FREEFILE', 'FILEDATETIME', 'FILELEN', 'FILECOPY', 'CURDIR', 'MKDIR',
	'RMDIR', 'CHDIR', 'GETATTR', 'SETATTR', 'EOF', 'LOF', 'LOC',
	// Error handling
	'ERR', 'ERL',
	// `Me` (implicit self-reference inside a class/form module) and `Null`
	// (VBA's database/Variant null literal) — both reserved-word-shaped but
	// not in the lexer's KEYWORDS, since both work everywhere an ordinary
	// identifier/expression does (`Me.Foo`, `x = Null`), unlike a true
	// keyword.
	'ME', 'NULL',
	// Form lifecycle statements (`Load frm` / `Unload Me`) — like Open/
	// Close/Print elsewhere in this parser, not reserved keywords since a
	// project can have its own Sub named "Load", so only the *name* is
	// allowlisted here for the Option Explicit check, not given dedicated
	// statement grammar.
	'LOAD', 'UNLOAD',
	// Common constants
	'VBCRLF', 'VBCR', 'VBLF', 'VBTAB', 'VBBACK', 'VBFORMFEED', 'VBVERTICALTAB',
	'VBNULLSTRING', 'VBNULLCHAR', 'VBNEWLINE', 'VBOBJECTERROR',
	'VBTRUE', 'VBFALSE',
	'VBEMPTY', 'VBNULL', 'VBINTEGER', 'VBLONG', 'VBSINGLE', 'VBDOUBLE', 'VBCURRENCY',
	'VBDATE', 'VBSTRING', 'VBOBJECT', 'VBERROR', 'VBBOOLEAN', 'VBVARIANT', 'VBDATAOBJECT',
	'VBDECIMAL', 'VBBYTE', 'VBARRAY', 'VBBYREF',
	'VBOKONLY', 'VBOKCANCEL', 'VBABORTRETRYIGNORE', 'VBYESNOCANCEL', 'VBYESNO', 'VBRETRYCANCEL',
	'VBCRITICAL', 'VBQUESTION', 'VBEXCLAMATION', 'VBINFORMATION',
	'VBDEFAULTBUTTON1', 'VBDEFAULTBUTTON2', 'VBDEFAULTBUTTON3', 'VBDEFAULTBUTTON4',
	'VBAPPLICATIONMODAL', 'VBSYSTEMMODAL',
	'VBOK', 'VBCANCEL', 'VBABORT', 'VBRETRY', 'VBIGNORE', 'VBYES', 'VBNO',
	// Common Office host globals (Excel/Word/Access) — the most frequently
	// used ones only; anything deeper in the object model is out of scope.
	'APPLICATION', 'ACTIVEWORKBOOK', 'ACTIVESHEET', 'ACTIVECELL', 'ACTIVEDOCUMENT',
	'ACTIVEPRINTER', 'ACTIVEWINDOW', 'THISWORKBOOK', 'THISDOCUMENT', 'WORKBOOKS', 'WORKSHEETS', 'SHEETS',
	'RANGE', 'CELLS', 'ROWS', 'COLUMNS', 'SELECTION', 'DOCUMENTS', 'CURRENTDB', 'CURRENTPROJECT',
	'DBENGINE', 'SCREEN', 'FORMS', 'REPORTS', 'CODECONTEXTOBJECT', 'INTERSECT', 'UNION',
	'WORKSHEETFUNCTION', 'DEBUG',
	// vb* color constants — not prefix-heuristic-shaped the way most host
	// enum constants are named (see looksLikeHostEnumConstant below), but
	// common and worth spelling out exactly.
	'VBBLACK', 'VBRED', 'VBGREEN', 'VBYELLOW', 'VBBLUE', 'VBMAGENTA', 'VBCYAN', 'VBWHITE',
	// VBIDE (VB Extensibility) component-type constants — like the vb*
	// colors above, a small fixed set that doesn't fit
	// looksLikeHostEnumConstant's PascalCase-after-prefix convention
	// (`vbext_ct_ClassModule` has a lowercase letter right after `vb`).
	'VBEXT_CT_CLASSMODULE', 'VBEXT_CT_STDMODULE', 'VBEXT_CT_MSFORM', 'VBEXT_CT_ACTIVEXDESIGNER',
	'VBEXT_CT_DOCUMENT'
]);

/**
 * Prefixes real VBA/Office enum constant members are conventionally named
 * with (`xlEdgeBottom`, `vbExclamation`, `wdAlignParagraphCenter`,
 * `msoControlButton`, ...). Excel alone has 1500+ such constants across
 * ~50 enums — far too many to enumerate — so instead of trying to list
 * them, looksLikeHostEnumConstant recognizes the *naming convention*: a
 * short known prefix immediately followed by an uppercase letter (the
 * PascalCase remainder), which real user identifiers essentially never
 * happen to match by coincidence.
 */
// 'AD' (not 'ADO') — real ADO constants are named e.g. `adOpenStatic`,
// `adLockReadOnly`, `adFldIsNullable`: the prefix itself is just "ad".
const ENUM_CONSTANT_PREFIXES = ['XL', 'VB', 'WD', 'AC', 'MSO', 'DAO', 'AD', 'FM', 'RTF', 'PP', 'OL'];

/**
 * True for a bare identifier that *looks like* a host/VBA enum constant by
 * naming convention (prefix + PascalCase remainder) but isn't in the exact
 * INTRINSICS allowlist above. Used to downgrade, not suppress, the Option
 * Explicit diagnostic for these — see diagnostics.ts — since the
 * convention is a strong but not certain signal (a real user identifier
 * could coincidentally match it, and a genuine typo of a real constant
 * name, e.g. `xlUpp`, would otherwise go completely unflagged).
 */
export function looksLikeHostEnumConstant(name: string): boolean {
	for (const prefix of ENUM_CONSTANT_PREFIXES) {
		if (name.length > prefix.length && name.slice(0, prefix.length).toUpperCase() === prefix && /[A-Z]/.test(name[prefix.length])) {
			return true;
		}
	}
	return false;
}
