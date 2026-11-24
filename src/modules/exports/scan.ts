import JSZip from "jszip";

/**
 * Checks a generated workbook before it is stored: it must hold values only. Refused:
 * formulas, cached error values (#REF!, #DIV/0!, …), external links and external relationships,
 * hyperlinks, macros, defined names other than print titles, broken references and non-numbers
 * (NaN, Infinity). It also checks the direction of every sheet (right-to-left for Arabic, left-to-right
 * for English) and that every sheet is set up for A4 printing.
 */
export interface ScanResult {
  ok: boolean;
  problems: string[];
  sheets: number;
  cells: number;
}

const ERROR_TEXT = /#(REF!|DIV\/0!|N\/A|VALUE!|NAME\?|NUM!|NULL!)/;

export async function scanWorkbook(bytes: Buffer | Uint8Array, locale: "ar" | "en"): Promise<ScanResult> {
  const problems: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.some((n) => /^xl\/externalLinks\//i.test(n))) problems.push("external link part");
  if (names.some((n) => /vbaProject|\.bin$/i.test(n))) problems.push("macro or binary part");
  for (const rel of names.filter((n) => n.endsWith(".rels"))) {
    const xml = await zip.file(rel)!.async("string");
    if (/TargetMode="External"/i.test(xml)) problems.push(`external relationship in ${rel}`);
    if (/externalLink|hyperlink/i.test(xml)) problems.push(`link relationship in ${rel}`);
  }
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbook) problems.push("no workbook part");
  else {
    for (const m of workbook.matchAll(/<definedName\b[^>]*name="([^"]+)"[^>]*>([^<]*)<\/definedName>/g)) {
      if (m[1] !== "_xlnm.Print_Titles" && m[1] !== "_xlnm.Print_Area") problems.push(`defined name ${m[1]}`);
      if (ERROR_TEXT.test(m[2] ?? "")) problems.push(`broken reference in defined name ${m[1]}`);
    }
  }
  const sheetFiles = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  let cells = 0;
  for (const file of sheetFiles) {
    const xml = await zip.file(file)!.async("string");
    cells += (xml.match(/<c\b/g) ?? []).length;
    if (/<f[\s>]/.test(xml)) problems.push(`formula in ${file}`);
    if (/<c\b[^>]*\bt="e"/.test(xml)) problems.push(`error value in ${file}`);
    if (/<hyperlink\b/.test(xml)) problems.push(`hyperlink in ${file}`);
    if (/<v>(NaN|-?Infinity|undefined|null)<\/v>/.test(xml)) problems.push(`non-number in ${file}`);
    const rtl = /<sheetView\b[^>]*rightToLeft="1"/.test(xml);
    if (locale === "ar" && !rtl) problems.push(`${file} is not right-to-left`);
    if (locale === "en" && rtl) problems.push(`${file} is right-to-left`);
    if (!/<pageSetup\b[^>]*paperSize="9"/.test(xml)) problems.push(`${file} has no A4 page setup`);
    if (!/<pageSetup\b[^>]*fitToWidth="1"/.test(xml)) problems.push(`${file} is not fitted to the page width`);
  }
  if (sheetFiles.length === 0) problems.push("no worksheet");
  return { ok: problems.length === 0, problems, sheets: sheetFiles.length, cells };
}

/** Numeric cell values of each sheet in order (for comparing the Arabic and English files). */
export async function numericValues(bytes: Buffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out: string[][] = [];
  for (const file of files) {
    const xml = await zip.file(file)!.async("string");
    const values: string[] = [];
    for (const m of xml.matchAll(/<c\b([^>]*)>(?:<f>[^<]*<\/f>)?<v>([^<]*)<\/v><\/c>/g)) {
      if (/\bt="(s|str|inlineStr|b|e)"/.test(m[1] ?? "")) continue;
      values.push(`${/\br="([A-Z]+\d+)"/.exec(m[1] ?? "")?.[1]}=${m[2]}`);
    }
    out.push(values);
  }
  return out;
}
