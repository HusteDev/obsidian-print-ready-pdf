import { App, Notice, TFile, normalizePath } from 'obsidian';
import { ContentNode, InlineSpan, ListNode, ImageNode, PDFMakeSettings, ExportMode } from './types';

// pdfmake and its font data are large; load them only when an export runs so
// they don't slow down Obsidian (especially mobile) startup.
//
// pdfmake 0.2's getBuffer() has no error callback: a failure inside its
// font/layout promise chain becomes an unhandled rejection and the callback
// simply never fires. Catch those while a render is running, and give up after
// a timeout, so the user gets an error notice instead of silence.
const RENDER_TIMEOUT_MS = 60_000;

async function renderPdf(docDef: any): Promise<Uint8Array> {
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
            ev.preventDefault();
            const reason = ev.reason;
            finish(() => reject(reason instanceof Error ? reason : new Error(String(reason))));
        };
        const timer = window.setTimeout(
            () => finish(() => reject(new Error(`PDF rendering timed out after ${RENDER_TIMEOUT_MS / 1000}s`))),
            RENDER_TIMEOUT_MS,
        );
        window.addEventListener('unhandledrejection', onRejection);

        try {
            (pdfMake as any)
                .createPdf(docDef, null, FONTS, FONT_VFS)
                .getBuffer((buffer: Uint8Array) => finish(() => resolve(buffer)));
        } catch (err) {
            finish(() => reject(err));
        }
    });
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function sniffImage(b: Uint8Array): { mime: string; width?: number; height?: number } | null {
    // PNG: signature, then IHDR with big-endian width/height at bytes 16..24.
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return { mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    // JPEG: walk segments to the first start-of-frame marker.
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        let pos = 2;
        while (pos + 9 < b.length) {
            if (b[pos] !== 0xff) { pos++; continue; }
            const marker = b[pos + 1];
            if (marker === 0xff) { pos++; continue; }
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { mime: 'image/jpeg', height: (b[pos + 5] << 8) | b[pos + 6], width: (b[pos + 7] << 8) | b[pos + 8] };
            }
            pos += 2 + ((b[pos + 2] << 8) | b[pos + 3]);
        }
        return { mime: 'image/jpeg' };
    }
    return null;
}

