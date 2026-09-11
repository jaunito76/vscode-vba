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
	'PARTITION', 'RGB', 'QBCOLOR',
	// Error handling
	'ERR', 'ERL',
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
	'ACTIVEPRINTER', 'THISWORKBOOK', 'THISDOCUMENT', 'WORKBOOKS', 'WORKSHEETS', 'SHEETS',
	'RANGE', 'CELLS', 'ROWS', 'COLUMNS', 'SELECTION', 'DOCUMENTS', 'CURRENTDB',
	'DBENGINE', 'SCREEN', 'FORMS', 'REPORTS', 'CODECONTEXTOBJECT'
]);
