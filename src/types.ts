export type ExportMode = 'preserve' | 'print';
export type PageBreakSyntax = 'triple-equals' | 'callout' | 'both';
export type PageSize = 'LETTER' | 'A4' | 'LEGAL' | 'TABLOID' | 'A3' | 'A5';
export type Orientation = 'portrait' | 'landscape';
export type PageNumberFormat = 'n' | 'n-of-total' | 'n-slash-total' | 'page-n' | 'page-n-of-total' | 'dash-n-dash';
export type PageNumberAlign = 'left' | 'center' | 'right';

export interface PDFMakeSettings {
    pageSize: PageSize;
    pageOrientation: Orientation;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    defaultMode: ExportMode;
    preserveDarkPage: boolean;
    printInColor: boolean;
    pageBreakSyntax: PageBreakSyntax;
    includePageNumbers: boolean;
    pageNumberFormat: PageNumberFormat;
    pageNumberAlign: PageNumberAlign;
    baseFontSize: number;
    codeShrinkToFit: boolean;
    codeMinFontSize: number;
    outputFolder: string;
    /** Font files (vault path, or absolute path on desktop) used for characters the built-in fonts lack. */
    fallbackFonts: string[];
}

export const DEFAULT_SETTINGS: PDFMakeSettings = {
    pageSize: 'LETTER',
    pageOrientation: 'portrait',
    marginTop: 72,
    marginRight: 72,
    marginBottom: 72,
    marginLeft: 72,
    defaultMode: 'print',
    preserveDarkPage: false,
    printInColor: false,
    pageBreakSyntax: 'both',
    includePageNumbers: true,
    pageNumberFormat: 'n-slash-total',
    pageNumberAlign: 'center',
    baseFontSize: 12,
    codeShrinkToFit: true,
    codeMinFontSize: 6,
    outputFolder: '',
    fallbackFonts: [],
};

// ── Inline spans ──────────────────────────────────────────────────────────────

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface InlineSpan {
    text: string;
    bold?: boolean;
    italics?: boolean;
    underline?: boolean;
    monospace?: boolean;
    strikethrough?: boolean;
    highlight?: boolean;
    /** External target (http, https, mailto). */
    link?: string;
    /** Same-note heading target (matches HeadingNode.id). */
    anchor?: string;
    /** Styled as a link but has no usable target. */
    linkStyle?: boolean;
    color?: string;
    background?: string;
    /** Font size relative to the base size (sub/sup/small/inline font-size). */
    scale?: number;
}

// ── Document node tree (built from Obsidian's rendered reading-view DOM) ──────

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
    | ImageNode
    | PlaceholderNode;

export interface HeadingNode {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    content: InlineSpan[];
    /** Destination id for same-note links. */
    id?: string;
    align?: Align;
}

export interface ParagraphNode {
    type: 'paragraph';
    content: InlineSpan[];
    align?: Align;
}

export interface CodeBlockNode {
    type: 'code_block';
    language: string;
    code: string;
}

export interface ListItem {
    /** Set for task items. */
    checked?: boolean;
    /** Block content: paragraphs, nested lists, code, images, ... */
    content: ContentNode[];
}

export interface ListNode {
    type: 'list';
    ordered: boolean;
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
    title: InlineSpan[];
    /** Accent colour as rendered by the active theme (#rrggbb), when known. */
    color?: string;
    content: ContentNode[];
}

export interface TableCell {
    content: ContentNode[];
    header: boolean;
    colSpan: number;
    rowSpan: number;
    align?: Align;
}

export interface TableNode {
    type: 'table';
    rows: TableCell[][];
    headerRows: number;
}

export interface PageBreakNode {
    type: 'page_break';
}

export interface HorizontalRuleNode {
    type: 'horizontal_rule';
}

/** Stand-in for content that cannot be drawn (PDF/audio/video embeds, ...). */
export interface PlaceholderNode {
    type: 'placeholder';
    text: string;
}

export interface ImageNode {
    type: 'image';
    alt: string;
    /** Vault link path when `vault` is set, otherwise a URL. */
    src: string;
    vault: boolean;
    /** URL Obsidian rendered for the <img>; fallback when the vault file can't be resolved by name. */
    resourceUrl?: string;
    /** Serialized <svg> markup (diagrams); rasterized at load time. */
    svg?: string;
    /** Requested size in CSS pixels. */
    width?: number;
    height?: number;
    /** Requested width as a percentage of the available width. */
    widthPct?: number;
    align?: Align;
    /** Filled in by the image loader. */
    dataUrl?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    /** Set when the source could not be embedded; shown as a placeholder. */
    unresolvedReason?: string;
}
