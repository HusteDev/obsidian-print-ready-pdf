import {
    Align, CalloutNode, ContentNode, HeadingNode, ImageNode, InlineSpan, ListItem, ListNode,
    PageBreakSyntax, TableCell, TableNode,
} from './types';

/**
 * Converts Obsidian's rendered reading-view DOM into the ContentNode tree the
 * PDF builder consumes. Working from the rendered DOM (rather than parsing
 * markdown ourselves) means callouts, embeds, inline HTML, footnotes, plugin
 * output and so on come out exactly as Obsidian shows them.
 */

export interface ExtractOptions {
    pageBreakSyntax: PageBreakSyntax;
}

// ── Style state while walking inline content ─────────────────────────────────

interface Style {
    bold?: boolean;
    italics?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    monospace?: boolean;
    highlight?: boolean;
    link?: string;
    anchor?: string;
    linkStyle?: boolean;
    color?: string;
    background?: string;
    scale?: number;
}

interface BlockCtx {
    align?: Align;
}

type Item = InlineSpan | ContentNode;

const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS',
    'OBJECT', 'EMBED', 'SELECT', 'TEXTAREA', 'HEAD', 'LINK', 'META', 'INPUT',
]);

// Reading-view chrome that is not document content.
const SKIP_SELECTOR = [
    '.frontmatter', '.frontmatter-container', '.metadata-container', '.copy-code-button',
    '.heading-collapse-indicator', '.list-collapse-indicator', '.collapse-indicator',
    '.callout-icon', '.callout-fold', '.markdown-embed-link', '.edit-block-button',
    '.footnote-backref', '.markdown-embed-title', '.file-embed-link', '.cm-widgetBuffer',
].join(',');

const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DEL', 'DFN', 'EM', 'FONT', 'I', 'INS', 'KBD',
    'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME',
    'TT', 'U', 'VAR', 'BR', 'IMG', 'SVG', 'WBR', 'MJX-CONTAINER',
]);

const BLOCK_TAGS_WITH_ALIGN = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'SECTION']);

export class DomExtractor {
    private headingIds = new Set<string>();

    constructor(private opts: ExtractOptions) {}

    extract(root: HTMLElement): ContentNode[] {
        const nodes = this.blocks(root, {});
        // Leading, trailing and doubled page breaks would produce blank pages.
        const out: ContentNode[] = [];
        for (const n of nodes) {
            if (n.type === 'page_break' && (out.length === 0 || out[out.length - 1].type === 'page_break')) continue;
            out.push(n);
        }
        while (out.length && out[out.length - 1].type === 'page_break') out.pop();
        return out;
    }

    // ── Block level ──────────────────────────────────────────────────────────

    private blocks(parent: Node, bc: BlockCtx): ContentNode[] {
        const out: ContentNode[] = [];
        let run: Node[] = [];
        const flush = () => {
            if (run.length) this.pushInline(out, run, bc);
            run = [];
        };
        parent.childNodes.forEach(child => {
            if (child.nodeType === 3) { run.push(child); return; }
            if (child.nodeType !== 1) return;
            const el = child as HTMLElement;
            if (this.skip(el)) return;
            if (this.isInline(el)) { run.push(el); return; }
            flush();
            this.block(el, bc, out);
        });
        flush();
        return out;
    }

