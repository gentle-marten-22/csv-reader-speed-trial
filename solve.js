// Faster drop-in for csv-reader 1.0.0: identical answers, built on slices and native indexOf scans
// instead of character-by-character string concatenation.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;
  // Cached index of the next LF at or after pos; -1 = none, -2 = unknown.
  let lfPos = -2;

  function nextLF() {
    if (lfPos < pos) lfPos = text.indexOf("\n", pos);
    return lfPos;
  }

  function readUnquoted(initial) {
    const iComma = text.indexOf(",", pos);
    const lf = nextLF();
    let endIdx;
    let ended;
    let segEnd;
    if (iComma === -1 && lf === -1) {
      endIdx = n; ended = END; segEnd = n;
    } else if (lf !== -1 && (iComma === -1 || lf < iComma)) {
      endIdx = lf; ended = LINE_BREAK; segEnd = lf;
      if (segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    } else {
      endIdx = iComma; ended = COMMA; segEnd = iComma;
    }
    const seg = text.slice(pos, segEnd);
    let value;
    let added;
    if (seg.indexOf("\r") === -1) {
      value = initial + seg;
      added = seg.length;
    } else {
      const parts = seg.split("\r");
      for (let i = 1; i < parts.length; i++) {
        errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
      }
      const joined = parts.join("");
      value = initial + joined;
      added = joined.length;
    }
    if (ended === COMMA) {
      pos = endIdx + 1;
    } else if (ended === LINE_BREAK) {
      pos = endIdx + 1;
      line += 1;
    } else {
      pos = n;
    }
    return { value, ended, added };
  }

  // Transform a quoted segment: CRLF / lone CR become LF. Returns [value, lineInc].
  function quotedSegment(seg) {
    if (seg.indexOf("\r") === -1) {
      const firstLf = seg.indexOf("\n");
      if (firstLf === -1) return [seg, 0];
      let count = 1;
      let i = firstLf;
      while ((i = seg.indexOf("\n", i + 1)) !== -1) count += 1;
      return [seg, count];
    }
    const matches = seg.match(/\r\n|\r|\n/g);
    const lineInc = matches ? matches.length : 0;
    return [seg.replace(/\r\n|\r/g, "\n"), lineInc];
  }

  function afterQuoted(value) {
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return { value, ended: COMMA }; }
    if (c === 10) { pos += 1; line += 1; return { value, ended: LINE_BREAK }; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; return { value, ended: LINE_BREAK };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
    return junk;
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    const q = text.indexOf('"', open + 1);
    if (q !== -1 && (q + 1 >= n || text.charCodeAt(q + 1) !== 34)) {
      // Fast path: a single segment, no doubled quotes.
      const seg = text.slice(open + 1, q);
      const [value, lineInc] = quotedSegment(seg);
      line += lineInc;
      pos = q + 1;
      return afterQuoted(value);
    }
    // Slow path: doubled quotes, or no closing quote at all.
    const parts = [];
    let lineInc = 0;
    let segStart = open + 1;
    let cur = segStart;
    while (true) {
      const qq = text.indexOf('"', cur);
      if (qq === -1) {
        pos = open + 1;
        line = openLine;
        errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (qq + 1 < n && text.charCodeAt(qq + 1) === 34) {
        const seg = text.slice(segStart, qq);
        const [v, inc] = quotedSegment(seg);
        parts.push(v, '"');
        lineInc += inc;
        cur = qq + 2;
        segStart = cur;
        continue;
      }
      const seg = text.slice(segStart, qq);
      const [v, inc] = quotedSegment(seg);
      parts.push(v);
      lineInc += inc;
      line += lineInc;
      pos = qq + 1;
      return afterQuoted(parts.join(""));
    }
  }

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      if (pos < n && text.charCodeAt(pos) === 34) {
        quoted = true;
        const f = readQuoted();
        fields.push(f.value);
        ended = f.ended;
      } else {
        quoted = false;
        const f = readUnquoted("");
        fields.push(f.value);
        ended = f.ended;
      }
    } while (ended === COMMA);

    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
