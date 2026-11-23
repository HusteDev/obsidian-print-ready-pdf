// Unicode fallback fonts.
//
// pdfmake's built-in fonts (Helvetica, Courier) cover only WinAnsi, so CJK,
// Cyrillic, Greek, arrows, symbols etc. cannot render. Only a small symbol
// subset is bundled (fonts are many MB); otherwise the user points the plugin at
// font files in the vault (or anywhere on disk). At export time we:
//   1. collect the characters in the document that the base fonts can't draw,
//   2. load fallback fonts (in order) only if such characters exist,
//   3. split the affected text runs so each character uses the first fallback
//      font that has a glyph for it, and register those fonts with pdfmake.
// Coverage is checked with a small cmap reader, so no font library is needed
// and it stays lightweight.
import { App, Platform, TFile, normalizePath } from 'obsidian';
import { toSfnt } from './woff';
import symbolFont from './assets/SymbolsSubset.ttf';

export const FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'];

// Code points the PDF standard fonts can encode (Windows-1252 / WinAnsi).
const CP1252_EXTRA = new Set([
    0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152,
    0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
    0x0153, 0x017E, 0x0178,
]);

function isBaseCovered(cp: number): boolean {
    return cp === 0x09 || cp === 0x0A || cp === 0x0D
        || (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || CP1252_EXTRA.has(cp);
}

// Invisible joiners / variation selectors: no glyph needed, and a missing one
// would otherwise show as a stray box or '?'.
function isIgnorable(cp: number): boolean {
    return (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x200B && cp <= 0x200F)
        || cp === 0x2060 || cp === 0xFEFF || (cp >= 0xE0100 && cp <= 0xE01EF);
}

/**
 * Plain-ASCII stand-ins for common characters the standard fonts lack. Used only
 * when no fallback font has the character, so "->" beats a bare "?".
 */
const ASCII_STAND_INS = new Map<number, string>([
    [0x2192, '->'], [0x2190, '<-'], [0x2194, '<->'], [0x21D2, '=>'], [0x21D0, '<='], [0x21D4, '<=>'],
    [0x2191, '^'], [0x2193, 'v'],
    [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2015, '-'], [0x2212, '-'], [0x2043, '-'], [0xFE63, '-'], [0xFF0D, '-'],
    [0x2216, '\\'], [0x2215, '/'], [0x2044, '/'],
    [0x2713, 'v'], [0x2714, 'v'], [0x2717, 'x'], [0x2718, 'x'], [0x2715, 'x'], [0x2716, 'x'],
    [0x2264, '<='], [0x2265, '>='], [0x2260, '!='], [0x2248, '~='], [0x221E, 'inf'],
    [0x2023, '>'], [0x25E6, 'o'], [0x25AA, '-'], [0x25CF, '*'], [0x25CB, 'o'],
    [0x2009, ' '], [0x200A, ' '], [0x2008, ' '], [0x2007, ' '], [0x2006, ' '], [0x2005, ' '], [0x2004, ' '], [0x2003, ' '], [0x2002, ' '], [0x202F, ' '], [0x205F, ' '], [0x3000, ' '],
    [0x2032, "'"], [0x2033, '"'], [0x201B, "'"], [0x201F, '"'], [0x2039, '<'], [0x203A, '>'],
    [0x00AD, ''],
    // Math: Greek letters spelled out, common operators and sets (used for inline formulas).
    [0x3B1, 'alpha'], [0x3B2, 'beta'], [0x3B3, 'gamma'], [0x3B4, 'delta'], [0x3B5, 'epsilon'], [0x3B6, 'zeta'],
    [0x3B7, 'eta'], [0x3B8, 'theta'], [0x3D1, 'theta'], [0x3B9, 'iota'], [0x3BA, 'kappa'], [0x3BB, 'lambda'],
    [0x3BC, 'mu'], [0x3BD, 'nu'], [0x3BE, 'xi'], [0x3C0, 'pi'], [0x3D6, 'pi'], [0x3C1, 'rho'], [0x3F1, 'rho'],
    [0x3C3, 'sigma'], [0x3C2, 'sigma'], [0x3C4, 'tau'], [0x3C5, 'upsilon'], [0x3C6, 'phi'], [0x3D5, 'phi'],
    [0x3C7, 'chi'], [0x3C8, 'psi'], [0x3C9, 'omega'],
    [0x393, 'Gamma'], [0x394, 'Delta'], [0x398, 'Theta'], [0x39B, 'Lambda'], [0x39E, 'Xi'], [0x3A0, 'Pi'],
    [0x3A3, 'Sigma'], [0x3A5, 'Upsilon'], [0x3A6, 'Phi'], [0x3A8, 'Psi'], [0x3A9, 'Omega'],
    [0x2211, 'sum'], [0x220F, 'prod'], [0x222B, 'int'], [0x221A, 'sqrt'], [0x2202, 'd'], [0x2207, 'nabla'],
    [0x2208, 'in'], [0x2209, 'not in'], [0x2282, 'subset'], [0x2286, 'subset='], [0x222A, 'U'], [0x2229, '^'],
    [0x2205, '{}'], [0x2200, 'for all'], [0x2203, 'exists'], [0x2261, '=='], [0x226A, '<<'], [0x226B, '>>'],
    [0x221D, '~'], [0x2213, '-+'], [0x2218, 'o'], [0x2219, '.'], [0x22C5, '.'], [0x22EF, '...'], [0x223C, '~'],
    [0x2243, '~='], [0x2245, '~='], [0x27E8, '<'], [0x27E9, '>'], [0x27F9, '=>'], [0x27FA, '<=>'], [0x21A6, '|->'],
    [0x2220, 'angle'], [0x22A5, 'perp'], [0x2225, '||'], [0x2113, 'l'], [0x210F, 'h'], [0x127, 'h'],
    [0x2227, 'and'], [0x2228, 'or'],
    [0x211D, 'R'], [0x2115, 'N'], [0x2124, 'Z'], [0x211A, 'Q'], [0x2102, 'C'],
]);

// ── Minimal sfnt cmap reader ─────────────────────────────────────────────────

export interface FontCoverage {
    has(cp: number): boolean;
    /** PostScript name, needed by pdfmake to pick a face inside a .ttc. */
    psName?: string;
    isCollection: boolean;
}

function readTag(v: DataView, o: number): string {
    return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

export function parseFontCoverage(buf: ArrayBuffer): FontCoverage {
    const v = new DataView(buf);
    let base = 0;
    let isCollection = false;
    let tag = readTag(v, 0);
    if (tag === 'ttcf') {
        isCollection = true;
        base = v.getUint32(12);
        tag = readTag(v, base);
    }
    if (!['\0\u0001\0\0', 'OTTO', 'true', 'typ1'].includes(tag)) throw new Error('not a TrueType/OpenType font');

    const numTables = v.getUint16(base + 4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
        const rec = base + 12 + i * 16;
        tables[readTag(v, rec)] = v.getUint32(rec + 8);
    }

    let psName: string | undefined;
    const nameOff = tables['name'];
    if (nameOff !== undefined) {
        const count = v.getUint16(nameOff + 2);
        const strOff = nameOff + v.getUint16(nameOff + 4);
        for (let i = 0; i < count; i++) {
            const r = nameOff + 6 + i * 12;
            if (v.getUint16(r + 6) !== 6) continue;
            const len = v.getUint16(r + 8);
            const off = strOff + v.getUint16(r + 10);
            const utf16 = v.getUint16(r) === 3 || v.getUint16(r) === 0;
            let s = '';
            if (utf16) for (let j = 0; j < len; j += 2) s += String.fromCharCode(v.getUint16(off + j));
            else for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(off + j));
            psName = s;
            if (utf16) break; // prefer the Unicode record
        }
    }

    const cmapOff = tables['cmap'];
    if (cmapOff === undefined) throw new Error('font has no cmap table');
    const n = v.getUint16(cmapOff + 2);
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
        const r = cmapOff + 4 + i * 8;
        const plat = v.getUint16(r), enc = v.getUint16(r + 2);
        const off = cmapOff + v.getUint32(r + 4);
        const fmt = v.getUint16(off);
        if (fmt !== 4 && fmt !== 12) continue;
        const score = (plat === 3 && enc === 10 ? 4 : plat === 0 ? 3 : plat === 3 && enc === 1 ? 2 : 0) + (fmt === 12 ? 1 : 0);
        if (score > bestScore) { best = off; bestScore = score; }
    }
    if (best < 0 || bestScore < 2) throw new Error('font has no Unicode cmap');

    const off = best;
    if (v.getUint16(off) === 12) {
        const groups = v.getUint32(off + 12);
        const has = (cp: number) => {
            let lo = 0, hi = groups - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const g = off + 16 + mid * 12;
                if (cp < v.getUint32(g)) hi = mid - 1;
                else if (cp > v.getUint32(g + 4)) lo = mid + 1;
                else return v.getUint32(g + 8) + (cp - v.getUint32(g)) !== 0;
            }
            return false;
        };
        return { has, psName, isCollection };
    }
    const segCount = v.getUint16(off + 6) >> 1;
    const endO = off + 14;
    const startO = endO + segCount * 2 + 2;
    const deltaO = startO + segCount * 2;
    const rangeO = deltaO + segCount * 2;
    const has = (cp: number) => {
        if (cp > 0xFFFF) return false;
        let lo = 0, hi = segCount - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (cp > v.getUint16(endO + mid * 2)) lo = mid + 1;
            else if (cp < v.getUint16(startO + mid * 2)) hi = mid - 1;
            else {
                const ro = v.getUint16(rangeO + mid * 2);
                const delta = v.getInt16(deltaO + mid * 2);
                if (ro === 0) return ((cp + delta) & 0xFFFF) !== 0;
                const gOff = rangeO + mid * 2 + ro + (cp - v.getUint16(startO + mid * 2)) * 2;
                if (gOff + 2 > buf.byteLength) return false;
                const g = v.getUint16(gOff);
                return g !== 0 && ((g + delta) & 0xFFFF) !== 0;
            }
        }
        return false;
    };
    return { has, psName, isCollection };
}

