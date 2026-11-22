import {
    ContentNode,
    InlineSpan,
    ListNode,
    ListItem,
    BlockquoteNode,
    CalloutNode,
    TableNode,
    PageBreakSyntax,
} from './types';

export function parseMarkdown(
    markdown: string,
    pageBreakSyntax: PageBreakSyntax = 'both',
): ContentNode[] {
    // Normalize line endings, then strip YAML front matter.
    const normalized = markdown.replace(/\r\n?/g, '\n');
    const body = normalized.replace(/^\uFEFF?---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
    return parseBlocks(stripComments(body.split('\n')), pageBreakSyntax);
}

// Remove Obsidian `%%comment%%` spans (inline and multi-line) outside fenced
// code, so private notes never reach the PDF.
function stripComments(lines: string[]): string[] {
    const out: string[] = [];
    let inFence = false;
    let inComment = false;
    for (const line of lines) {
        if (!inComment && /^\s*```/.test(line)) {
            inFence = !inFence;
            out.push(line);
            continue;
        }
        if (inFence) { out.push(line); continue; }

        let res = '';
        let pos = 0;
        while (pos < line.length) {
            const idx = line.indexOf('%%', pos);
            if (inComment) {
                if (idx < 0) { pos = line.length; } else { inComment = false; pos = idx + 2; }
            } else if (idx < 0) {
                res += line.slice(pos);
                pos = line.length;
            } else {
                res += line.slice(pos, idx);
                inComment = true;
                pos = idx + 2;
            }
        }
        out.push(res);
    }
    return out;
}

const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const HR_RE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const IMAGE_ONLY_RE = /^(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\))$/;

function parseBlocks(
    lines: string[],
    pageBreakSyntax: PageBreakSyntax,
): ContentNode[] {
    const nodes: ContentNode[] = [];
    let i = 0;
    let lastStart = -1;

    while (i < lines.length) {
        // Forward-progress guard: if a handler consumed nothing, emit the line
        // as plain text rather than looping forever.
        if (i === lastStart) {
            nodes.push({ type: 'paragraph', content: parseInline(lines[i]) });
            i++;
            continue;
        }
        lastStart = i;

        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') { i++; continue; }

        // ── Page break: === (triple-equals or more) ───────────────────────────
        if (
            (pageBreakSyntax === 'triple-equals' || pageBreakSyntax === 'both') &&
            /^={3,}$/.test(trimmed)
        ) {
            nodes.push({ type: 'page_break' });
            i++;
            continue;
        }

        // ── Horizontal rule: --- *** ___ ─────────────────────────────────────
        if (HR_RE.test(trimmed)) {
            nodes.push({ type: 'horizontal_rule' });
            i++;
            continue;
        }

        // ── ATX heading ───────────────────────────────────────────────────────
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
        if (headingMatch) {
            nodes.push({
                type: 'heading',
                level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
                content: parseInline(headingMatch[2].trim()),
            });
            i++;
            continue;
        }

        // ── Fenced code block ─────────────────────────────────────────────────
        if (trimmed.startsWith('```')) {
            const lang = trimmed.slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // consume closing ```
            nodes.push({ type: 'code_block', language: lang, code: codeLines.join('\n') });
            continue;
        }

        // ── Blockquote / Obsidian callout ─────────────────────────────────────
        if (line.startsWith('>')) {
            const result = parseBlockquoteSection(lines, i, pageBreakSyntax);
            nodes.push(result.node);
            i = result.nextIndex;
            continue;
        }

        // ── List (unordered / ordered / task) ─────────────────────────────────
        if (LIST_ITEM_RE.test(line)) {
            const result = parseListSection(lines, i);
            nodes.push(result.node);
            i = result.nextIndex;
            continue;
        }

        // ── Table ─────────────────────────────────────────────────────────────
        if (trimmed.startsWith('|') && i + 1 < lines.length) {
            const result = parseTableSection(lines, i);
            if (result) {
                nodes.push(result.node);
                i = result.nextIndex;
                continue;
            }
        }

        // ── Images: ![[file.png|300]] and ![alt](path) ────────────────────────
        const wikiImgMatch = trimmed.match(/^!\[\[([^\]]+)\]\]$/);
        if (wikiImgMatch) {
            const parts = wikiImgMatch[1].split('|');
            const src = parts[0].trim();
            const last = parts[parts.length - 1].trim();
            const width = parts.length > 1 ? parseInt(last.split('x')[0], 10) : NaN;
            nodes.push({
                type: 'image',
                alt: parts.length > 1 && Number.isNaN(width) ? last : src,
                src,
                isWikilink: true,
                ...(Number.isNaN(width) ? {} : { width }),
            });
            i++;
            continue;
        }

        const mdImgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (mdImgMatch) {
            let src = mdImgMatch[2].trim();
            if (src.startsWith('<') && src.includes('>')) {
                src = src.slice(1, src.indexOf('>'));
            } else {
                src = src.replace(/\s+"[^"]*"$/, '');
            }
            try { src = decodeURIComponent(src); } catch { /* keep raw */ }
            nodes.push({ type: 'image', alt: mdImgMatch[1], src, isWikilink: false });
            i++;
            continue;
        }

        // ── Paragraph ─────────────────────────────────────────────────────────
        const paraLines: string[] = [line];
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
            paraLines.push(lines[i]);
            i++;
        }
        // Obsidian renders single newlines as line breaks.
        nodes.push({ type: 'paragraph', content: parseInline(paraLines.join('\n')) });
    }

    return nodes;
}

