/**
 * One CSV cell. Quotes are doubled, and a value that a spreadsheet would read as a formula (=, +, -, @, tab, carriage
 * return) is prefixed with an apostrophe, so opening an export can never run anything.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rows to CSV text with CRLF line endings, as spreadsheets expect. */
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
