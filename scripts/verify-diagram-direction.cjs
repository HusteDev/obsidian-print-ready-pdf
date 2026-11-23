// Checks that a left-to-right Mermaid flowchart keeps its orientation at the
// container width the exporter uses. It runs Obsidian's own diagram renderer
// ("pele"), extracted from the installed Obsidian app bundle, so it needs
// Obsidian installed. Usage: node scripts/verify-diagram-direction.cjs [path/to/obsidian-x.y.z.asar]
const fs = require('fs');
const os = require('os');
const path = require('path');

function findAsar() {
    if (process.argv[2]) return process.argv[2];
    const dir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'obsidian');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^obsidian-.*\.asar$/.test(f)) : [];
    if (!files.length) throw new Error('No obsidian-*.asar found; pass its path as an argument.');
    return path.join(dir, files.sort().pop());
}

const buf = fs.readFileSync(findAsar());
const start = buf.indexOf('var pele=(()=>{');
const end = buf.indexOf('})();', start);
if (start < 0 || end < 0) throw new Error('Could not locate the diagram renderer in the Obsidian bundle.');
const pele = new Function(`${buf.subarray(start, end + 5).toString('utf8')}\nreturn pele;`)();

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const m = /\.pdfmake-render-host \.mermaid\s*\{[^}]*?width:\s*(\d+)px/.exec(css);
if (!m) throw new Error('styles.css has no .pdfmake-render-host .mermaid width rule.');
const exportWidth = +m[1];

const source = `flowchart LR
    A[Markdown note] --> B[Reading view]
    B --> C{Mode}
    C -->|Print| D[B&W PDF]
    C -->|Preserve| E[Styled PDF]`;

function layout(maxWidth) {
    const svg = pele.render(source, { maxWidth }).svg;
    const [, , w, h] = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
    const xs = [...svg.matchAll(/class="[^"]*node[^"]*"[^>]*transform="translate\(([-\d.]+)/g)].map(x => +x[1]);
    return { w, h, xs };
}

const narrow = layout(624); // a page-width host: Obsidian would switch to top-down here
const used = layout(exportWidth);
const increasing = used.xs.slice(0, 3).every((x, i, a) => i === 0 || x > a[i - 1]);
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
check(narrow.h > narrow.w, `624px host is laid out top-down (${narrow.w}x${narrow.h}), the bug this guards against`);
check(increasing, `at ${exportWidth}px node x-positions A<B<C increase (${used.xs.slice(0, 3).join(', ')})`);
check(used.w > used.h, `at ${exportWidth}px the diagram is wider than tall (${used.w}x${used.h})`);
process.exit(failed ? 1 : 0);