// Returns true if the line should terminate a paragraph accumulation.
function isBlockStart(line: string): boolean {
    const t = line.trim();
    return (
        /^#{1,6}\s/.test(t) ||
        t.startsWith('```') ||
        t.startsWith('>') ||
        LIST_ITEM_RE.test(line) ||
        (t.startsWith('|') && t.endsWith('|')) ||
        HR_RE.test(t) ||
        IMAGE_ONLY_RE.test(t) ||
        /^={3,}$/.test(t)
    );
}

function parseBlockquoteSection(
    lines: string[],
    startIndex: number,
    pageBreakSyntax: PageBreakSyntax,
): { node: ContentNode; nextIndex: number } {
    const bqLines: string[] = [];
    let i = startIndex;

    while (i < lines.length && lines[i].startsWith('>')) {
        bqLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
    }

    // Obsidian callout: > [!type] optional title
    const calloutMatch = bqLines[0]?.match(/^\[!([^\]]+)\][+-]?(?:\s+(.*))?$/);
    if (calloutMatch) {
        const calloutType = calloutMatch[1].toLowerCase().trim();
        const rawTitle = calloutMatch[2]?.trim() || '';
        const title = rawTitle || calloutType.charAt(0).toUpperCase() + calloutType.slice(1);

        // Page-break callout
        if (
            (pageBreakSyntax === 'callout' || pageBreakSyntax === 'both') &&
            (calloutType === 'page-break' || calloutType === 'pagebreak')
        ) {
            return { node: { type: 'page_break' }, nextIndex: i };
        }

        const bodyContent = parseBlocks(bqLines.slice(1), pageBreakSyntax);
        const calloutNode: CalloutNode = {
            type: 'callout',
            calloutType,
            title,
            content: bodyContent,
        };
        return { node: calloutNode, nextIndex: i };
    }

    // Regular blockquote
    const blockquoteNode: BlockquoteNode = {
        type: 'blockquote',
        content: parseBlocks(bqLines, pageBreakSyntax),
    };
    return { node: blockquoteNode, nextIndex: i };
}

function indentWidth(ws: string): number {
    return ws.replace(/\t/g, '    ').length;
}

