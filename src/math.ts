/**
 * Typesets LaTeX to self-contained SVG with a bundled MathJax. Loaded lazily
 * (dynamic import) so the cost is only paid when a note contains display math.
 */
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js';

export interface TypesetMath {
    /** SVG markup with `currentColor` still in place. */
    svg: string;
    /** Intrinsic size in ex units (MathJax's native unit). */
    widthEx: number;
    heightEx: number;
}

let state: { adaptor: ReturnType<typeof liteAdaptor>; doc: any } | null = null;

function init() {
    if (state) return state;
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined', 'boldsymbol', 'configmacros'] });
    // fontCache 'none': every SVG is standalone, no shared <defs> to carry around.
    const svg = new SVG({ fontCache: 'none' });
    state = { adaptor, doc: mathjax.document('', { InputJax: tex, OutputJax: svg }) };
    return state;
}

/** Returns null when MathJax reports an error for this formula. */
export function typesetMath(source: string, display: boolean): TypesetMath | null {
    const { adaptor, doc } = init();
    const node = doc.convert(source, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
    const markup: string = adaptor.innerHTML(node);
    const m = markup.match(/<svg\b[^>]*>/);
    if (!m || /data-mml-node="merror"/.test(markup)) return null;
    const w = m[0].match(/\bwidth="([\d.]+)ex"/);
    const h = m[0].match(/\bheight="([\d.]+)ex"/);
    if (!w || !h) return null;
    return { svg: markup.slice(markup.indexOf(m[0])), widthEx: parseFloat(w[1]), heightEx: parseFloat(h[1]) };
}
