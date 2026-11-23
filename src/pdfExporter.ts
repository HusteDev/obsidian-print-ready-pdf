import { formatPageNumber } from './pageNumbers';
import type { GridCell, PdfDocDef, PdfNode, PdfOut, PdfPageSize, PdfTableHost } from './pdfTypes';
import { App, Notice, TFile, normalizePath } from 'obsidian';
import {
    CalloutNode, ContentNode, ExportMode, ImageNode, MathNode, InlineSpan, ListNode, PDFMakeSettings,
    TableNode,
} from './types';
import { DomExtractor, cleanText, walkNodes } from './domExtractor';
import { ImageLoader } from './images';
import { renderNote, protectPageBreaks } from './noteRenderer';
import { scanMath } from './mathSource';
import { ExportProgress, yieldToUI } from './progress';
import { applyFallbackFonts, FallbackResult } from './fallbackFonts';

// pdfmake and its font data are large; load them only when an export runs so
// they don't slow down Obsidian startup.
//
// pdfmake 0.2's getBuffer() has no error callback: a failure inside its
// font/layout promise chain becomes an unhandled rejection and the callback
// simply never fires. While a render runs we listen for unhandled rejections,
// but claim ONLY those that originate in pdfmake/pdfkit/this plugin; other
// plugins' errors are left alone and cannot abort the export. A timeout covers
// failures that carry no recognisable stack.
const RENDER_TIMEOUT_MS = 60_000;
const OWN_ERROR_RE = /pdfmake|pdfkit|fontkit|print-ready-pdf/i;

function isOurRejection(reason: unknown): boolean {
    const stack = reason instanceof Error ? `${reason.stack ?? ''} ${reason.message}` : String(reason);
    return OWN_ERROR_RE.test(stack);
}

async function renderPdf(docDef: PdfDocDef, extra?: FallbackResult | null): Promise<Uint8Array> {
    const [{ default: pdfMake }, { FONTS, FONT_VFS }] = await Promise.all([
        import('pdfmake/build/pdfmake'),
        import('./fonts'),
    ]);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            window.removeEventListener('unhandledrejection', onRejection);
            fn();
        };
        const onRejection = (ev: PromiseRejectionEvent) => {
            if (!isOurRejection(ev.reason)) return;
            ev.preventDefault();
            const reason: unknown = ev.reason;
            finish(() => reject(reason instanceof Error ? reason : new Error(String(reason))));
        };
        const timer = window.setTimeout(
            () => finish(() => reject(new Error(`PDF rendering timed out after ${RENDER_TIMEOUT_MS / 1000}s`))),
            RENDER_TIMEOUT_MS,
        );
        window.addEventListener('unhandledrejection', onRejection);

        try {
            pdfMake
                .createPdf(docDef, null, { ...FONTS, ...(extra?.fonts ?? {}) }, { ...FONT_VFS, ...(extra?.vfs ?? {}) })
                .getBuffer((buffer: Uint8Array) => finish(() => resolve(buffer)));
        } catch (err) {
            finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
    });
}

// ── Style definitions ─────────────────────────────────────────────────────────

const PRINT_STYLES = {
    h1: { fontSize: 24, bold: true, marginTop: 16, marginBottom: 8 },
    h2: { fontSize: 20, bold: true, marginTop: 14, marginBottom: 7 },
    h3: { fontSize: 17, bold: true, marginTop: 12, marginBottom: 6 },
    h4: { fontSize: 15, bold: true, marginTop: 10, marginBottom: 5 },
    h5: { fontSize: 13, bold: true, marginTop: 8,  marginBottom: 4 },
    h6: { fontSize: 12, bold: true, italics: true, marginTop: 6, marginBottom: 3 },
    blockquote: { italics: true, color: '#555555', marginLeft: 20, marginTop: 4, marginBottom: 4 },
    calloutTitle: { bold: true, fontSize: 13, marginBottom: 4 },
    tableHeader: { bold: true },
    pageFooter: { fontSize: 9, color: '#777777', alignment: 'center' as const },
};

// Preserve formatting on a white page: Obsidian-like heading sizes and accent
// colours, but dark text on white so it prints normally.
const PRESERVE_LIGHT_STYLES = {
    h1: { fontSize: 26, bold: true, color: '#111111', marginTop: 16, marginBottom: 8 },
    h2: { fontSize: 22, bold: true, color: '#111111', marginTop: 14, marginBottom: 7 },
    h3: { fontSize: 19, bold: true, color: '#111111', marginTop: 12, marginBottom: 6 },
    h4: { fontSize: 16, bold: true, color: '#111111', marginTop: 10, marginBottom: 5 },
    h5: { fontSize: 14, bold: true, color: '#111111', marginTop: 8,  marginBottom: 4 },
    h6: { fontSize: 12, bold: true, italics: true, color: '#111111', marginTop: 6, marginBottom: 3 },
    blockquote: { italics: true, color: '#555555', marginLeft: 20, marginTop: 4, marginBottom: 4 },
    calloutTitle: { bold: true, fontSize: 13, marginBottom: 4 },
    tableHeader: { bold: true, color: '#1d4ed8' },
    pageFooter: { fontSize: 9, color: '#777777', alignment: 'center' as const },
};

