import type { ExportMode } from './types';

/** Values available to the filename template and to header and footer text. */
export interface TemplateVars {
    title: string;
    /** Note file name without its extension. */
    file?: string;
    mode: ExportMode;
    /** Export date, YYYY-MM-DD in local time. */
    date: string;
    /** Page number as printed (after the starting number is applied). */
    page?: number;
    /** Last printed page number. */
    pages?: number;
}

export function localDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Replaces {name} placeholders. Unknown placeholders are left as written. */
export function fillTemplate(template: string, vars: TemplateVars): string {
    return template.replace(/\{(title|file|mode|date|page|pages)\}/g, (whole, name: keyof TemplateVars) => {
        const v = vars[name];
        return v === undefined ? whole : String(v);
    });
}

/** Removes characters that are not allowed in file names and trims dots and spaces from the ends. */
export function sanitizeFileName(name: string): string {
    // eslint-disable-next-line no-control-regex -- intentionally strips control characters from file names
    return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
}

export const DEFAULT_FILENAME_TEMPLATE = '{file}-{mode}';

/** The file name stem (no extension) for an export. Falls back to the default template when the result is empty. */
export function exportStem(template: string, vars: TemplateVars, suffix = ''): string {
    const fill = (t: string) => sanitizeFileName(fillTemplate(t, vars));
    const stem = fill(template.trim() === '' ? DEFAULT_FILENAME_TEMPLATE : template) || fill(DEFAULT_FILENAME_TEMPLATE);
    return stem + suffix;
}

export type Slot = 'left' | 'center' | 'right';
export const SLOTS: Slot[] = ['left', 'center', 'right'];

/**
 * Text for each of the three slots of a header or footer. `pageText` (the formatted page
 * number) goes into `pageSlot`; when that slot also has text, the text comes first and the
 * two are joined with " · ".
 */
export function composeSlots(
    texts: Record<Slot, string>,
    vars: TemplateVars,
    pageText: string,
    pageSlot: Slot | null,
): Record<Slot, string> {
    const out: Record<Slot, string> = { left: '', center: '', right: '' };
    for (const slot of SLOTS) {
        const parts: string[] = [];
        const filled = fillTemplate(texts[slot], vars).trim();
        if (filled !== '') parts.push(filled);
        if (pageSlot === slot && pageText !== '') parts.push(pageText);
        out[slot] = parts.join(' · ');
    }
    return out;
}
