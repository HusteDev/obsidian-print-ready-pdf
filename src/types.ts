export type ExportMode = 'preserve' | 'print';
export type PageBreakSyntax = 'triple-equals' | 'callout' | 'both';
export type PageSize = 'LETTER' | 'A4' | 'LEGAL' | 'TABLOID' | 'A3' | 'A5';
export type Orientation = 'portrait' | 'landscape';

export interface PDFMakeSettings {
    pageSize: PageSize;
    pageOrientation: Orientation;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    defaultMode: ExportMode;
    pageBreakSyntax: PageBreakSyntax;
    includePageNumbers: boolean;
    baseFontSize: number;
    codeShrinkToFit: boolean;
    codeMinFontSize: number;
    outputFolder: string;
}

export const DEFAULT_SETTINGS: PDFMakeSettings = {
    pageSize: 'LETTER',
    pageOrientation: 'portrait',
    marginTop: 72,
    marginRight: 72,
    marginBottom: 72,
    marginLeft: 72,
    defaultMode: 'print',
    pageBreakSyntax: 'both',
    includePageNumbers: true,
    baseFontSize: 12,
    codeShrinkToFit: true,
    codeMinFontSize: 6,
    outputFolder: '',
};

// ── Inline spans ──────────────────────────────────────────────────────────────

export interface InlineSpan {
    text: string;
    bold?: boolean;
    italics?: boolean;
    monospace?: boolean;
    strikethrough?: boolean;
    highlight?: boolean;
    link?: string;
    color?: string;
    background?: string;
}

// ── Document node tree ────────────────────────────────────────────────────────

export type ContentNode =
    | HeadingNode
    | ParagraphNode
    | CodeBlockNode
    | ListNode
    | BlockquoteNode
    | CalloutNode
    | TableNode
    | PageBreakNode
    | HorizontalRuleNode
    | ImageNode;

export interface HeadingNode {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    content: InlineSpan[];
}

export interface ParagraphNode {
    type: 'paragraph';
    content: InlineSpan[];
}

export interface CodeBlockNode {
    type: 'code_block';
    language: string;
    code: string;
}

export interface ListItem {
    content: InlineSpan[];
    /** Set for task items (`- [ ]` / `- [x]`). */
    checked?: boolean;
    children: ListNode[];
}

export interface ListNode {
    type: 'list';
    ordered: boolean;
    /** First number of an ordered list. */
    start: number;
    items: ListItem[];
}

export interface BlockquoteNode {
    type: 'blockquote';
    content: ContentNode[];
}

export interface CalloutNode {
    type: 'callout';
    calloutType: string;
    title: string;
    content: ContentNode[];
}

export interface TableNode {
    type: 'table';
    headers: InlineSpan[][];
    rows: InlineSpan[][][];
}

export interface PageBreakNode {
    type: 'page_break';
}

export interface HorizontalRuleNode {
    type: 'horizontal_rule';
}

export interface ImageNode {
    type: 'image';
    alt: string;
    src: string;
    isWikilink: boolean;
    /** Requested width in pixels (`![[a.png|300]]`). */
    width?: number;
    /** Filled in by the exporter once the vault file is read. */
    dataUrl?: string;
    /** Natural size in pixels, when it could be read. */
    naturalWidth?: number;
    naturalHeight?: number;
    /** Set when the source could not be embedded; shown as a placeholder. */
    unresolvedReason?: string;
}