const PRESERVE_DARK_STYLES = {
    h1: { fontSize: 26, bold: true, color: '#dcddde', marginTop: 16, marginBottom: 8 },
    h2: { fontSize: 22, bold: true, color: '#dcddde', marginTop: 14, marginBottom: 7 },
    h3: { fontSize: 19, bold: true, color: '#dcddde', marginTop: 12, marginBottom: 6 },
    h4: { fontSize: 16, bold: true, color: '#dcddde', marginTop: 10, marginBottom: 5 },
    h5: { fontSize: 14, bold: true, color: '#dcddde', marginTop: 8,  marginBottom: 4 },
    h6: { fontSize: 12, bold: true, italics: true, color: '#dcddde', marginTop: 6, marginBottom: 3 },
    blockquote: { italics: true, color: '#8b949e', marginLeft: 20, marginTop: 4, marginBottom: 4 },
    calloutTitle: { bold: true, fontSize: 13, marginBottom: 4 },
    tableHeader: { bold: true, color: '#58a6ff' },
    pageFooter: { fontSize: 9, color: '#888888', alignment: 'center' as const },
};

// ── Callout accent colors (shared between modes) ──────────────────────────────

const CALLOUT_COLORS: Record<string, string> = {
    note: '#0ea5e9',     info: '#0ea5e9',
    tip: '#14b8a6',      hint: '#14b8a6',
    warning: '#f59e0b',  caution: '#f59e0b',
    danger: '#ef4444',   error: '#ef4444',
    success: '#22c55e',  check: '#22c55e',  done: '#22c55e',
    question: '#a78bfa', help: '#a78bfa',   faq: '#a78bfa',
    quote: '#94a3b8',    cite: '#94a3b8',
    abstract: '#38bdf8', summary: '#38bdf8', tldr: '#38bdf8',
    example: '#f97316',
    todo: '#a78bfa',
    bug: '#ef4444',
};


// Aliases Obsidian ships that the base palette above lacks (used only when the
// theme's own --callout-color could not be read).
const CALLOUT_ALIASES: Record<string, string> = {
    attention: 'warning', failure: 'danger', fail: 'danger', missing: 'danger',
};

// ── Layout geometry ───────────────────────────────────────────────────────────

// Portrait [width, height] in points, as pdfmake defines them.
const PAGE_DIMENSIONS: Record<string, [number, number]> = {
    LETTER:  [612, 792],
    A4:      [595.28, 841.89],
    LEGAL:   [612, 1008],
    TABLOID: [792, 1224],
    A3:      [841.89, 1190.55],
    A5:      [419.53, 595.28],
};

// Courier is monospaced: every glyph advances exactly 600/1000 em.
const COURIER_ADVANCE_EM = 0.6;
// Obsidian's default tab width; pdfkit has no tab stops, so expand tabs first.
const TAB_SPACES = '    ';
// Code blocks are split into rows of this many lines so long blocks can break across pages.
const CODE_ROW_LINES = 25;

// Horizontal space a code block's frame consumes around the text:
// cell text margin (8 + 8) + pdfmake's default cell padding (4 + 4) + borders (0.5 + 0.5).
const CODE_BLOCK_CHROME = 8 + 8 + 4 + 4 + 0.5 + 0.5;
// Callout frame: accent column (4) + inner margins (10 + 8).
const CALLOUT_CHROME = 4 + 10 + 8;
// Blockquote frame: bar (3) + inner margins (10 + 0).
const QUOTE_CHROME = 3 + 10;
// Bullet/number gutter pdfmake reserves for list markers.
const LIST_INDENT = 20;

/** Rendering context threaded through node conversion. */
interface RC {
    mode: ExportMode;
    fontSize: number;
    availWidth: number;
    /** Inside a list item or table cell: tighter paragraph spacing. */
    tight?: boolean;
}

