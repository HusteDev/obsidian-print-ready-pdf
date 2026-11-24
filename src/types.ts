export type ExportMode = 'preserve' | 'print';
export type PageBreakSyntax = 'triple-equals' | 'callout' | 'both';
export type PageSize = 'LETTER' | 'A4' | 'LEGAL' | 'TABLOID' | 'A3' | 'A5';
export type Orientation = 'portrait' | 'landscape';
export type PageNumberFormat = 'n' | 'n-of-total' | 'n-slash-total' | 'page-n' | 'page-n-of-total' | 'dash-n-dash';
export type PageNumberAlign = 'left' | 'center' | 'right';
export type BodyFont = 'sans' | 'serif';
/** PDF info fields that can be read from a frontmatter property. */
export type MetaFieldId = 'title' | 'author' | 'subject' | 'keywords';

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
    showCodeLanguage: boolean;
    codeMinFontSize: number;
    outputFolder: string;
    /** Body text font: Helvetica (sans) or Times (serif). Code stays in Courier. */
    bodyFont: BodyFont;
    /** Write the title, author and other info into the PDF. */
    embedMetadata: boolean;
    /** Frontmatter property for each info field; empty means the field's default property. */
    metadataKeys: Record<MetaFieldId, string>;
    includeToc: boolean;
    tocMaxLevel: 1 | 2 | 3;
    tocTitle: string;
    /** Header and footer text with {title}, {date}, {page}, {pages}, {mode}. Empty means none. */
    headerLeft: string;
    headerCenter: string;
    headerRight: string;
    footerLeft: string;
    footerCenter: string;
    footerRight: string;
    pageNumberStart: number;
    hidePageNumberOnFirstPage: boolean;
    /** File name template with {file}, {title}, {date}, {mode}. */
    filenameTemplate: string;
    openAfterExport: boolean;
    showRibbonIcon: boolean;
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
    showCodeLanguage: false,
    codeMinFontSize: 6,
    outputFolder: '',
    bodyFont: 'sans',
    embedMetadata: true,
    metadataKeys: { title: '', author: '', subject: '', keywords: '' },
    includeToc: false,
    tocMaxLevel: 3,
    tocTitle: 'Contents',
    headerLeft: '',
    headerCenter: '',
    headerRight: '',
    footerLeft: '',
    footerCenter: '',
    footerRight: '',
    pageNumberStart: 1,
    hidePageNumberOnFirstPage: false,
    filenameTemplate: '{file}-{mode}',
    openAfterExport: false,
    showRibbonIcon: false,
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
    | MathNode
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

/** Placeholder paragraph text that stands in for a `===` page-break line during rendering. */
export const PAGEBREAK_SENTINEL = 'PRPDF_PAGEBREAK_7f3a';

/** Display math. Typeset to SVG at export time; falls back to showing the source. */
export interface MathNode {
    type: 'math';
    tex: string;
    /** Visible stand-in used when the formula cannot be typeset. */
    fallback: string;
    svg?: string;
    widthEx?: number;
    heightEx?: number;
}