    private skip(el: HTMLElement): boolean {
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.hidden || el.matches(SKIP_SELECTOR)) return true;
        if (el.style?.display === 'none') return true;
        // Folded callouts and closed <details> stay in the DOM; print them expanded.
        if (el.classList.contains('callout-content')) return false;
        try {
            return getComputedStyle(el).display === 'none';
        } catch {
            return false;
        }
    }

    private isInline(el: HTMLElement): boolean {
        if (!INLINE_TAGS.has(el.tagName.toUpperCase())) return false;
        if (el.classList.contains('internal-embed') && !el.classList.contains('image-embed')) return false;
        if (el.classList.contains('math-block')) return false;
        return true;
    }

    private block(el: HTMLElement, bc: BlockCtx, out: ContentNode[]): void {
        const tag = el.tagName.toUpperCase();
        const own = this.alignOf(el);
        const ctx: BlockCtx = own ? { align: own } : (tag === 'CENTER' ? { align: 'center' } : bc);

        if (el.classList.contains('callout')) { this.callout(el, ctx, out); return; }
        if (el.classList.contains('internal-embed') || el.classList.contains('markdown-embed')) {
            this.embed(el, ctx, out);
            return;
        }
        if (el.classList.contains('pdfmake-page-break-marker')) {
            if (this.opts.pageBreakSyntax !== 'callout') out.push({ type: 'page_break' });
            else out.push({ type: 'paragraph', content: [{ text: '===' }], align: ctx.align });
            return;
        }
        if (el.classList.contains('math-block')) {
            out.push({ type: 'paragraph', content: [mathSpan(el, true)], align: 'center' });
            return;
        }

        switch (tag) {
            case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
                const content = this.spansOf(el);
                if (!content.length) return;
                const node: HeadingNode = {
                    type: 'heading',
                    level: Number(tag[1]) as HeadingNode['level'],
                    content,
                    align: ctx.align,
                };
                const key = content.map(s => s.text).join('').trim().toLowerCase();
                if (key && !this.headingIds.has(key)) { this.headingIds.add(key); node.id = key; }
                out.push(node);
                return;
            }
            case 'P':
                this.pushInline(out, Array.from(el.childNodes), ctx);
                return;
            case 'UL': case 'OL':
                out.push(this.list(el, ctx));
                return;
            case 'BLOCKQUOTE': {
                const content = this.blocks(el, ctx);
                if (content.length) out.push({ type: 'blockquote', content });
                return;
            }
            case 'PRE': {
                // Read text from a copy without reading-view chrome (the "Copy" button etc.).
                const clone = el.cloneNode(true) as HTMLElement;
                clone.querySelectorAll(SKIP_SELECTOR).forEach(n => n.parentNode?.removeChild(n));
                const code = (clone.textContent ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
                const lang = (el.querySelector('code')?.className.match(/language-(\S+)/)?.[1]) ?? '';
                out.push({ type: 'code_block', language: lang, code });
                return;
            }
            case 'HR':
                out.push({ type: 'horizontal_rule' });
                return;
            case 'TABLE': {
                const cap = el.querySelector(':scope > caption') as HTMLElement | null;
                if (cap) {
                    const spans = this.spansOf(cap).map(sp => ({ ...sp, italics: true }));
                    if (spans.length) out.push({ type: 'paragraph', content: spans, align: 'center' });
                }
                const t = this.table(el);
                if (t) out.push(t);
                return;
            }
            case 'DETAILS': {
                el.childNodes.forEach(child => {
                    if (child.nodeType !== 1) return;
                    const c = child as HTMLElement;
                    if (c.tagName.toUpperCase() === 'SUMMARY') {
                        const spans = this.spansOf(c).map(s => ({ ...s, bold: true }));
                        if (spans.length) out.push({ type: 'paragraph', content: spans, align: ctx.align });
                    } else if (!this.skip(c)) {
                        if (this.isInline(c)) this.pushInline(out, [c], ctx);
                        else this.block(c, ctx, out);
                    }
                });
                return;
            }
            case 'DT': {
                const spans = this.spansOf(el).map(s => ({ ...s, bold: true }));
                if (spans.length) out.push({ type: 'paragraph', content: spans, align: ctx.align });
                return;
            }
            case 'LI':
                out.push(...this.blocks(el, ctx));
                return;
            default:
                out.push(...this.blocks(el, ctx));
        }
    }

    private alignOf(el: HTMLElement): Align | undefined {
        const raw = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
        if (raw === 'center' || raw === 'right' || raw === 'justify' || raw === 'left') return raw;
        if (raw === 'start') return 'left';
        if (raw === 'end') return 'right';
        // Auto-margined block (`margin: auto`) inside a div reads as centred.
        return undefined;
    }

    // ── Lists ────────────────────────────────────────────────────────────────

    private list(el: HTMLElement, bc: BlockCtx): ListNode {
        const ordered = el.tagName.toUpperCase() === 'OL';
        const start = parseInt(el.getAttribute('start') ?? '', 10);
        const items: ListItem[] = [];
        el.childNodes.forEach(child => {
            if (child.nodeType !== 1) return;
            const li = child as HTMLElement;
            if (li.tagName.toUpperCase() !== 'LI' || this.skip(li)) return;
            const item: ListItem = { content: this.blocks(li, bc) };
            const task = li.getAttribute('data-task');
            if (task !== null) item.checked = task.trim() !== '';
            else {
                const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
                if (box) item.checked = box.checked;
            }
            items.push(item);
        });
        return { type: 'list', ordered, start: Number.isFinite(start) ? start : 1, items };
    }

    // ── Tables ───────────────────────────────────────────────────────────────

    private table(el: HTMLElement): TableNode | null {
        const trs = Array.from(el.querySelectorAll('tr')).filter(tr => tr.closest('table') === el);
        if (!trs.length) return null;
        const rows: TableCell[][] = [];
        let headerRows = 0;
        trs.forEach((tr, idx) => {
            const cells: TableCell[] = [];
            let allTh = true;
            tr.childNodes.forEach(c => {
                if (c.nodeType !== 1) return;
                const cell = c as HTMLElement;
                const t = cell.tagName.toUpperCase();
                if (t !== 'TD' && t !== 'TH') return;
                const align = this.alignOf(cell);
                if (t !== 'TH') allTh = false;
                cells.push({
                    content: this.blocks(cell, align ? { align } : {}),
                    header: t === 'TH',
                    colSpan: Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1),
                    rowSpan: Math.max(1, parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1),
                    align,
                });
            });
            if (!cells.length) return;
            const inHead = tr.parentElement?.tagName.toUpperCase() === 'THEAD';
            if (inHead || (idx === headerRows && allTh)) headerRows = rows.length + 1;
            rows.push(cells);
        });
        return rows.length ? { type: 'table', rows, headerRows } : null;
    }

    // ── Callouts and embeds ──────────────────────────────────────────────────

    private callout(el: HTMLElement, bc: BlockCtx, out: ContentNode[]): void {
        const type = (el.getAttribute('data-callout') ?? 'note').toLowerCase();
        if ((type === 'page-break' || type === 'pagebreak') && this.opts.pageBreakSyntax !== 'triple-equals') {
            out.push({ type: 'page_break' });
            return;
        }
        const titleEl = el.querySelector(':scope > .callout-title .callout-title-inner') as HTMLElement | null;
        const contentEl = el.querySelector(':scope > .callout-content') as HTMLElement | null;
        let color: string | undefined;
        try {
            // Theme-resolved accent, e.g. "8, 109, 221"; honours custom callouts and snippets.
            const m = getComputedStyle(el).getPropertyValue('--callout-color').match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) color = rgbToHex(+m[1], +m[2], +m[3]);
        } catch { /* fall back to the built-in palette */ }
        const node: CalloutNode = {
            type: 'callout',
            calloutType: type,
            title: titleEl ? this.spansOf(titleEl) : [],
            color,
            content: contentEl ? this.blocks(contentEl, bc) : [],
        };
        out.push(node);
    }

    private embed(el: HTMLElement, bc: BlockCtx, out: ContentNode[]): void {
        const src = el.getAttribute('src') ?? el.getAttribute('alt') ?? '';
        if (el.classList.contains('image-embed')) {
            this.pushInline(out, [el], bc);
            return;
        }
        const inner = el.querySelector('.markdown-embed-content') as HTMLElement | null;
        if (inner && !el.classList.contains('is-loading')) {
            const content = this.blocks(inner, bc);
            if (content.length) { out.push({ type: 'blockquote', content }); return; }
        }
        const kind = el.classList.contains('pdf-embed') ? 'PDF'
            : el.classList.contains('media-embed') ? 'media' : 'note';
        out.push({ type: 'placeholder', text: `[Embedded ${kind} not shown: ${src}]` });
    }

    // ── Inline level ─────────────────────────────────────────────────────────

    private pushInline(out: ContentNode[], nodes: Node[], bc: BlockCtx): void {
        const items: Item[] = [];
        nodes.forEach(n => this.inline(n, {}, items));
        let spans: InlineSpan[] = [];
        const flush = () => {
            const cleaned = cleanSpans(spans);
            if (cleaned.length) out.push({ type: 'paragraph', content: cleaned, align: bc.align });
            spans = [];
        };
        for (const it of items) {
            if ('type' in it) {
                flush();
                if (it.type === 'image' && !it.align) it.align = bc.align;
                out.push(it);
            } else spans.push(it);
        }
        flush();
    }

    /** Flattens an element's inline content to spans (images and other blocks are dropped). */
    private spansOf(el: HTMLElement): InlineSpan[] {
        const items: Item[] = [];
        el.childNodes.forEach(n => this.inline(n, {}, items));
        return cleanSpans(items.filter((i): i is InlineSpan => !('type' in i)));
    }

    private inline(node: Node, st: Style, out: Item[]): void {
        if (node.nodeType === 3) {
            const text = (node.nodeValue ?? '').replace(/[ \t\r\n\f]+/g, ' ');
            if (text) out.push({ text, ...st });
            return;
        }
        if (node.nodeType !== 1) return;
        const el = node as HTMLElement;
        if (this.skip(el)) return;
        const tag = el.tagName.toUpperCase();

        if (tag === 'BR') { out.push({ text: '\n', ...st }); return; }
        if (tag === 'WBR') return;
        if (tag === 'IMG') { out.push(this.image(el as HTMLImageElement)); return; }
        if (tag === 'SVG') {
            const svg = this.svgNode(el);
            if (svg) out.push(svg);
            return;
        }
        if (el.classList.contains('image-embed')) {
            const img = el.querySelector('img');
            if (img) out.push(this.image(img as HTMLImageElement));
            else out.push({ type: 'placeholder', text: `[Image not found: ${el.getAttribute('src') ?? ''}]` });
            return;
        }
        if (tag === 'MJX-CONTAINER' || el.classList.contains('math')) {
            // Math is not typeset yet; show its source (or glyph text) so it is never lost or doubled.
            out.push({ ...st, ...mathSpan(el, el.getAttribute('display') === 'true') });
            return;
        }
        if (!this.isInline(el)) {
            // A block inside inline content (e.g. <span><div>): emit it as its own blocks.
            const blocks: ContentNode[] = [];
            this.block(el, {}, blocks);
            out.push(...blocks);
            return;
        }

        const next = this.styleFor(el, tag, st);
        const wrap = el.classList.contains('footnote-ref');
        if (wrap) out.push({ text: '[', ...next });
        el.childNodes.forEach(c => this.inline(c, next, out));
        if (wrap) out.push({ text: ']', ...next });
    }

    private styleFor(el: HTMLElement, tag: string, st: Style): Style {
        const s: Style = { ...st };
        switch (tag) {
            case 'B': case 'STRONG': s.bold = true; break;
            case 'I': case 'EM': case 'CITE': case 'DFN': case 'VAR': s.italics = true; break;
            case 'U': case 'INS': s.underline = true; break;
            case 'DEL': case 'S': case 'STRIKE': s.strikethrough = true; break;
            case 'CODE': case 'KBD': case 'SAMP': case 'TT': s.monospace = true; break;
            case 'MARK': s.highlight = true; break;
            case 'SUB': case 'SUP': s.scale = (s.scale ?? 1) * 0.7; break;
            case 'SMALL': s.scale = (s.scale ?? 1) * 0.85; break;
            case 'FONT': {
                const c = normalizeColor(el.getAttribute('color'));
                if (c) s.color = c;
                break;
            }
            case 'A': {
                const href = el.getAttribute('href') ?? '';
                const dataHref = el.getAttribute('data-href') ?? '';
                if (/^(https?:|mailto:)/i.test(href)) {
                    s.link = href;
                    s.linkStyle = true;
                } else if (el.classList.contains('internal-link') && dataHref.startsWith('#') && !dataHref.startsWith('#^')) {
                    s.anchor = dataHref.slice(1).trim().toLowerCase();
                    s.linkStyle = true;
                } else if (el.classList.contains('internal-link') || el.classList.contains('tag')) {
                    s.linkStyle = true;
                }
                // Anything else (javascript:, file:, obsidian://, footnote anchors) is not a live link.
                break;
            }
        }
        const css = el.style;
        if (css) {
            // Resolve through computed style so named colours become #hex too.
            const resolved = (authored: string, prop: 'color' | 'backgroundColor') => {
                if (!authored) return undefined;
                try { return normalizeColor(getComputedStyle(el)[prop]); } catch { return normalizeColor(authored); }
            };
            const color = resolved(css.color, 'color');
            if (color) s.color = color;
            const bg = resolved(css.backgroundColor, 'backgroundColor');
            if (bg) s.background = bg;
            const fw = css.fontWeight;
            if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) s.bold = true;
            if (fw === 'normal' || (fw && Number(fw) > 0 && Number(fw) < 600)) s.bold = false;
            if (css.fontStyle === 'italic' || css.fontStyle === 'oblique') s.italics = true;
            const deco = `${css.textDecoration} ${css.textDecorationLine}`;
            if (/underline/.test(deco)) s.underline = true;
            if (/line-through/.test(deco)) s.strikethrough = true;
            if (/mono|courier|consolas/i.test(css.fontFamily)) s.monospace = true;
            const size = relativeSize(css.fontSize);
            if (size) s.scale = Math.min(3, Math.max(0.5, (st.scale ?? 1) * size));
        }
        return s;
    }

    // ── Images ───────────────────────────────────────────────────────────────

    private image(img: HTMLImageElement): ImageNode {
        const embed = img.closest('.internal-embed') as HTMLElement | null;
        const linkSrc = embed?.getAttribute('src') ?? null;
        const pick = (name: 'width' | 'height'): number | undefined =>
            px(img.getAttribute(name)) ?? px(embed?.getAttribute(name) ?? null) ?? px(img.style[name]);
        const pctRaw = img.style.width || img.getAttribute('width') || '';
        const widthPct = /%$/.test(pctRaw) ? parseFloat(pctRaw) : undefined;
        const node: ImageNode = {
            type: 'image',
            alt: img.getAttribute('alt') ?? '',
            src: linkSrc ?? img.getAttribute('src') ?? '',
            vault: linkSrc !== null,
            width: widthPct ? undefined : pick('width'),
            height: pick('height'),
            widthPct,
        };
        if (!node.src) node.unresolvedReason = 'no source';
        return node;
    }

    private svgNode(el: HTMLElement): ImageNode | null {
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return null; // icons and decoration
        // Give the root explicit pixel dimensions (mermaid uses width="100%", which
        // would otherwise rasterize at the browser's default 300x150).
        const clone = el.cloneNode(true) as HTMLElement;
        clone.setAttribute('width', String(Math.round(rect.width)));
        clone.setAttribute('height', String(Math.round(rect.height)));
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.removeAttribute('style');
        return {
            type: 'image',
            alt: 'diagram',
            src: '',
            vault: false,
            svg: new XMLSerializer().serializeToString(clone),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collapse whitespace across span boundaries and trim the ends of a run. */
function cleanSpans(spans: InlineSpan[]): InlineSpan[] {
    const out: InlineSpan[] = [];
    let prevEndsSpace = true; // trims leading whitespace
    for (const s of spans) {
        let text = s.text;
        if (text !== '\n' && !s.monospace) {
            if (prevEndsSpace && text.startsWith(' ')) text = text.slice(1);
        }
        if (text === '') continue;
        prevEndsSpace = text === '\n' || text.endsWith(' ');
        out.push({ ...s, text });
    }
    // Trim trailing whitespace and line breaks.
    while (out.length) {
        const last = out[out.length - 1];
        const trimmed = last.text.replace(/[ \n]+$/, '');
        if (trimmed === '') { out.pop(); continue; }
        last.text = trimmed;
        break;
    }
    return out;
}

export function walkNodes(nodes: ContentNode[], fn: (n: ContentNode) => void): void {
    for (const n of nodes) {
        fn(n);
        switch (n.type) {
            case 'blockquote': case 'callout': walkNodes(n.content, fn); break;
            case 'list': n.items.forEach(it => walkNodes(it.content, fn)); break;
            case 'table': n.rows.forEach(r => r.forEach(c => walkNodes(c.content, fn))); break;
        }
    }
}

function rgbToHex(r: number, g: number, b: number): string {
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** CSS colour -> something pdfkit accepts (#hex or a named colour); undefined if unusable. */
function normalizeColor(value: string | null | undefined): string | undefined {
    const v = (value ?? '').trim();
    if (!v || v === 'inherit' || v === 'initial' || v === 'transparent' || v === 'currentcolor') return undefined;
    const rgb = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)$/i);
    if (rgb) {
        if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return undefined;
        return rgbToHex(+rgb[1], +rgb[2], +rgb[3]);
    }
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return v;
    if (/^[a-z]+$/i.test(v)) return v.toLowerCase();
    return undefined;
}

function px(v: string | null | undefined): number | undefined {
    if (!v) return undefined;
    const m = v.trim().match(/^([\d.]+)(px)?$/i);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    return n > 0 ? n : undefined;
}

/** font-size -> factor relative to the surrounding text. */
function relativeSize(v: string): number | undefined {
    const m = (v ?? '').trim().match(/^([\d.]+)(px|pt|em|rem|%)$/i);
    if (!m) {
        if (v === 'small') return 0.85;
        if (v === 'smaller') return 0.85;
        if (v === 'large' || v === 'larger') return 1.2;
        return undefined;
    }
    const n = parseFloat(m[1]);
    switch (m[2].toLowerCase()) {
        case 'px': return n / 16;
        case 'pt': return n / 12;
        case 'em': case 'rem': return n;
        case '%': return n / 100;
    }
    return undefined;
}

/**
 * Visible stand-in for a rendered formula, never empty and never doubled.
 * Prefers TeX source when Obsidian exposes it, then the visible glyph text
 * (without the hidden assistive MathML that would double it), then the MathML
 * text, then a marker.
 */
function mathSpan(el: HTMLElement, display: boolean): InlineSpan {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    let text = tex ?? '';
    if (!text) {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('mjx-assistive-mml, style, script').forEach(n => n.parentNode?.removeChild(n));
        text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    }
    if (!text) text = (el.querySelector('mjx-assistive-mml')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) text = '[formula]';
    return { text: tex ? (display ? `$$${text}$$` : `$${text}$`) : text, monospace: true };
}
