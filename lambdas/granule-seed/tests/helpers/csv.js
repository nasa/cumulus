'use strict';

/**
 * Minimal RFC 4180 parser for test assertions only.
 *
 * Handles quoted fields, doubled quotes and embedded newlines, which Postgres COPY CSV
 * output contains. Distinguishes NULL (unquoted empty field) from empty string (`""`),
 * returning `null` and `''` respectively, since that distinction is part of what the
 * tests are checking.
 *
 * @param {string} text
 * @returns {Array<Array<string|null>>}
 */
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  let i = 0;

  const endField = () => {
    row.push(field === '' && !wasQuoted ? null : field);
    field = '';
    wasQuoted = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        quoted = false;
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
      i += 1;
    } else if (ch === ',') {
      endField();
      i += 1;
    } else if (ch === '\n') {
      endField();
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field !== '' || wasQuoted || row.length > 0) {
    endField();
    rows.push(row);
  }

  return rows;
};

/**
 * Parse CSV with a header into objects keyed by column name.
 *
 * @param {string} text
 * @returns {{header: string[], records: Array<Record<string, string|null>>}}
 */
const parseCsvRecords = (text) => {
  const [header, ...rest] = parseCsv(text);
  return {
    header: /** @type {string[]} */ (header),
    records: rest.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]]))),
  };
};

module.exports = { parseCsv, parseCsvRecords };
