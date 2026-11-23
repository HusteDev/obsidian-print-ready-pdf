/**
 * Recovers LaTeX source from markdown. Obsidian's rendered math DOM does not
 * reliably carry the TeX, so we scan the markdown the same way Obsidian
 * delimits it and match the results, in order, to the rendered math elements.
 */

export interface MathSource {
    tex: string;
    display: boolean;
}

const FENCE_RE = /^[\s>]*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})/;

export function scanMath(markdown: string): MathSource[] {
    let md = markdown.replace(/\r\n?/g, '\n').replace(/^﻿?---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');

    // Drop fenced code; strip blockquote markers so callout bodies read as plain text.
    const kept: string[] = [];
    let fence: string | null = null;
    for (const line of md.split('\n')) {
        const m = line.match(FENCE_RE);
        if (m) {
            if (!fence) fence = m[1];
            else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
            continue;
        }
        if (fence) continue;
        kept.push(line.replace(/^(?:\s*>)+ ?/, ''));
    }
    md = kept.join('\n');

    // Inline code spans and closed %%comments%% hide any `$` inside them.
    md = md.replace(/(`+)[\s\S]*?\1/g, m => ' '.repeat(m.length)).replace(/%%[\s\S]*?%%/g, m => ' '.repeat(m.length));

    const out: MathSource[] = [];
    let i = 0;
    while (i < md.length) {
        const ch = md[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch !== '$') { i++; continue; }
        if (md.startsWith('$$', i)) {
            const j = findClose(md, i + 2, '$$');
            if (j < 0) { i += 2; continue; }
            const tex = md.slice(i + 2, j).trim();
            if (tex) out.push({ tex, display: true });
            i = j + 2;
            continue;
        }
        // Inline: the opening `$` is followed by non-space, the closing one preceded by
        // non-space and not followed by a digit, all on one line.
        if (/\s/.test(md[i + 1] ?? ' ')) { i++; continue; }
        let j = i + 1;
        let close = -1;
        while (j < md.length && md[j] !== '\n') {
            if (md[j] === '\\') { j += 2; continue; }
            if (md[j] === '$') {
                if (!/\s/.test(md[j - 1]) && !/\d/.test(md[j + 1] ?? '')) close = j;
                break;
            }
            j++;
        }
        if (close < 0) { i++; continue; }
        out.push({ tex: md.slice(i + 1, close), display: false });
        i = close + 1;
    }
    return out;
}

function findClose(s: string, from: number, token: string): number {
    for (let j = from; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s.startsWith(token, j)) return j;
    }
    return -1;
}

// ── Inline math without typesetting ───────────────────────────────────────────

const SIMPLE_COMMANDS: Record<string, string> = {
    times: '×', cdot: '·', pm: '±', div: '÷', deg: '°', mu: 'µ',
    leq: '<=', le: '<=', geq: '>=', ge: '>=', neq: '!=', ne: '!=', approx: '~=', to: '->',
    rightarrow: '->', ldots: '...', dots: '...', cdots: '...',
};
const SUPERSCRIPT: Record<string, string> = { '1': '¹', '2': '²', '3': '³' };

/**
 * Plain-text form of a trivial inline formula using only characters the
 * standard fonts can draw (x^2, a_i, 3 \times 4). Returns null for anything
 * else so the caller can show the TeX source instead of a wrong approximation.
 */
export function simplifyTeX(tex: string): string | null {
    let s = tex.trim();
    if (!s || s.length > 80) return null;
    let bad = false;
    s = s.replace(/\\([A-Za-z]+)/g, (_m, name: string) => {
        const r = SIMPLE_COMMANDS[name];
        if (r === undefined) { bad = true; return ''; }
        return ` ${r} `;
    });
    if (bad || /\\/.test(s)) return null;
    s = s.replace(/\^\{?(\d)\}?(?![\d{])/g, (_m, d: string) => SUPERSCRIPT[d] ?? `^${d}`);
    s = s.replace(/([_^])\{([^{}]*)\}/g, (_m, op: string, body: string) => (body.length === 1 ? `${op}${body}` : `${op}(${body})`));
    s = s.replace(/\{([^{}]*)\}/g, '$1');
    if (/[{}]/.test(s)) return null;
    if (!/^[A-Za-z0-9\s+\-=<>()[\],.;:!/|^_*'°-ÿ]*$/.test(s)) return null;
    return s.replace(/\s+/g, ' ').trim();
}