const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function hexToRgb(hex: string): [number, number, number] | null {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend `color` over `base` at `alpha` (what a translucent callout background looks like). */
function mixHex(color: string, base: string, alpha: number): string {
    const c = hexToRgb(color);
    const b = hexToRgb(base);
    if (!c || !b) return base;
    const h = (i: number) => Math.round(c[i] * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0');
    return `#${h(0)}${h(1)}${h(2)}`;
}

// ── Exporter class ────────────────────────────────────────────────────────────

export class PDFExporter {
    private images: ImageLoader;

    constructor(
        private app: App,
        private settings: PDFMakeSettings,
        private isCancelled: () => boolean = () => false,
    ) {
        this.images = new ImageLoader(app);
    }

    async exportNote(markdown: string, file: TFile, mode: ExportMode, progress?: ExportProgress): Promise<void> {
        await progress?.set('Rendering note…');
        const source = this.settings.pageBreakSyntax === 'callout' ? markdown : protectPageBreaks(markdown);
        const rendered = await renderNote(this.app, source, file.path, this.contentWidth() * 96 / 72);
        let nodes: ContentNode[];
        try {
            nodes = new DomExtractor({ pageBreakSyntax: this.settings.pageBreakSyntax, mathSources: scanMath(source) }).extract(rendered.el);
        } finally {
            rendered.dispose();
        }
        this.checkCancelled();
        await this.resolveImages(nodes, file.path, progress);
        await this.resolveMath(nodes, progress);
        this.checkCancelled();

        await progress?.set('Building PDF… (the app may pause briefly)');
        let buffer: Uint8Array;
        try {
            buffer = await this.render(nodes, mode);
        } catch (err) {
            if (!this.hasEmbeddedImages(nodes)) throw err;
            // An image pdfkit can't decode aborts the whole render; retry with
            // placeholders instead of failing the export.
            console.warn('[Print-Ready PDF] Render failed with images, retrying without them', err);
            this.stripImages(nodes);
            new Notice('An image could not be embedded; exporting with placeholders.');
            await yieldToUI();
            buffer = await this.render(nodes, mode);
        }
        this.checkCancelled();
        await progress?.set('Saving PDF…');
        await this.saveBuffer(buffer, file, mode);
    }

    private checkCancelled(): void {
        if (this.isCancelled()) throw new Error('Export cancelled');
    }

    private async render(nodes: ContentNode[], mode: ExportMode): Promise<Uint8Array> {
        const docDef = this.buildDocDef(nodes, mode);
        const fallback = await applyFallbackFonts(this.app, docDef, this.settings.fallbackFonts);
        if (fallback?.warnings.length) {
            for (const w of fallback.warnings) console.warn('[Print-Ready PDF]', w);
            new Notice(fallback.warnings.join('\n'), 10000);
        }
        return renderPdf(docDef, fallback);
    }

    private buildDocDef(nodes: ContentNode[], mode: ExportMode): PdfDocDef {
        const dark = this.isDark(mode);
        const styles = dark ? PRESERVE_DARK_STYLES : mode === 'preserve' ? PRESERVE_LIGHT_STYLES : PRINT_STYLES;
        const defaultColor = dark ? '#dcddde' : '#111111';
        const { marginTop, marginRight, marginBottom, marginLeft, baseFontSize } = this.settings;

        this.imageDict.clear();
        const content = this.blocksToContent(nodes, { mode, fontSize: baseFontSize, availWidth: this.contentWidth() });
        // One XObject per distinct image, however many times it is used.
        const images: Record<string, string> = {};
        this.imageDict.forEach((key, url) => { images[key] = url; });

        return {
            content,
            ...(this.imageDict.size ? { images } : {}),
            styles,
            defaultStyle: {
                font: 'Helvetica',
                fontSize: baseFontSize,
                color: defaultColor,
                lineHeight: 1.45,
            },
            pageSize: this.settings.pageSize,
            pageOrientation: this.settings.pageOrientation,
            pageMargins: [marginLeft, marginTop, marginRight, marginBottom],
            ...(dark ? {
                background: (_page: number, pageSize: PdfPageSize) => ({
                    canvas: [{
                        type: 'rect',
                        x: 0, y: 0,
                        w: pageSize.width,
                        h: pageSize.height,
                        color: '#1e1e1e',
                    }],
                }),
            } : {}),
            ...(this.settings.includePageNumbers ? {
                footer: (currentPage: number, pageCount: number) => ({
                    text: formatPageNumber(this.settings.pageNumberFormat, currentPage, pageCount),
                    style: 'pageFooter',
                    alignment: this.settings.pageNumberAlign,
                    margin: [marginLeft, 8, marginRight, 0],
                }),
            } : {}),
        };
    }

    /** Only Preserve mode with the explicit dark-page opt-in renders a dark page. */
    /** Print mode renders all text in black and white unless 'print in color' is on. */
    private isBw(mode: ExportMode): boolean {
        return mode === 'print' && !this.settings.printInColor;
    }

    private isDark(mode: ExportMode): boolean {
        return mode === 'preserve' && this.settings.preserveDarkPage;
    }

    // ── Output ───────────────────────────────────────────────────────────────

    private async ensureFolder(folder: string): Promise<void> {
        const vault = this.app.vault;
        let current = '';
        for (const part of folder.split('/').filter(Boolean)) {
            current = current ? `${current}/${part}` : part;
            if (!vault.getAbstractFileByPath(current)) {
                await vault.createFolder(current);
            }
        }
    }

    private async saveBuffer(buffer: Uint8Array, source: TFile, mode: ExportMode): Promise<void> {
        const vault = this.app.vault;
        const folder = this.settings.outputFolder
            ? normalizePath(this.settings.outputFolder)
            : (source.parent?.path ?? '');
        const cleanFolder = folder === '/' ? '' : folder;
        if (cleanFolder) await this.ensureFolder(cleanFolder);

        // Never overwrite an existing file: add " (1)", " (2)", … instead.
        const prefix = cleanFolder ? `${cleanFolder}/` : '';
        const stem = `${source.basename}-${mode}`;
        let outputPath = normalizePath(`${prefix}${stem}.pdf`);
        for (let n = 1; vault.getAbstractFileByPath(outputPath); n++) {
            outputPath = normalizePath(`${prefix}${stem} (${n}).pdf`);
        }

        // Avoid duplicating a multi-MB PDF in memory when the view already spans the whole buffer.
        const data = (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
            ? buffer.buffer
            : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) as ArrayBuffer;
        await vault.createBinary(outputPath, data);
        new Notice(`PDF saved → ${outputPath}`);
    }

    // ── Images ───────────────────────────────────────────────────────────────

    private collectImages(nodes: ContentNode[]): ImageNode[] {
        const found: ImageNode[] = [];
        walkNodes(nodes, n => { if (n.type === 'image') found.push(n); });
        return found;
    }

    /** Typeset display math to SVG. Anything MathJax rejects keeps its TeX source as a visible fallback. */
    private async resolveMath(nodes: ContentNode[], progress?: ExportProgress): Promise<void> {
        const maths: MathNode[] = [];
        walkNodes(nodes, n => { if (n.type === 'math') maths.push(n); });
        if (!maths.length) return;
        await progress?.set('Typesetting math…');
        let typeset: typeof import('./math').typesetMath;
        try {
            typeset = (await import('./math')).typesetMath;
        } catch (err) {
            console.warn('[Print-Ready PDF] Math engine failed to load', err);
            return;
        }
        for (const m of maths) {
            try {
                const r = typeset(m.tex, true);
                if (r) { m.svg = r.svg; m.widthEx = r.widthEx; m.heightEx = r.heightEx; }
            } catch (err) {
                console.warn('[Print-Ready PDF] Could not typeset formula', m.tex, err);
            }
        }
    }

    private hasEmbeddedImages(nodes: ContentNode[]): boolean {
        return this.collectImages(nodes).some(i => i.dataUrl);
    }

    private stripImages(nodes: ContentNode[]): void {
        for (const img of this.collectImages(nodes)) {
            if (img.dataUrl) {
                delete img.dataUrl;
                img.unresolvedReason = 'could not be embedded';
            }
        }
    }

    private async resolveImages(nodes: ContentNode[], sourcePath: string, progress?: ExportProgress): Promise<void> {
        const images = this.collectImages(nodes);
        for (let i = 0; i < images.length; i++) {
            await progress?.set(`Loading images (${i + 1}/${images.length})…`);
            await this.images.load(images[i], sourcePath);
            // Decoding and re-encoding are synchronous; free the thread between images.
            await yieldToUI();
        }
    }

    private imageDict = new Map<string, string>();

    private imageRef(dataUrl: string): string {
        let key = this.imageDict.get(dataUrl);
        if (!key) {
            key = `img${this.imageDict.size}`;
            this.imageDict.set(dataUrl, key);
        }
        return key;
    }

    private imageToContent(node: ImageNode, rc: RC): PdfNode {
        if (!node.dataUrl) {
            return {
                text: `[Image not embedded: ${node.alt || node.src || 'image'}${node.unresolvedReason ? ` (${node.unresolvedReason})` : ''}]`,
                italics: true,
                color: !this.isDark(rc.mode) ? '#999999' : '#666666',
                marginBottom: 4,
                alignment: node.align,
            };
        }
        const [pw, ph] = PAGE_DIMENSIONS[this.settings.pageSize] ?? PAGE_DIMENSIONS.LETTER;
        const pageHeight = this.settings.pageOrientation === 'landscape' ? pw : ph;
        const maxHeight = pageHeight - this.settings.marginTop - this.settings.marginBottom - 24;
        const avail = Math.max(10, rc.availWidth);
        const base = { image: this.imageRef(node.dataUrl), marginBottom: 6, alignment: node.align };

        const { naturalWidth: nw, naturalHeight: nh } = node;
        // Obsidian sizes are CSS pixels; PDF points are 0.75 px.
        let w: number | undefined = node.widthPct ? avail * node.widthPct / 100
            : node.width !== undefined ? node.width * 0.75
            : nw ? nw * 0.75 : undefined;
        let h: number | undefined = node.height !== undefined ? node.height * 0.75 : undefined;
        if (w === undefined && h !== undefined && nw && nh) w = h * nw / nh;
        if (w === undefined) return { ...base, fit: [avail, maxHeight] };
        if (h === undefined) h = nw && nh ? w * nh / nw : undefined;
        if (h === undefined) return { ...base, fit: [avail, maxHeight] };

        const scale = Math.min(1, avail / w, maxHeight / h);
        return { ...base, width: w * scale, height: h * scale };
    }

    // ── Geometry helpers ─────────────────────────────────────────────────────

    /** Width of the page's text area in points (page width minus side margins). */
    private contentWidth(): number {
        const [w, h] = PAGE_DIMENSIONS[this.settings.pageSize] ?? PAGE_DIMENSIONS.LETTER;
        const pageWidth = this.settings.pageOrientation === 'landscape' ? h : w;
        return pageWidth - this.settings.marginLeft - this.settings.marginRight;
    }

    /**
     * Font size for a code block. Starts at the normal code size and, when
     * shrink-to-fit is on, steps down just enough that the longest line fits on
     * one line inside the block, but never below the configured minimum (lines
     * that still don't fit then wrap as before).
     */
    private codeFontSize(code: string, fontSize: number, availWidth: number): number {
        const normal = Math.max(8, fontSize - 2);
        if (!this.settings.codeShrinkToFit) return normal;

        const longest = Math.max(0, ...code.split('\n').map(l => l.trimEnd().length));
        if (longest === 0) return normal;

        const textWidth = availWidth - CODE_BLOCK_CHROME;
        // Small safety margin so rounding inside pdfkit never tips a line over.
        const fit = (textWidth - 0.5) / (longest * COURIER_ADVANCE_EM);
        const floor = Math.min(normal, this.settings.codeMinFontSize);
        const size = Math.min(normal, Math.max(floor, fit));
        return Math.floor(size * 10) / 10;
    }

    // ── Node → pdfmake content ───────────────────────────────────────────────

    private blocksToContent(nodes: ContentNode[], rc: RC): PdfNode[] {
        const out: PdfNode[] = [];
        for (const n of nodes) out.push(...asArray(this.nodeToContent(n, rc)));
        return out;
    }

    /** A row-based accent frame (callouts, blockquotes): one row per block so it can split across pages. */
    private framedRows(rows: { content: PdfNode; margin: number[] }[], accent: string, barWidth: number, fill: string | null): PdfNode {
        return {
            table: {
                widths: [barWidth, '*'],
                body: rows.map(r => [
                    { text: '', border: [false, false, false, false] },
                    { stack: asArray(r.content), margin: r.margin },
                ]),
            },
            layout: {
                fillColor: (_row: number, _node: unknown, col: number) => (col === 0 ? accent : fill),
                hLineWidth: () => 0,
                vLineWidth: () => 0,
                paddingLeft: () => 0,
                paddingRight: () => 0,
                paddingTop: () => 0,
                paddingBottom: () => 0,
            },
            marginBottom: 8,
            marginTop: 4,
        };
    }

    private nodeToContent(node: ContentNode, rc: RC): PdfOut {
        const { mode, fontSize, availWidth } = rc;
        switch (node.type) {
            case 'heading':
                return {
                    text: this.spansToInline(node.content, rc),
                    style: `h${node.level}`,
                    tocItem: node.level <= 3,
                    alignment: node.align,
                    ...(node.id ? { id: node.id } : {}),
                };

            case 'paragraph':
                return {
                    text: this.spansToInline(node.content, rc),
                    marginBottom: rc.tight ? 2 : 6,
                    alignment: node.align,
                };

            case 'placeholder':
                return {
                    text: node.text,
                    italics: true,
                    color: !this.isDark(mode) ? '#888888' : '#777777',
                    marginBottom: 6,
                };

            case 'code_block': {
                const codeColor  = !this.isDark(mode) ? '#1a1a1a' : '#abb2bf';
                const codeBg     = !this.isDark(mode) ? '#f7f7f7' : '#282c34';
                const borderCol  = !this.isDark(mode) ? '#dddddd' : '#3e4451';
                const code       = node.code.replace(/\t/g, TAB_SPACES);
                const size       = this.codeFontSize(code, fontSize, availWidth);
                // Courier is fixed-width, so a line that cannot fit can be wrapped exactly.
                const maxCols    = Math.max(4, Math.floor((availWidth - CODE_BLOCK_CHROME - 0.5) / (size * COURIER_ADVANCE_EM)));
                const lines      = code.split('\n').map(l =>
                    new RegExp(`\\S{${maxCols + 1},}`).test(l) ? chunkString(l, maxCols).join('\n') : l);
                const chunks: string[] = [];
                for (let i = 0; i < lines.length; i += CODE_ROW_LINES) {
                    chunks.push(lines.slice(i, i + CODE_ROW_LINES).join('\n'));
                }
                const label = this.settings.showCodeLanguage ? cleanText(node.language.trim()) : '';
                const body: PdfNode[][] = [];
                const dark = this.isDark(mode);
                const barBg = dark ? '#3b414d' : (this.isBw(mode) ? '#e0e0e0' : '#e4e6ea');
                let barFg = dark ? '#f5f5f5' : (this.isBw(mode) ? '#000000' : '#111111');
                if (!hasContrast(barFg, barBg)) barFg = dark ? '#ffffff' : '#000000';
                if (label) {
                    body.push([{
                        text: label,
                        font: 'Courier',
                        bold: true,
                        fontSize: 9,
                        // The document's 1.45 line height would add dead space below the glyphs.
                        lineHeight: 1,
                        color: barFg,
                        margin: [8, 0, 8, 0],
                    }]);
                }
                chunks.forEach((text, i) => body.push([{
                    text: text === '' ? ' ' : text,
                    font: 'Courier',
                    fontSize: size,
                    color: codeColor,
                    margin: [8, i === 0 ? 6 : 0, 8, i === chunks.length - 1 ? 6 : 0],
                    preserveLeadingSpaces: true,
                }]));
                return {
                    table: label ? { widths: ['*'], body, headerRows: 1, keepWithHeaderRows: 1 } : { widths: ['*'], body },
                    layout: {
                        fillColor: (i: number) => (label && i === 0 ? barBg : codeBg),
                        // Rules only around the whole block, not between row chunks.
                        hLineWidth: (i: number, n: PdfTableHost) => (i === 0 || i === n.table.body.length || (label && i === 1) ? 0.5 : 0),
                        vLineWidth: () => 0.5,
                        hLineColor: () => borderCol,
                        vLineColor: () => borderCol,
                        paddingTop: (i: number) => (i === 0 ? (label ? 3.5 : 4) : 0),
                        paddingBottom: (i: number, n: PdfTableHost) => (i === n.table.body.length - 1 ? 4 : (label && i === 0 ? 2.5 : 0)),
                    },
                    marginBottom: 8,
                    marginTop: 2,
                };
            }

            case 'list':
                return this.listToContent(node, rc, rc.tight ? 2 : 6);

            case 'blockquote': {
                const inner = { ...rc, availWidth: availWidth - QUOTE_CHROME, tight: false };
                const bar = !this.isDark(mode) ? '#c4c4c4' : '#555555';
                const rows = this.blocksToContent(node.content, inner)
                    .map(content => ({ content, margin: [10, 0, 0, 0] }));
                if (!rows.length) return null;
                return this.framedRows(rows, bar, 3, null);
            }

            case 'callout':
                return this.calloutToContent(node, rc);

            case 'table':
                return this.tableToContent(node, rc);

            case 'math': {
                if (!node.svg || !node.widthEx || !node.heightEx) {
                    // Could not typeset: show the source rather than dropping the formula.
                    return {
                        text: node.fallback, font: 'Courier', fontSize: Math.max(8, fontSize - 2),
                        alignment: 'center', marginTop: 2, marginBottom: 8,
                    };
                }
                const exPt = fontSize / 2; // MathJax's ex is half an em
                let w = node.widthEx * exPt;
                let h = node.heightEx * exPt;
                if (w > availWidth) { h *= availWidth / w; w = availWidth; }
                const color = this.isDark(mode) ? '#dcddde' : mode === 'print' ? '#000000' : '#111111';
                return {
                    svg: node.svg.replace(/currentColor/g, color),
                    width: w, height: h, alignment: 'center', marginTop: 4, marginBottom: 8,
                };
            }

            case 'page_break':
                return { text: '', pageBreak: 'before' };

            case 'horizontal_rule': {
                const lineColor = !this.isDark(mode) ? '#cccccc' : '#444444';
                return {
                    canvas: [{
                        type: 'line',
                        x1: 0, y1: 4, x2: availWidth, y2: 4,
                        lineWidth: 0.5,
                        lineColor,
                    }],
                    marginTop: 8,
                    marginBottom: 8,
                };
            }

            case 'image':
                return this.imageToContent(node, rc);

            default:
                return null;
        }
    }

    private calloutToContent(node: CalloutNode, rc: RC): PdfNode[] {
        const dark = this.isDark(rc.mode);
        const type = CALLOUT_ALIASES[node.calloutType] ?? node.calloutType;
        // Print mode is greyscale: no hue anywhere, so it reproduces on a mono printer.
        const bw = this.isBw(rc.mode);
        const accent = bw ? '#555555' : (node.color ?? CALLOUT_COLORS[type] ?? '#6366f1');
        const bodyBg = bw ? '#f4f4f4' : mixHex(accent, dark ? '#1e1e1e' : '#ffffff', dark ? 0.12 : 0.1);
        const inner: RC = { ...rc, availWidth: rc.availWidth - CALLOUT_CHROME, tight: false };

        // A page break inside a callout splits it into separate frames.
        const segments: ContentNode[][] = [[]];
        for (const child of node.content) {
            if (child.type === 'page_break') segments.push([]);
            else segments[segments.length - 1].push(child);
        }

        const out: PdfNode[] = [];
        segments.forEach((segment, si) => {
            const rows: { content: PdfNode; margin: number[] }[] = [];
            if (si === 0) {
                rows.push({
                    content: { text: this.spansToInline(node.title, inner), style: 'calloutTitle', color: bw ? undefined : accent },
                    margin: [10, 6, 8, segment.length ? 2 : 6],
                });
            }
            segment.forEach(child => {
                for (const c of asArray(this.nodeToContent(child, inner))) {
                    rows.push({ content: c, margin: [10, 2, 8, 2] });
                }
            });
            if (!rows.length) return;
            const last = rows[rows.length - 1];
            if (si > 0 || rows.length > 1) last.margin = [10, last.margin[1], 8, 6];
            if (si > 0) out.push({ text: '', pageBreak: 'before' });
            out.push(this.framedRows(rows, accent, 4, bodyBg));
        });
        return out;
    }

    /**
     * Column widths that always fit the page. pdfmake's 'auto' sizes a column to
     * its longest word and never shrinks it, so wide tables ran off the page.
     * Each column wants its widest cell (capped) but needs at least its longest
     * word; spare space is shared out in proportion to what columns want.
     */
    private columnWidths(grid: (GridCell | undefined)[][], cols: number, rc: RC, fontSize: number, pad: number): { widths: number[]; fits: boolean; needSum: number } {
        const charW = fontSize * 0.7; // wide enough for capitals and digits in bold
        const want = Array<number>(cols).fill(0);
        const need = Array<number>(cols).fill(0);
        for (const row of grid) {
            for (let c = 0; c < cols; c++) {
                const g = row[c];
                if (!g || g.placeholder || g.colSpan > 1) continue;
                const text = nodesText(g.cell.content);
                const longestWord = Math.max(0, ...text.split(/\s+/).map(w => w.length));
                const longestLine = Math.max(0, ...text.split('\n').map(l => l.length));
                want[c] = Math.max(want[c], Math.min(longestLine, 60) * charW);
                need[c] = Math.max(need[c], Math.min(longestWord, 12) * charW);
            }
        }
        // pdfmake adds cell padding on top of numeric widths and draws 0.5pt rules between columns.
        const total = Math.max(40, rc.availWidth - 1 - 0.5 * (cols + 1));
        const needSum = need.reduce((a, b) => a + b, 0);
        const w = want.map((v, c) => Math.max(v, need[c]) + pad);
        const min = need.map(v => v + pad);
        const sumW = w.reduce((a, b) => a + b, 0);
        if (sumW <= total) return { widths: w, fits: true, needSum };
        const sumMin = min.reduce((a, b) => a + b, 0);
        if (sumMin >= total) {
            const k = total / sumMin; // even the minimums do not fit: shrink all and let words break
            return { widths: min.map(v => Math.max(pad + 4, v * k)), fits: false, needSum };
        }
        const spare = total - sumMin;
        const extra = w.map((v, c) => v - min[c]);
        const sumExtra = extra.reduce((a, b) => a + b, 0) || 1;
        return { widths: min.map((v, c) => v + spare * extra[c] / sumExtra), fits: true, needSum };
    }

    private tableToContent(node: TableNode, rc: RC): PdfNode {
        const { mode } = rc;
        const headerBg = !this.isDark(mode) ? '#eeeeee' : '#2d333b';
        const borderCol = !this.isDark(mode) ? '#cccccc' : '#444c56';

        // Lay cells on a grid so colSpan/rowSpan placeholders line up.
        const grid: (GridCell | undefined)[][] = [];
        node.rows.forEach((row, r) => {
            grid[r] = grid[r] ?? [];
            let c = 0;
            for (const cell of row) {
                while (grid[r][c] !== undefined) c++;
                const rowSpan = Math.min(cell.rowSpan, node.rows.length - r);
                grid[r][c] = { cell, colSpan: cell.colSpan, rowSpan };
                for (let dr = 0; dr < rowSpan; dr++) {
                    grid[r + dr] = grid[r + dr] ?? [];
                    for (let dc = 0; dc < cell.colSpan; dc++) {
                        if (dr || dc) grid[r + dr][c + dc] = { placeholder: true };
                    }
                }
                c += cell.colSpan;
            }
        });
        const cols = Math.max(1, ...grid.map(r => r.length));
        let fs = rc.fontSize;
        let cellPad = 16;      // padding 4+4 plus cell margins 4+4
        let layoutPad = 4;     // pdfmake cell padding, each side
        let cellMargin = 4;
        let { widths, fits, needSum } = this.columnWidths(grid, cols, rc, fs, cellPad);
        if (!fits) {
            // Too many columns for the page at normal size: shrink text and padding to fit.
            layoutPad = 1; cellMargin = 2; cellPad = 6;
            const total = Math.max(40, rc.availWidth - 1 - 0.5 * (cols + 1));
            const scale = Math.max(0.4, Math.min(1, (total - cols * cellPad) / (needSum || 1)));
            fs = Math.max(4, rc.fontSize * scale);
            widths = this.columnWidths(grid, cols, rc, fs, cellPad).widths;
        }

        const body = grid.map((row, r) => {
            const out: PdfNode[] = [];
            for (let c = 0; c < cols; c++) {
                const g = row[c];
                if (!g) { out.push({ text: '' }); continue; }
                if (g.placeholder) { out.push({}); continue; }
                const cell = g.cell;
                const isHeader = r < node.headerRows || cell.header;
                const span = Math.max(1, g.colSpan);
                let w = 0;
                for (let k = 0; k < span; k++) w += widths[c + k] ?? 0;
                const cellRc: RC = { ...rc, fontSize: fs, availWidth: Math.max(10, w - cellPad), tight: true };
                const nodes = this.blocksToContent(cell.content, cellRc);
                const obj: PdfNode = nodes.length === 1 && nodes[0].text !== undefined && !nodes[0].image
                    ? { ...nodes[0], marginBottom: 0 }
                    : { stack: nodes.length ? nodes : [{ text: '' }] };
                obj.margin = [cellMargin, cellMargin - 1, cellMargin, cellMargin - 1];
                if (fs !== rc.fontSize) obj.fontSize = fs;
                if (cell.align && !obj.alignment) obj.alignment = cell.align;
                if (isHeader) { obj.style = 'tableHeader'; obj.fillColor = headerBg; }
                if (g.colSpan > 1) obj.colSpan = g.colSpan;
                if (g.rowSpan > 1) obj.rowSpan = g.rowSpan;
                out.push(obj);
            }
            return out;
        });

        return {
            table: {
                headerRows: node.headerRows,
                widths: widths.map(v => Math.max(6, v - 2 * layoutPad)),
                body,
            },
            layout: {
                hLineWidth: () => 0.5,
                vLineWidth: () => 0.5,
                hLineColor: () => borderCol,
                vLineColor: () => borderCol,
                paddingLeft: () => layoutPad,
                paddingRight: () => layoutPad,
            },
            marginBottom: 8,
            marginTop: 4,
        };
    }

    private listToContent(list: ListNode, rc: RC, marginBottom: number): PdfNode {
        const hasTasks = list.items.some(it => it.checked !== undefined);
        const accent = !this.isDark(rc.mode) ? '#444444' : '#aaaaaa';
        const inner: RC = { ...rc, availWidth: rc.availWidth - LIST_INDENT, tight: true };

        const items = list.items.map((it, idx) => {
            const nodes = this.blocksToContent(it.content, inner);
            const body = nodes.length === 1 ? nodes[0] : { stack: nodes.length ? nodes : [{ text: '' }] };
            if (!hasTasks) return body;

            // Task lists: draw our own marker (the standard fonts have no ☐ / ☑).
            const box = it.checked === undefined
                ? { text: list.ordered ? `${list.start + idx}.` : '•', width: 14, color: accent }
                : {
                    width: 14,
                    canvas: [
                        { type: 'rect', x: 0, y: 2, w: 9, h: 9, lineWidth: 0.8, lineColor: accent },
                        ...(it.checked ? [{
                            type: 'polyline', closePath: false, lineWidth: 1.3, lineColor: accent,
                            points: [{ x: 1.8, y: 6.5 }, { x: 4, y: 9 }, { x: 7.4, y: 3.6 }],
                        }] : []),
                    ],
                };
            return { columns: [box, { stack: [body], width: '*' }], columnGap: 0 };
        });

        if (hasTasks) return { stack: items, marginBottom, marginLeft: 4 };
        return list.ordered
            ? { ol: items, start: list.start, marginBottom }
            : { ul: items, marginBottom };
    }

    // ── Inline spans → pdfmake text array ────────────────────────────────────

    private spansToInline(spans: InlineSpan[], rc: RC): string | PdfNode[] {
        if (spans.length === 0) return '';
        const { mode, fontSize, availWidth } = rc;
        const dark = this.isDark(mode);
        // Print mode is greyscale by default: author colours, pink code, yellow marks and blue links all drop out.
        const bw = this.isBw(mode);
        const page = dark ? '#1e1e1e' : '#ffffff';

        return spans.map(span => {
            const size = Math.max(5, fontSize * (span.scale ?? 1));
            const codeSize = Math.max(8, size - 2);
            const obj: PdfNode = { text: breakLongTokens(span.text, availWidth, span.monospace ? codeSize : size, !!span.monospace) };
            if (span.bold)        obj.bold = true;
            if (span.italics)     obj.italics = true;
            const deco: string[] = [];
            if (span.underline) deco.push('underline');
            if (span.strikethrough) deco.push('lineThrough');
            if (deco.length) obj.decoration = deco.length === 1 ? deco[0] : deco;
            if (span.scale && span.scale !== 1) obj.fontSize = size;
            if (span.monospace) {
                obj.font      = 'Courier';
                obj.fontSize  = codeSize;
                obj.background = bw ? '#eeeeee' : !dark ? '#f5f5f5' : '#282c34';
                obj.color      = bw ? '#222222' : !dark ? '#c7254e' : '#e06c75';
            }
            if (span.highlight) {
                obj.background = bw ? '#d9d9d9' : '#ffff00';
                obj.color      = '#000000';
            }
            if (!bw) {
                if (span.background && !span.monospace && !span.highlight) obj.background = span.background;
                // Skip author colours that would vanish against the page (e.g. white on white).
                const surface = span.background && !span.monospace && !span.highlight ? span.background : page;
                if (span.color && hasContrast(span.color, surface)) obj.color = span.color;
                else if (surface !== page && luminance(surface) !== null) obj.color = (luminance(surface) as number) > 0.5 ? '#000000' : '#ffffff';
            }
            if (span.linkStyle) {
                if (!bw && !obj.color) obj.color = !dark ? '#0055cc' : '#58a6ff';
                obj.decoration = 'underline';
                if (span.link) obj.link = span.link;
                else if (span.anchor) obj.linkToDestination = span.anchor;
            }
            return obj;
        });
    }
}

// ── Text helpers ──────────────────────────────────────────────────────────────

/** Plain text of content nodes, for sizing estimates only. */
function nodesText(nodes: ContentNode[]): string {
    const spans = (s: InlineSpan[]) => s.map(x => x.text).join('');
    const parts: string[] = [];
    for (const n of nodes) {
        switch (n.type) {
            case 'paragraph': case 'heading': parts.push(spans(n.content)); break;
            case 'code_block': parts.push(n.code); break;
            case 'list': for (const it of n.items) parts.push(nodesText(it.content)); break;
            case 'blockquote': case 'callout': parts.push(nodesText(n.content)); break;
            default: break;
        }
    }
    return parts.join('\n');
}

function luminance(hex: string): number | null {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(v => v / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** False when `color` is too close to the page colour to be readable. */
function hasContrast(color: string, page: string): boolean {
    const a = luminance(color);
    const b = luminance(page);
    if (a === null || b === null) return true;
    return Math.abs(a - b) > 0.25;
}

function chunkString(tok: string, size: number): string[] {
    const chars = Array.from(tok);
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
    return out;
}

/**
 * pdfkit never breaks inside a word, so a URL or hash wider than its box runs
 * past the margin. Insert hard breaks into tokens that clearly cannot fit.
 * Proportional text is estimated (average 0.5em to trigger, 0.8em per chunk).
 */
function breakLongTokens(text: string, avail: number, size: number, mono: boolean): string {
    const maxChars = Math.max(4, Math.floor((avail * 0.97) / (size * (mono ? COURIER_ADVANCE_EM : 0.8))));
    const trigger = mono ? maxChars : Math.max(maxChars, Math.floor(avail / (size * 0.5)));
    if (text.length <= trigger) return text;
    return text.replace(/\S+/g, tok => (tok.length > trigger ? chunkString(tok, maxChars).join('\n') : tok));
}
