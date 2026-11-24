/*
 * Reader for the `rtable` code block format of the Interactive Tables plugin
 * (https://github.com/HusteDev/obsidian-interactive-tables). The body of the block is a GFM
 * pipe table, optionally preceded by `key: value` option lines. This is used only when that
 * plugin is not installed, so the block can still become a table. Extensions on top of GFM:
 *   - a cell that is only `<` belongs to the cell on its left (column span)
 *   - a cell that is only `^` belongs to the cell above (row span)
 *   - `<br>` inside a cell is a line break, `\|` is a literal pipe, `\<` and `\^` are literal
 *   - `widths: 120, auto, 200` (pixels), `valign:`, `heights:`, `row-align:`, `row-valign:`,
 *     `cell-align:`, `cell-valign:`, `col-style:`, `row-style:` and `cell-style:` (see parseStyle)
 * The first row is always the header row.
 */

export type RtAlign = '' | 'left' | 'center' | 'right';
export type RtVAlign = '' | 'top' | 'middle' | 'bottom';
export type RtFontSize = 'small' | 'large' | 'x-large';

/** Theme colors that follow light and dark mode; anything else must be a hex color. */
export const RT_PALETTE = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray'] as const;

export interface RtStyle {
    bg?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    size?: RtFontSize;
    /** `sans`, `serif`, `mono`, or one font family name. */
    font?: string;
}

export interface RtCell {
    r: number;
    c: number;
    rs: number;
    cs: number;
    text: string;
    align?: RtAlign;
    valign?: RtVAlign;
    style?: RtStyle;
}

export interface RtModel {
    rows: number;
    cols: number;
    cells: RtCell[];
    aligns: RtAlign[];
    valigns: RtVAlign[];
    widths: (number | null)[];
    rowAligns: RtAlign[];
    rowValigns: RtVAlign[];
    heights: (number | null)[];
    rowStyles: RtStyle[];
    colStyles: RtStyle[];
}

const SEP_CELL = /^\s*:?-+:?\s*$/;
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const FONT_NAME = /^[A-Za-z0-9 _.-]+$/;

function asAlign(s: string | undefined): RtAlign {
    const v = (s ?? '').trim().toLowerCase();
    return v === 'left' || v === 'center' || v === 'right' ? v : '';
}

function asVAlign(s: string | undefined): RtVAlign {
    const v = (s ?? '').trim().toLowerCase();
    return v === 'top' || v === 'middle' || v === 'bottom' ? v : '';
}

function isColor(v: string): boolean {
    return HEX.test(v) || (RT_PALETTE as readonly string[]).includes(v);
}

/** Parses `bg:yellow;color:#c00;bold;italic;strike;size:large;font:mono`. Unknown or invalid parts are dropped. */
export function parseRtStyle(s: string | undefined): RtStyle {
    const out: RtStyle = {};
    for (const part of (s ?? '').split(';')) {
        const i = part.indexOf(':');
        const k = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
        const v = i < 0 ? '' : part.slice(i + 1).trim();
        const lv = v.toLowerCase();
        if (k === 'bg' && isColor(lv)) out.bg = lv;
        else if (k === 'color' && isColor(lv)) out.color = lv;
        else if (k === 'bold') out.bold = true;
        else if (k === 'italic') out.italic = true;
        else if (k === 'strike') out.strike = true;
        else if (k === 'size' && (lv === 'small' || lv === 'large' || lv === 'x-large')) out.size = lv;
        else if (k === 'font' && FONT_NAME.test(v)) out.font = ['sans', 'serif', 'mono'].includes(lv) ? lv : v;
    }
    return out;
}

/** Reads `key=value, key=value` into a map. */
function sparse(s: string | undefined): Map<string, string> {
    const out = new Map<string, string>();
    for (const part of (s ?? '').split(',')) {
        const [k, v] = part.split('=').map(x => x.trim());
        if (k && v) out.set(k, v);
    }
    return out;
}

export function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && s[i + 1] === '|') {
            cur += '\\|';
            i++;
        } else if (ch === '|') {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map(x => x.trim());
}

function decodeCell(raw: string): string {
    if (raw === '\\<') return '<';
    if (raw === '\\^') return '^';
    return raw.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|');
}

function parseAlign(sep: string): RtAlign {
    const s = sep.trim();
    const l = s.startsWith(':');
    const r = s.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
}

function isSeparatorRow(line: string): boolean {
    const cells = splitRow(line);
    return cells.length > 0 && cells.every(c => SEP_CELL.test(c));
}

