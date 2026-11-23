import type { TableNode } from './types';

/**
 * A pdfmake content node, table cell or style object. pdfmake accepts many
 * properties; this plugin sets them by name, so the shape is an open record.
 */
export type PdfNode = Record<string, unknown>;

/** What a node renderer returns: one node, several, or nothing. */
export type PdfOut = PdfNode | PdfNode[] | null;

/** The part of a pdfmake document definition that this plugin reads or rewrites. */
export interface PdfDocDef {
    content: PdfNode[];
    defaultStyle?: PdfNode;
    [key: string]: unknown;
}

/** Page size that pdfmake passes to a `background` callback. */
export interface PdfPageSize {
    width: number;
    height: number;
}

/** The table inside a pdfmake layout callback's node argument. */
export interface PdfTableHost {
    table: { body: unknown[] };
}

/** One slot of the table grid used to line up colSpan and rowSpan placeholders. */
export type GridCell =
    | { placeholder: true }
    | { placeholder?: false; cell: TableNode['rows'][number][number]; colSpan: number; rowSpan: number };
