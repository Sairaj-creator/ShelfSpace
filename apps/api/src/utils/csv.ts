/**
 * OWASP Formula / CSV Injection Sanitizer
 * Prefixes cells starting with '=', '+', '-', '@', '\t', or '\r' with a single quote.
 */
export function sanitizeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatRowToCsv(row: Array<any>): string {
  return row.map(sanitizeCsvCell).join(',');
}
