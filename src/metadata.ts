import type { MetaFieldId } from './types';

/** The PDF info fields a user can map to a frontmatter property. */
export interface MetaFieldDef {
    id: MetaFieldId;
    label: string;
    /** Frontmatter property read when the setting is left empty. */
    defaultKey: string;
    /** What is used when the property is missing or empty. Shown in the settings tab. */
    autoFill: string;
}

export const META_FIELDS: MetaFieldDef[] = [
    { id: 'title', label: 'Title', defaultKey: 'title', autoFill: 'Auto-filled with the note name (without .md) when the property is missing.' },
    { id: 'author', label: 'Author', defaultKey: 'author', autoFill: 'Not auto-filled: left blank and left out of the PDF when the property is missing.' },
    { id: 'subject', label: 'Subject', defaultKey: 'subject', autoFill: 'Not auto-filled: left blank and left out of the PDF when the property is missing.' },
    { id: 'keywords', label: 'Keywords', defaultKey: 'keywords', autoFill: 'Auto-filled with the note\'s tags when the property is missing; blank if the note has no tags.' },
];

/** Fixed fields the plugin always writes. Shown read-only in the settings tab. */
export const META_FIXED_INFO: { label: string; value: string }[] = [
    { label: 'Creator', value: 'Print-Ready PDF Export (fixed text)' },
    { label: 'Creation date', value: 'The time of the export (fixed)' },
];

export const PDF_CREATOR = 'Print-Ready PDF Export';

export interface MetaContext {
    /** Note file name without its extension. */
    basename: string;
    /** The note's tags without the leading #. */
    tags: string[];
    exportedAt: Date;
}

/** The values written to the PDF info dictionary. Blank fields are left out. */
export interface PdfInfo {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator: string;
    creationDate: Date;
}

/** Turns a frontmatter value into plain text; lists are joined with commas. Objects and empty values give ''. */
export function frontmatterText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    if (Array.isArray(value)) {
        return value
            .map(v => (typeof v === 'object' && v !== null && !(v instanceof Date) ? '' : frontmatterText(v)))
            .filter(s => s !== '')
            .join(', ');
    }
    return '';
}

/** Reads a frontmatter property, exact name first, then ignoring case. */
export function lookupProperty(fm: Record<string, unknown> | null | undefined, key: string): unknown {
    if (!fm || key === '') return undefined;
    if (key in fm) return fm[key];
    const lower = key.toLowerCase();
    for (const k of Object.keys(fm)) if (k.toLowerCase() === lower) return fm[k];
    return undefined;
}

/** The property name to read for a field: the user's choice, or the default when empty. */
export function metadataKey(keys: Partial<Record<MetaFieldId, string>>, field: MetaFieldDef): string {
    const k = (keys[field.id] ?? '').trim();
    return k === '' ? field.defaultKey : k;
}

function stripHash(tag: string): string {
    return tag.trim().replace(/^#/, '');
}

export function resolveMetadata(
    fm: Record<string, unknown> | null | undefined,
    keys: Partial<Record<MetaFieldId, string>>,
    ctx: MetaContext,
): PdfInfo {
    const read = (field: MetaFieldDef): string => frontmatterText(lookupProperty(fm, metadataKey(keys, field)));
    const byId = (id: MetaFieldId): MetaFieldDef => META_FIELDS.find(f => f.id === id) as MetaFieldDef;

    const title = read(byId('title')) || ctx.basename;
    const author = read(byId('author'));
    const subject = read(byId('subject'));
    const keywordsField = byId('keywords');
    let keywords = read(keywordsField);
    // Tags written with # signs read the same as without.
    if (keywords !== '') keywords = keywords.split(', ').map(stripHash).join(', ');
    if (keywords === '') keywords = ctx.tags.map(stripHash).filter(t => t !== '').join(', ');

    const info: PdfInfo = { creator: PDF_CREATOR, creationDate: ctx.exportedAt };
    if (title) info.title = title;
    if (author) info.author = author;
    if (subject) info.subject = subject;
    if (keywords) info.keywords = keywords;
    return info;
}