function cellAt(m: RtModel, r: number, c: number): RtCell | undefined {
    return m.cells.find(x => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
}

/** Alignment shown for a cell: the cell's own, then its row's, then its column's. */
export function effectiveAlign(m: RtModel, cell: RtCell): { h: RtAlign; v: RtVAlign } {
    return {
        h: cell.align || m.rowAligns[cell.r] || m.aligns[cell.c] || '',
        v: cell.valign || m.rowValigns[cell.r] || m.valigns[cell.c] || '',
    };
}

/** Style shown for a cell: for each property, the cell's own, then its row's, then its column's. */
export function effectiveStyle(m: RtModel, cell: RtCell): RtStyle {
    return { ...m.colStyles[cell.c], ...m.rowStyles[cell.r], ...cell.style };
}

/** Reads an rtable block body. Returns null when there is no table in it. */
export function parseRtable(source: string): RtModel | null {
    const options: Record<string, string> = {};
    const tableLines: string[] = [];
    for (const line of source.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('|')) tableLines.push(t);
        else if (tableLines.length === 0) {
            const m = /^([\w-]+)\s*:\s*(.*)$/.exec(t);
            if (m) options[m[1].toLowerCase()] = m[2];
        }
    }
    if (tableLines.length === 0) return null;

    let aligns: RtAlign[] = [];
    const raw: string[][] = [];
    tableLines.forEach((line, i) => {
        if (i === 1 && isSeparatorRow(line)) aligns = splitRow(line).map(parseAlign);
        else raw.push(splitRow(line));
    });

    const rows = raw.length;
    const cols = Math.max(1, aligns.length, ...raw.map(r => r.length));
    while (aligns.length < cols) aligns.push('');
    aligns = aligns.slice(0, cols);

    const w = (options.widths ?? '').split(',').map(x => x.trim());
    const widths: (number | null)[] = [];
    const v = (options.valign ?? '').split(',');
    const colS = sparse(options['col-style']);
    const valigns: RtVAlign[] = [];
    const colStyles: RtStyle[] = [];
    for (let c = 0; c < cols; c++) {
        const n = parseInt(w[c] ?? '', 10);
        widths.push(Number.isFinite(n) && n > 0 ? n : null);
        valigns.push(asVAlign(v[c]));
        colStyles.push(parseRtStyle(colS.get(String(c + 1))));
    }

    const hs = (options.heights ?? '').split(',').map(x => x.trim());
    const rowA = sparse(options['row-align']);
    const rowV = sparse(options['row-valign']);
    const rowS = sparse(options['row-style']);
    const heights: (number | null)[] = [];
    const rowAligns: RtAlign[] = [];
    const rowValigns: RtVAlign[] = [];
    const rowStyles: RtStyle[] = [];
    for (let r = 0; r < rows; r++) {
        const n = parseInt(hs[r] ?? '', 10);
        heights.push(Number.isFinite(n) && n > 0 ? n : null);
        rowAligns.push(asAlign(rowA.get(String(r + 1))));
        rowValigns.push(asVAlign(rowV.get(String(r + 1))));
        rowStyles.push(parseRtStyle(rowS.get(String(r + 1))));
    }

    // Every grid position belongs to the cell that owns it: `<` joins the left cell, `^` the one above.
    const owner: number[][] = [];
    for (let r = 0; r < rows; r++) {
        owner.push([]);
        for (let c = 0; c < cols; c++) {
            const cellText = raw[r][c] ?? '';
            let o = r * cols + c;
            if (cellText === '<' && c > 0) o = owner[r][c - 1];
            else if (cellText === '^' && r > 0) o = owner[r - 1][c];
            owner[r].push(o);
        }
    }
    const boxes = new Map<number, { r0: number; c0: number; r1: number; c1: number }>();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const o = owner[r][c];
            const b = boxes.get(o);
            if (!b) boxes.set(o, { r0: r, c0: c, r1: r, c1: c });
            else {
                b.r0 = Math.min(b.r0, r);
                b.c0 = Math.min(b.c0, c);
                b.r1 = Math.max(b.r1, r);
                b.c1 = Math.max(b.c1, c);
            }
        }
    }

    const m: RtModel = { rows, cols, cells: [], aligns, valigns, widths, rowAligns, rowValigns, heights, rowStyles, colStyles };
    for (const [o, b] of boxes) {
        const ar = Math.floor(o / cols);
        const ac = o % cols;
        let rect = true;
        for (let r = b.r0; r <= b.r1 && rect; r++) {
            for (let c = b.c0; c <= b.c1; c++) if (owner[r][c] !== o) rect = false;
        }
        const text = decodeCell(raw[ar][ac] ?? '');
        if (rect && b.r0 === ar && b.c0 === ac) m.cells.push({ r: ar, c: ac, rs: b.r1 - b.r0 + 1, cs: b.c1 - b.c0 + 1, text });
        else m.cells.push({ r: ar, c: ac, rs: 1, cs: 1, text }); // malformed span: keep the anchor only
    }
    // Positions nothing owns (a ragged row) become empty cells.
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) if (!cellAt(m, r, c)) m.cells.push({ r, c, rs: 1, cs: 1, text: '' });
    }

    for (const key of new Set([...sparse(options['cell-align']).keys(), ...sparse(options['cell-valign']).keys()])) {
        const [r, c] = key.split(':').map(x => parseInt(x, 10) - 1);
        const cell = cellAt(m, r, c);
        if (!cell) continue;
        const h = asAlign(sparse(options['cell-align']).get(key));
        const vv = asVAlign(sparse(options['cell-valign']).get(key));
        if (h) cell.align = h;
        if (vv) cell.valign = vv;
    }
    for (const [key, val] of sparse(options['cell-style'])) {
        const [r, c] = key.split(':').map(x => parseInt(x, 10) - 1);
        const cell = cellAt(m, r, c);
        const st = parseRtStyle(val);
        if (cell && Object.keys(st).length) cell.style = st;
    }
    return m;
}

/** CSS for a style color: a hex color as it is, a theme color as a tint (background) or the full color (text). */
export function rtColorCss(v: string, bg: boolean): string {
    if (v.startsWith('#')) return v;
    if (v === 'gray') return bg ? 'rgba(var(--mono-rgb-100), 0.12)' : 'var(--text-muted)';
    return bg ? `rgba(var(--color-${v}-rgb), 0.2)` : `var(--color-${v})`;
}

export const RT_FONT_SIZES: Record<RtFontSize, string> = { small: '0.85em', large: '1.2em', 'x-large': '1.5em' };
