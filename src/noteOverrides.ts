import type { ExportMode, Orientation, PageSize, PDFMakeSettings } from './types';
import { lookupProperty } from './metadata';

/** Per-note settings read from frontmatter. A field is set only when its value was valid. */
export interface NoteOverrides {
    pageSize?: PageSize;
    pageOrientation?: Orientation;
    /** Top, right, bottom, left in points. */
    margins?: [number, number, number, number];
    mode?: ExportMode;
    toc?: boolean;
}

export const NOTE_KEYS = {
    pageSize: 'pdf-page-size',
    orientation: 'pdf-orientation',
    margins: 'pdf-margins',
    mode: 'pdf-mode',
    toc: 'pdf-toc',
} as const;

const PAGE_SIZES: PageSize[] = ['LETTER', 'A4', 'LEGAL', 'TABLOID', 'A3', 'A5'];
const MIN_MARGIN = 0;
const MAX_MARGIN = 300;

function parseBool(v: unknown): boolean | undefined {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === 'yes' || s === 'on') return true;
        if (s === 'false' || s === 'no' || s === 'off') return false;
    }
    return undefined;
}

function parseMargins(v: unknown): [number, number, number, number] | undefined {
    let nums: number[];
    if (typeof v === 'number') nums = [v];
    else if (typeof v === 'string') nums = v.split(/[\s,]+/).filter(s => s !== '').map(Number);
    else if (Array.isArray(v)) nums = v.map(x => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN));
    else return undefined;
    if (nums.some(n => !Number.isFinite(n) || n < MIN_MARGIN || n > MAX_MARGIN)) return undefined;
    if (nums.length === 1) return [nums[0], nums[0], nums[0], nums[0]];
    if (nums.length === 4) return [nums[0], nums[1], nums[2], nums[3]];
    return undefined;
}

/** Reads the pdf-* frontmatter keys. Invalid values are ignored and reported through `warn`. */
export function parseNoteOverrides(
    fm: Record<string, unknown> | null | undefined,
    warn: (message: string) => void = () => undefined,
): NoteOverrides {
    const out: NoteOverrides = {};
    if (!fm) return out;
    const bad = (key: string, v: unknown, expected: string) =>
        warn(`Ignoring ${key}: ${JSON.stringify(v)} is not valid (expected ${expected}).`);

    const size = lookupProperty(fm, NOTE_KEYS.pageSize);
    if (size !== undefined) {
        const s = typeof size === 'string' ? size.trim().toUpperCase() : '';
        const match = PAGE_SIZES.find(p => p === s);
        if (match) out.pageSize = match; else bad(NOTE_KEYS.pageSize, size, PAGE_SIZES.join(', '));
    }

    const orient = lookupProperty(fm, NOTE_KEYS.orientation);
    if (orient !== undefined) {
        const s = typeof orient === 'string' ? orient.trim().toLowerCase() : '';
        if (s === 'portrait' || s === 'landscape') out.pageOrientation = s; else bad(NOTE_KEYS.orientation, orient, 'portrait or landscape');
    }

    const margins = lookupProperty(fm, NOTE_KEYS.margins);
    if (margins !== undefined) {
        const m = parseMargins(margins);
        if (m) out.margins = m; else bad(NOTE_KEYS.margins, margins, `one number or four (top right bottom left), ${MIN_MARGIN}-${MAX_MARGIN} pt`);
    }

    const mode = lookupProperty(fm, NOTE_KEYS.mode);
    if (mode !== undefined) {
        const s = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
        if (s === 'print' || s === 'preserve') out.mode = s; else bad(NOTE_KEYS.mode, mode, 'print or preserve');
    }

    const toc = lookupProperty(fm, NOTE_KEYS.toc);
    if (toc !== undefined) {
        const b = parseBool(toc);
        if (b !== undefined) out.toc = b; else bad(NOTE_KEYS.toc, toc, 'true or false');
    }
    return out;
}

/** Returns a copy of the settings with the overrides applied. */
export function applyNoteOverrides(settings: PDFMakeSettings, o: NoteOverrides): PDFMakeSettings {
    const next: PDFMakeSettings = { ...settings };
    if (o.pageSize) next.pageSize = o.pageSize;
    if (o.pageOrientation) next.pageOrientation = o.pageOrientation;
    if (o.margins) [next.marginTop, next.marginRight, next.marginBottom, next.marginLeft] = o.margins;
    if (o.toc !== undefined) next.includeToc = o.toc;
    return next;
}