function parseListSection(
    lines: string[],
    startIndex: number,
): { node: ListNode; nextIndex: number } {
    const first = lines[startIndex].match(LIST_ITEM_RE)!;
    const baseIndent = indentWidth(first[1]);
    const ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items: ListItem[] = [];
    const raws: string[] = [];
    let i = startIndex;

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === '') {
            // A blank line continues the list only if the next item belongs to it.
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === '') j++;
            const next = j < lines.length ? lines[j].match(LIST_ITEM_RE) : null;
            if (next && indentWidth(next[1]) >= baseIndent && !HR_RE.test(lines[j].trim())) {
                i = j;
                continue;
            }
            break;
        }

        const m = line.match(LIST_ITEM_RE);
        if (m && !HR_RE.test(line.trim())) {
            const indent = indentWidth(m[1]);
            if (indent < baseIndent) break;
            if (indent > baseIndent && items.length > 0) {
                const sub = parseListSection(lines, i);
                items[items.length - 1].children.push(sub.node);
                i = sub.nextIndex;
                continue;
            }
            if (/\d/.test(m[2]) !== ordered) break; // marker type changed: new list

            let text = m[3] ?? '';
            let checked: boolean | undefined;
            const task = text.match(/^\[([ xX])\](?:\s+(.*))?$/);
            if (task) {
                checked = task[1] !== ' ';
                text = task[2] ?? '';
            }
            raws.push(text);
            items.push({ content: parseInline(text), children: [], ...(checked === undefined ? {} : { checked }) });
            i++;
            continue;
        }

        // Indented continuation of the previous item's text.
        const contIndent = indentWidth(line.match(/^[ \t]*/)![0]);
        if (items.length > 0 && contIndent > baseIndent && !isBlockStart(line)) {
            const last = items.length - 1;
            raws[last] += '\n' + line.trim();
            items[last].content = parseInline(raws[last]);
            i++;
            continue;
        }
        break;
    }

    // Guarantee progress even on odd input.
    if (i === startIndex) i++;
    return { node: { type: 'list', ordered, start, items }, nextIndex: i };
}

function parseTableSection(
    lines: string[],
    startIndex: number,
): { node: TableNode; nextIndex: number } | null {
    const sepLine = lines[startIndex + 1];
    if (!sepLine || !/^\|?[\s\-:|]+\|/.test(sepLine)) return null;

    const splitRow = (line: string): InlineSpan[][] =>
        line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => parseInline(c.trim()));

    const headers = splitRow(lines[startIndex]);
    let i = startIndex + 2;
    const rows: InlineSpan[][][] = [];

    while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
    }

    return { node: { type: 'table', headers, rows }, nextIndex: i };
}

// ── Inline parser ─────────────────────────────────────────────────────────────

export function parseInline(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    let rest = text;

    while (rest.length > 0) {
        let m: RegExpMatchArray | null;

        // Bold-italic: ***…*** or ___…___
        if ((m = rest.match(/^(\*\*\*|___)(.+?)\1/s))) {
            spans.push({ text: m[2], bold: true, italics: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Bold: **…** or __…__
        if ((m = rest.match(/^(\*\*|__)(.+?)\1/s))) {
            spans.push({ text: m[2], bold: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Italic: *…*
        if ((m = rest.match(/^\*(.+?)\*/s))) {
            spans.push({ text: m[1], italics: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Italic: _…_ (word-boundary only to avoid mid-word underscores)
        if ((m = rest.match(/^_([^_\s][^_]*)_(?!\w)/))) {
            spans.push({ text: m[1], italics: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Inline code: `…`
        if ((m = rest.match(/^`([^`]+)`/))) {
            spans.push({ text: m[1], monospace: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Strikethrough: ~~…~~
        if ((m = rest.match(/^~~(.+?)~~/s))) {
            spans.push({ text: m[1], strikethrough: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Highlight: ==…==
        if ((m = rest.match(/^==(.+?)==/s))) {
            spans.push({ text: m[1], highlight: true });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Markdown link: [text](url)
        if ((m = rest.match(/^\[([^\]]*)\]\(([^)]*)\)/))) {
            spans.push({ text: m[1] || m[2], link: m[2], color: '#0066cc' });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Obsidian wikilink: [[link|alias]] or [[link]]
        if ((m = rest.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/))) {
            spans.push({ text: m[2] || m[1] });
            rest = rest.slice(m[0].length);
            continue;
        }

        // Plain text — scan to next potential marker
        let end = 1;
        while (end < rest.length && !'*_`~=[!'.includes(rest[end])) end++;
        spans.push({ text: rest.slice(0, end) });
        rest = rest.slice(end);
    }

    // Merge adjacent unstyled spans
    return spans.reduce<InlineSpan[]>((acc, span) => {
        const prev = acc[acc.length - 1];
        const plain = (s: InlineSpan) =>
            !s.bold && !s.italics && !s.monospace && !s.strikethrough &&
            !s.highlight && !s.link && !s.color && !s.background;

        if (prev && plain(prev) && plain(span)) {
            prev.text += span.text;
        } else if (span.text.length > 0) {
            acc.push({ ...span });
        }
        return acc;
    }, []);
}
