/**
 * Recovers LaTeX source from markdown and converts simple inline formulas to
 * plain text. Obsidian's rendered math DOM does not reliably carry the TeX, so
 * we scan the markdown the same way Obsidian delimits it and match the results,
 * in order, to the rendered math elements.
 */

export interface MathSource {
    tex: string;
    display: boolean;
}

const FENCE_RE = /^[\s>]*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})/;

export function scanMath(markdown: string): MathSource[] {
    let md = markdown.replace(/\r\n?/g, '\n').replace(/^\uFEFF?---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');

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

const GREEK: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
    varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS: Record<string, string> = {
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '*', star: '*', circ: '∘', bullet: '•',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼',
    simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
    infty: '∞', partial: '∂', nabla: '∇', degree: '°', prime: '′', ell: 'ℓ', hbar: 'ħ',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
    cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
    Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓',
    ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', angle: '∠', perp: '⊥', parallel: '∥',
    sum: '∑', prod: '∏', int: '∫', oint: '∮', sqrt: '√',
    aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ',
    ...GREEK,
};

const FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'gcd', 'mod', 'deg', 'arg',
]);
// \text{x}, \mathbf{x} ...: keep the argument's text, drop the styling.
const WRAPPERS = new Set([
    'text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal',
    'mathbb', 'mathfrak', 'boldsymbol', 'bm', 'operatorname', 'rm', 'bf', 'it',
]);
const SPACES = new Set(['quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace']);
const BIG_OPS = new Set(['sum', 'prod', 'int', 'oint']);
const SUPERSCRIPT_DIGITS: Record<string, string> = { '1': '¹', '2': '²', '3': '³' };

class Unsupported extends Error {}

/** Reads a `{...}` group starting at `i` (which must be '{'); returns the inner text and the index after it. */
function readGroup(s: string, i: number): [string, number] {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    throw new Unsupported();
}

/** Reads one script argument: a `{group}`, a `\command`, or a single character. */
function readArg(s: string, i: number): [string, number] {
    while (s[i] === ' ') i++;
    if (i >= s.length) throw new Unsupported();
    if (s[i] === '{') return readGroup(s, i);
    if (s[i] === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        if (!m) throw new Unsupported();
        return [m[0], i + m[0].length];
    }
    return [s[i], i + 1];
}

function convert(src: string): string {
    let out = '';
    let i = 0;
    let lastBig = false;
    while (i < src.length) {
        const c = src[i];
        const big = lastBig;
        lastBig = false;
        if (c === '\\') {
            const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
            if (!m) {
                const sym = src[i + 1] ?? '';
                i += 2;
                if (sym === ',' || sym === ';' || sym === ':' || sym === ' ') out += ' ';
                else if (sym === '!') out += '';
                else if ('{}%$&#_|'.includes(sym) && sym) out += sym;
                else throw new Unsupported();
                continue;
            }
            const name = m[1];
            i += m[0].length;
            if (WRAPPERS.has(name)) {
                const [arg, next] = readArg(src, i);
                out += convert(arg);
                i = next;
            } else if (name === 'left' || name === 'right') {
                while (src[i] === ' ') i++;
                const d = src[i];
                if (d === '.') { i++; continue; }
                if (d === '\\') {
                    const dm = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
                    if (!dm) throw new Unsupported();
                    i += dm[0].length;
                    if (dm[1] === '{' || dm[1] === '}' || dm[1] === '|') out += dm[1];
                    else if (dm[1] === 'langle') out += '⟨';
                    else if (dm[1] === 'rangle') out += '⟩';
                    else throw new Unsupported();
                } else { out += d ?? ''; i++; }
            } else if (SPACES.has(name)) {
                out += ' ';
            } else if (FUNCTIONS.has(name)) {
                out += /[A-Za-z0-9\\]/.test(src[i] ?? '') ? `${name} ` : name;
            } else if (name === 'sqrt') {
                const [arg, next] = readArg(src, i);
                i = next;
                const body = convert(arg);
                out += /^[A-Za-z0-9]{1,3}$/.test(body) ? `√${body}` : `√(${body})`;
            } else if (name in SYMBOLS) {
                out += SYMBOLS[name];
                if (BIG_OPS.has(name)) lastBig = true;
            } else {
                // Fractions, roots, accents, matrices and anything else need real typesetting.
                throw new Unsupported();
            }
            continue;
        }
        if (c === '^' || c === '_') {
            // A summation or integral with limits is not a one-liner.
            if (big) throw new Unsupported();
            const [arg, next] = readArg(src, i + 1);
            i = next;
            const body = convert(arg);
            if (c === '^' && SUPERSCRIPT_DIGITS[body]) out += SUPERSCRIPT_DIGITS[body];
            else if (/^-?[A-Za-z0-9]+$/.test(body)) out += `${c}${body}`;
            else out += `${c}(${body})`;
            continue;
        }
        if (c === '{') {
            const [inner, next] = readGroup(src, i);
            out += convert(inner);
            i = next;
            continue;
        }
        if (c === '}' || c === '&' || c === '#' || c === '$' || c === '"') throw new Unsupported();
        if (c === '~') { out += ' '; i++; continue; }
        out += c;
        i++;
    }
    return out;
}

/**
 * Plain-text form of a simple inline formula: Greek letters, operators, relations,
 * arrows, text styling, and sub/superscripts (x², a_i, x^(n+1)). Returns null for
 * anything that needs real typesetting (fractions, roots, accents, matrices,
 * limits) so the caller can show the TeX source instead of a wrong approximation.
 * Non-Latin-1 characters go through the fallback-font pass like any other text
 * and degrade to ASCII stand-ins when no font covers them.
 */
export function simplifyTeX(tex: string): string | null {
    const t = tex.trim();
    if (!t || t.length > 160) return null;
    try {
        const out = convert(t).replace(/\s+/g, ' ').trim();
        return out || null;
    } catch (err) {
        if (err instanceof Unsupported) return null;
        throw err;
    }
}