function toBase64(bytes: Uint8Array): string {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    return btoa(bin);
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

const PRESERVE_STYLES = {
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

// Horizontal space a code block's frame consumes around the text:
// cell text margin (8 + 8) + pdfmake's default cell padding (4 + 4) + borders (0.5 + 0.5).
const CODE_BLOCK_CHROME = 8 + 8 + 4 + 4 + 0.5 + 0.5;
// Callout frame: accent column (4) + inner margin (8 + 8).
const CALLOUT_CHROME = 4 + 8 + 8;
// Blockquote left indent from its style.
const BLOCKQUOTE_INDENT = 20;

// ── Exporter class ────────────────────────────────────────────────────────────

export class PDFExporter {
    constructor(
        private app: App,
        private settings: PDFMakeSettings,
    ) {}

    async exportNote(nodes: ContentNode[], file: TFile, mode: ExportMode): Promise<void> {
        await this.resolveImages(nodes, file.path);

        let buffer: Uint8Array;
        try {
            buffer = await renderPdf(this.buildDocDef(nodes, mode));
        } catch (err) {
            if (!this.hasEmbeddedImages(nodes)) throw err;
            // An image pdfkit can't decode (e.g. interlaced PNG) aborts the whole
            // render; retry with placeholders instead of failing the export.
            console.warn('[Print-Ready PDF] Render failed with images, retrying without them', err);
            this.stripImages(nodes);
            new Notice('An image could not be embedded; exporting with placeholders.');
            buffer = await renderPdf(this.buildDocDef(nodes, mode));
        }
        await this.saveBuffer(buffer, file, mode);
    }

    private buildDocDef(nodes: ContentNode[], mode: ExportMode): any {
        const styles = mode === 'print' ? PRINT_STYLES : PRESERVE_STYLES;
        const defaultColor = mode === 'print' ? '#111111' : '#dcddde';
        const { marginTop, marginRight, marginBottom, marginLeft, baseFontSize } = this.settings;

        const content: any[] = nodes
            .map(n => this.nodeToContent(n, styles, mode, baseFontSize, this.contentWidth()))
            .filter(Boolean);

        return {
            content,
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
            ...(mode === 'preserve' ? {
                background: (_page: number, pageSize: any) => ({
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
                    text: `${currentPage} / ${pageCount}`,
                    style: 'pageFooter',
                    margin: [0, 8, 0, 0],
                }),
            } : {}),
        };
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

        const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        await vault.createBinary(outputPath, data);
        new Notice(`PDF saved → ${outputPath}`);
    }

    // ── Images ───────────────────────────────────────────────────────────────

    private forEachImage(nodes: ContentNode[], fn: (img: ImageNode) => void): void {
        for (const n of nodes) {
            if (n.type === 'image') fn(n);
            else if (n.type === 'blockquote' || n.type === 'callout') this.forEachImage(n.content, fn);
        }
    }

    private hasEmbeddedImages(nodes: ContentNode[]): boolean {
        let found = false;
        this.forEachImage(nodes, img => { if (img.dataUrl) found = true; });
        return found;
    }

    private stripImages(nodes: ContentNode[]): void {
        this.forEachImage(nodes, img => {
            if (img.dataUrl) {
                delete img.dataUrl;
                img.unresolvedReason = 'could not be embedded';
            }
        });
    }

    private async resolveImages(nodes: ContentNode[], sourcePath: string): Promise<void> {
        const images: ImageNode[] = [];
        this.forEachImage(nodes, img => images.push(img));
        for (const img of images) {
            try {
                await this.loadImage(img, sourcePath);
            } catch (err) {
                console.warn('[Print-Ready PDF] Failed to read image', img.src, err);
                img.unresolvedReason = 'could not be read';
            }
        }
    }

    private async loadImage(img: ImageNode, sourcePath: string): Promise<void> {
        if (/^[a-z][a-z0-9+.-]*:/i.test(img.src)) {
            img.unresolvedReason = 'external images are not embedded';
            return;
        }
        const linkPath = img.src.split('#')[0];
        const sourceFolder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
        let file: unknown = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
        if (!(file instanceof TFile)) {
            file = this.app.vault.getAbstractFileByPath(normalizePath(`${sourceFolder}/${linkPath}`));
        }
        if (!(file instanceof TFile)) {
            img.unresolvedReason = 'not found';
            return;
        }
        if (file.extension.toLowerCase() === 'md') {
            img.unresolvedReason = 'embedded notes are not supported';
            return;
        }
        const bytes = new Uint8Array(await this.app.vault.readBinary(file));
        const info = sniffImage(bytes);
        if (!info) {
            img.unresolvedReason = `${file.extension.toUpperCase()} images are not supported (PNG and JPEG only)`;
            return;
        }
        img.dataUrl = `data:${info.mime};base64,${toBase64(bytes)}`;
        img.naturalWidth = info.width;
        img.naturalHeight = info.height;
    }

    private imageToContent(node: ImageNode, mode: ExportMode, availWidth: number): any {
        if (!node.dataUrl) {
            return {
                text: `[Image not embedded: ${node.alt || node.src}${node.unresolvedReason ? ` (${node.unresolvedReason})` : ''}]`,
                italics: true,
                color: mode === 'print' ? '#999999' : '#666666',
                marginBottom: 4,
            };
        }
        const [pw, ph] = PAGE_DIMENSIONS[this.settings.pageSize] ?? PAGE_DIMENSIONS.LETTER;
        const pageHeight = this.settings.pageOrientation === 'landscape' ? pw : ph;
        const maxHeight = pageHeight - this.settings.marginTop - this.settings.marginBottom - 24;

        const { naturalWidth: nw, naturalHeight: nh } = node;
        if (!nw || !nh) {
            return { image: node.dataUrl, fit: [availWidth, maxHeight], marginBottom: 6 };
        }
        // Obsidian sizes are CSS pixels; PDF points are 0.75 px.
        const wantedWidth = (node.width ?? nw) * 0.75;
        const scale = Math.min(1, availWidth / wantedWidth, maxHeight / (wantedWidth * nh / nw));
        return { image: node.dataUrl, width: wantedWidth * scale, marginBottom: 6 };
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

    private nodeToContent(node: ContentNode, styles: any, mode: ExportMode, fontSize: number, availWidth: number): any {
        switch (node.type) {
            case 'heading':
                return {
                    text: this.spansToInline(node.content, mode, fontSize),
                    style: `h${node.level}`,
                    tocItem: node.level <= 3,
                };

            case 'paragraph':
                return {
                    text: this.spansToInline(node.content, mode, fontSize),
                    marginBottom: 6,
                };

            case 'code_block': {
                const codeColor  = mode === 'print' ? '#1a1a1a' : '#abb2bf';
                const codeBg     = mode === 'print' ? '#f7f7f7' : '#282c34';
                const borderCol  = mode === 'print' ? '#dddddd' : '#3e4451';
                const code       = node.code.replace(/\t/g, TAB_SPACES);
                return {
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: code,
                            font: 'Courier',
                            fontSize: this.codeFontSize(code, fontSize, availWidth),
                            color: codeColor,
                            margin: [8, 6, 8, 6],
                            preserveLeadingSpaces: true,
                        }]],
                    },
                    layout: {
                        fillColor: () => codeBg,
                        hLineWidth: () => 0.5,
                        vLineWidth: () => 0.5,
                        hLineColor: () => borderCol,
                        vLineColor: () => borderCol,
                    },
                    marginBottom: 8,
                    marginTop: 2,
                };
            }

            case 'list':
                return this.listToContent(node, mode, fontSize, 6);

            case 'blockquote': {
                const inner = node.content
                    .map(n => this.nodeToContent(n, styles, mode, fontSize, availWidth - BLOCKQUOTE_INDENT))
                    .filter(Boolean);
                return { stack: inner, style: 'blockquote', margin: [0, 4, 0, 4] };
            }

            case 'callout': {
                const accent  = CALLOUT_COLORS[node.calloutType] ?? '#6366f1';
                const bodyBg  = mode === 'print' ? '#f9f9f9' : '#252526';
                const inner   = node.content
                    .map(n => this.nodeToContent(n, styles, mode, fontSize, availWidth - CALLOUT_CHROME))
                    .filter(Boolean);

                return {
                    table: {
                        widths: [4, '*'],
                        body: [[
                            { text: '', border: [false, false, false, false] },
                            {
                                stack: [
                                    { text: node.title, style: 'calloutTitle', color: accent },
                                    ...inner,
                                ],
                                margin: [8, 6, 8, 6],
                            },
                        ]],
                    },
                    layout: {
                        fillColor: (_row: number, _node: any, col: number) =>
                            col === 0 ? accent : bodyBg,
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

            case 'table': {
                const headerBg = mode === 'print' ? '#eeeeee' : '#2d333b';
                const borderCol = mode === 'print' ? '#cccccc' : '#444c56';

                const cols = Math.max(node.headers.length, ...node.rows.map(r => r.length));
                const pad = (row: InlineSpan[][]) => [...row, ...Array.from({ length: cols - row.length }, () => [] as InlineSpan[])];

                const headerRow = pad(node.headers).map(cell => ({
                    text: this.spansToInline(cell, mode, fontSize),
                    style: 'tableHeader',
                    fillColor: headerBg,
                    margin: [4, 4, 4, 4],
                }));

                const dataRows = node.rows.map(row =>
                    pad(row).map(cell => ({
                        text: this.spansToInline(cell, mode, fontSize),
                        margin: [4, 3, 4, 3],
                    }))
                );

                return {
                    table: {
                        headerRows: 1,
                        widths: Array(cols).fill('*'),
                        body: [headerRow, ...dataRows],
                    },
                    layout: {
                        hLineColor: () => borderCol,
                        vLineColor: () => borderCol,
                    },
                    marginBottom: 8,
                    marginTop: 4,
                };
            }

            case 'page_break':
                return { text: '', pageBreak: 'before' };

            case 'horizontal_rule': {
                const lineColor = mode === 'print' ? '#cccccc' : '#444444';
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
                return this.imageToContent(node, mode, availWidth);

            default:
                return null;
        }
    }

    private listToContent(list: ListNode, mode: ExportMode, fontSize: number, marginBottom: number): any {
        const hasTasks = list.items.some(it => it.checked !== undefined);
        const accent = mode === 'print' ? '#444444' : '#aaaaaa';

        const items = list.items.map((it, idx) => {
            const text = { text: this.spansToInline(it.content, mode, fontSize) };
            const children = it.children.map(c => this.listToContent(c, mode, fontSize, 0));
            const body = children.length ? { stack: [text, ...children] } : text;
            if (!hasTasks) return body;

            // Task lists: draw our own marker (the standard fonts have no ☐ / ☑).
            const box = it.checked === undefined
                ? { text: list.ordered ? `${list.start + idx}.` : '\u2022', width: 14, color: accent }
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

    private spansToInline(spans: InlineSpan[], mode: ExportMode, fontSize: number): any {
        if (spans.length === 0) return '';

        const isPlain = (s: InlineSpan) =>
            !s.bold && !s.italics && !s.monospace && !s.strikethrough &&
            !s.highlight && !s.link && !s.color && !s.background;

        if (spans.length === 1 && isPlain(spans[0])) return spans[0].text;

        return spans.map(span => {
            const obj: any = { text: span.text };
            if (span.bold)        obj.bold = true;
            if (span.italics)     obj.italics = true;
            if (span.strikethrough) obj.decoration = 'lineThrough';
            if (span.monospace) {
                obj.font      = 'Courier';
                obj.fontSize  = Math.max(8, fontSize - 2);
                obj.background = mode === 'print' ? '#f5f5f5' : '#282c34';
                obj.color      = mode === 'print' ? '#c7254e' : '#e06c75';
            }
            if (span.highlight) {
                obj.background = '#ffff00';
                obj.color      = '#000000';
            }
            if (span.link) {
                obj.link       = span.link;
                obj.color      = mode === 'print' ? '#0055cc' : '#58a6ff';
                obj.decoration = 'underline';
            } else if (span.color) {
                obj.color = span.color;
            }
            if (span.background && !span.monospace && !span.highlight) {
                obj.background = span.background;
            }
            return obj;
        });
    }
}