// ── Loading ──────────────────────────────────────────────────────────────────

async function readFontBytes(app: App, path: string): Promise<ArrayBuffer> {
    const vaultPath = normalizePath(path);
    const f = app.vault.getAbstractFileByPath(vaultPath);
    if (f instanceof TFile) return app.vault.readBinary(f);
    // Hidden folders (e.g. .obsidian/) are not indexed but the adapter can read them.
    if (await app.vault.adapter.exists(vaultPath)) return app.vault.adapter.readBinary(vaultPath);
    if (Platform.isDesktopApp && /^([a-zA-Z]:[\\/]|\/|~)/.test(path)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs') as typeof import('fs');
        const os = require('os') as typeof import('os');
        const real = path.startsWith('~') ? os.homedir() + path.slice(1) : path;
        const data = await fs.promises.readFile(real);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    throw new Error('file not found');
}

// ── docDef rewriting ─────────────────────────────────────────────────────────

const CHILD_KEYS = ['text', 'stack', 'ul', 'ol', 'columns', 'content', 'table', 'body'];
const BASE_FONTS = new Set(['Helvetica', 'Courier']);

function collectUncovered(node: any, out: Set<number>): void {
    if (typeof node === 'string') {
        for (const ch of node) {
            const cp = ch.codePointAt(0)!;
            if (!isBaseCovered(cp) && !isIgnorable(cp)) out.add(cp);
        }
    } else if (Array.isArray(node)) {
        for (const n of node) collectUncovered(n, out);
    } else if (node && typeof node === 'object') {
        for (const k of CHILD_KEYS) if (k in node) collectUncovered(node[k], out);
    }
}

export interface FallbackResult {
    fonts: Record<string, any>;
    vfs: Record<string, ArrayBuffer>;
    /** Human-readable warnings (unloadable fonts, uncovered characters). */
    warnings: string[];
}

/**
 * Rewrites `docDef` in place so characters outside WinAnsi use fallback fonts.
 * Returns extra fonts/vfs entries for pdfmake, or null when nothing was needed.
 */
export async function applyFallbackFonts(app: App, docDef: any, paths: string[]): Promise<FallbackResult | null> {
    const needed = new Set<number>();
    collectUncovered(docDef.content, needed);
    if (needed.size === 0) return null;

    const result: FallbackResult = { fonts: {}, vfs: {}, warnings: [] };
    const loaded: { name: string; cov: FontCoverage }[] = [];
    const remaining = new Set(needed);
    const owner = new Map<number, string>();

    // Registers `buf` as the next fallback font if it covers any still-missing character.
    const register = (buf: ArrayBuffer, label: string): void => {
        const cov = parseFontCoverage(buf);
        const name = `Fallback${loaded.length}`;
        let used = false;
        for (const cp of remaining) {
            if (cov.has(cp)) { owner.set(cp, name); remaining.delete(cp); used = true; }
        }
        if (!used) return;
        const file = `fallback/${name}.${cov.isCollection ? 'ttc' : 'ttf'}`;
        const spec: any = cov.isCollection ? [file, cov.psName] : file;
        result.fonts[name] = { normal: spec, bold: spec, italics: spec, bolditalics: spec };
        result.vfs[file] = buf;
        loaded.push({ name, cov });
        void label;
    };

    // User fonts come first, so they always win over the built-in symbol font.
    for (const raw of paths) {
        if (remaining.size === 0) break;
        const path = raw.trim();
        if (!path) continue;
        try {
            register(await toSfnt(await readFontBytes(app, path)), path);
        } catch (err) {
            const reason = err instanceof RangeError ? 'corrupt or unsupported font file' : err instanceof Error ? err.message : String(err);
            result.warnings.push(`Fallback font "${path}": ${reason.replace(/[\u0000-\u001F]/g, ' ')}`);
        }
    }

    // Last resort before "?": the bundled Greek and math symbol subset.
    if (remaining.size > 0) {
        try {
            const b = symbolFont;
            register(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'built-in symbols');
        } catch (err) {
            console.warn('[Print-Ready PDF] Built-in symbol font failed to load', err);
        }
    }

    const fontFor = (cp: number): string | undefined => owner.get(cp);
    const missing = new Set<number>();

    const split = (s: string, inherited: string): any[] => {
        const parts: any[] = [];
        let buf = '';
        let curFont: string | undefined;
        const flush = () => {
            if (buf) parts.push(curFont ? { text: buf, font: curFont } : buf);
            buf = '';
        };
        for (const ch of s) {
            const cp = ch.codePointAt(0)!;
            let want: string | undefined;
            let out = ch;
            if (isIgnorable(cp)) continue;
            if (BASE_FONTS.has(inherited) && !isBaseCovered(cp)) {
                want = fontFor(cp);
                if (!want) {
                    const sub = ASCII_STAND_INS.get(cp);
                    if (sub !== undefined) out = sub;
                    else { missing.add(cp); out = '?'; }
                }
            }
            if (want !== curFont) { flush(); curFont = want; }
            buf += out;
        }
        flush();
        return parts;
    };

    // `inline` is true for the contents of a `text` property: strings there are
    // runs that may be split in place. Elsewhere (stack, ul, table cells...) every
    // array element is a node, so a string must stay one element.
    const walk = (node: any, font: string, inline: boolean): any => {
        if (typeof node === 'string') {
            const parts = split(node, font);
            if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
            return inline ? parts : { text: parts };
        }
        if (Array.isArray(node)) {
            const out: any[] = [];
            for (const n of node) {
                const r = walk(n, font, inline);
                if (inline && typeof n === 'string' && Array.isArray(r)) out.push(...r); else out.push(r);
            }
            return out;
        }
        if (node && typeof node === 'object') {
            const f = typeof node.font === 'string' ? node.font : font;
            for (const k of CHILD_KEYS) if (k in node) node[k] = walk(node[k], f, k === 'text');
            return node;
        }
        return node;
    };
    docDef.content = walk(docDef.content, docDef.defaultStyle?.font ?? 'Helvetica', false);

    if (missing.size) {
        const sample = [...missing].slice(0, 8).map(cp => String.fromCodePoint(cp)).join(' ');
        result.warnings.push(`${missing.size} character(s) have no glyph in any fallback font and were replaced with "?" (${sample}). Add a font covering them in Print-Ready PDF settings.`);
    }
    return result;
}
