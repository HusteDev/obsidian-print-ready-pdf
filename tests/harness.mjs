// Builds PDFs from a sample document and checks the new options. Run: node tests/harness.mjs [baselineDir]
// With a baselineDir (another checkout of this repo, e.g. a worktree of 0.1.1) it also checks that the
// default settings give the same document definition as that version, apart from the added PDF info.
// Runs under Node with a stand-in for the obsidian module, so nothing here touches Obsidian itself.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const stub = path.join(here, 'obsidian-stub.mjs');

async function bundle(srcRoot, name, withHelpers = true) {
    const outfile = path.join(root, 'node_modules', '.cache-harness', `${name}.cjs`);
    await esbuild.build({
        absWorkingDir: srcRoot,
        stdin: {
            contents: [
                "export * from './src/pdfExporter';",
                "export * from './src/types';",
                ...(withHelpers ? [
                    "export * as metadata from './src/metadata';",
                    "export * as templates from './src/templates';",
                    "export * as overrides from './src/noteOverrides';",
                ] : []),
            ].join('\n'),
            resolveDir: srcRoot,
            loader: 'ts',
        },
        bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'error',
        alias: { obsidian: stub },
        loader: { '.afm': 'text', '.ttf': 'binary' },
        external: ['pdfmake/build/pdfmake', 'mathjax-full/*'],
    });
    return require(outfile);
}

// ── Sample document ────────────────────────────────────────────────────────

const t = (text, extra = {}) => ({ text, ...extra });
const nodes = [
    { type: 'heading', level: 1, content: [t('Introduction')], id: 'introduction' },
    { type: 'paragraph', content: [t('Plain, '), t('bold', { bold: true }), t(' and '), t('code', { monospace: true }), t('.')] },
    { type: 'heading', level: 2, content: [t('Details')] },
    { type: 'list', ordered: false, start: 1, items: [{ content: [{ type: 'paragraph', content: [t('one')] }] }, { content: [{ type: 'paragraph', content: [t('two')] }] }] },
    { type: 'code_block', language: 'python', code: 'print("hi")\nfor i in range(3):\n    print(i)' },
    { type: 'page_break' },
    { type: 'heading', level: 2, content: [t('Second page')] },
    { type: 'table', headerRows: 1, rows: [[{ content: [{ type: 'paragraph', content: [t('A')] }], header: true, colSpan: 1, rowSpan: 1 }, { content: [{ type: 'paragraph', content: [t('B')] }], header: true, colSpan: 1, rowSpan: 1 }], [{ content: [{ type: 'paragraph', content: [t('1')] }], header: false, colSpan: 1, rowSpan: 1 }, { content: [{ type: 'paragraph', content: [t('2')] }], header: false, colSpan: 1, rowSpan: 1 }]] },
    { type: 'callout', calloutType: 'tip', title: [t('Tip')], content: [{ type: 'paragraph', content: [t('A callout.')] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [t('Quoted.')] }] },
    { type: 'horizontal_rule' },
    { type: 'heading', level: 3, content: [t('Third level')] },
    { type: 'paragraph', content: [t('End.')] },
];

// ── PDF helpers ────────────────────────────────────────────────────────────

const FONTS = {
    Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
    Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
    Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
};

async function renderBytes(docDef) {
    const PdfPrinter = require('pdfmake/src/printer');
    const doc = new PdfPrinter(FONTS).createPdfKitDocument({ ...docDef, compress: false }, {});
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    await new Promise(resolve => { doc.on('end', resolve); doc.end(); });
    return Buffer.concat(chunks).toString('latin1');
}

function infoString(pdf, key) {
    // pdfkit writes each info value as its own indirect object: "/Title 15 0 R" ... "15 0 obj (text) endobj".
    const ref = new RegExp(String.raw`/${key}\s+(\d+) 0 R`).exec(pdf);
    if (!ref) return undefined;
    const obj = new RegExp(String.raw`\n${ref[1]} 0 obj\n([\s\S]*?)\nendobj`).exec(pdf);
    if (!obj) return undefined;
    const v = obj[1].trim();
    if (v.startsWith('(')) {
        const raw = v.slice(1, -1).replace(/\\(.)/g, '$1');
        // UTF-16 strings start with the byte order mark.
        return raw.startsWith('þÿ') ? Buffer.from(raw.slice(2), 'latin1').swap16().toString('utf16le') : raw;
    }
    if (v.startsWith('<')) {
        const bytes = Buffer.from(v.slice(1, -1), 'hex');
        return bytes[0] === 0xfe && bytes[1] === 0xff ? bytes.subarray(2).swap16().toString('utf16le') : bytes.toString('latin1');
    }
    return v;
}

/** Text drawn on each page, decoded from the (uncompressed) content streams. */
function pageTexts(pdf) {
    const pages = [];
    for (const m of pdf.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
        const body = m[1];
        if (!body.includes(' TJ') && !body.includes(' Tj')) continue;
        let text = '';
        for (const arr of body.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
            for (const h of arr[1].matchAll(/<([0-9a-fA-F]*)>/g)) text += Buffer.from(h[1], 'hex').toString('latin1');
            text += '\n';
        }
        pages.push(text.replace(/\s+/g, ' ').trim());
    }
    return pages;
}

const baseNames = pdf => [...pdf.matchAll(/\/BaseFont\s*\/([A-Za-z-]+)/g)].map(m => m[1]);

// ── Tests ──────────────────────────────────────────────────────────────────

let passed = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log(`ok   ${name}`); });

const mod = await bundle(root, 'new');
const { PDFExporter, DEFAULT_SETTINGS } = mod;
const { metadata, templates, overrides } = mod;

function buildDef(settings, mode = 'print', info) {
    const ex = new PDFExporter({}, { ...DEFAULT_SETTINGS, ...settings });
    ex.info = info ?? { title: 'Sample note', creator: 'Print-Ready PDF Export', creationDate: new Date('2026-01-02T03:04:05Z') };
    ex.exportedAt = new Date('2026-01-02T03:04:05');
    ex.baseName = 'Sample note';
    return ex.buildDocDef(structuredClone(nodes), mode);
}

await check('metadata: frontmatter value, missing key, and empty key use the right sources', () => {
    const ctx = { basename: 'My note', tags: ['#alpha', 'beta'], exportedAt: new Date() };
    const keys = { title: '', author: '', subject: '', keywords: '' };
    let info = metadata.resolveMetadata({ title: 'Real title', author: ['Ann', 'Bob'], subject: 'S', keywords: 'x, y' }, keys, ctx);
    assert.deepEqual([info.title, info.author, info.subject, info.keywords], ['Real title', 'Ann, Bob', 'S', 'x, y']);
    info = metadata.resolveMetadata({}, keys, ctx);
    assert.equal(info.title, 'My note');
    assert.equal(info.author, undefined);
    assert.equal(info.subject, undefined);
    assert.equal(info.keywords, 'alpha, beta');
    info = metadata.resolveMetadata(null, keys, { ...ctx, tags: [] });
    assert.equal(info.keywords, undefined);
    assert.equal(info.creator, 'Print-Ready PDF Export');
    info = metadata.resolveMetadata({ by: 'Cara', Title: 'Case' }, { ...keys, author: 'by' }, ctx);
    assert.equal(info.author, 'Cara');
    assert.equal(info.title, 'Case', 'property names also match ignoring case');
    info = metadata.resolveMetadata({ title: { nested: true }, author: 42, subject: '   ' }, keys, ctx);
    assert.equal(info.title, 'My note', 'objects are ignored');
    assert.equal(info.author, '42');
    assert.equal(info.subject, undefined, 'blank strings count as missing');
    info = metadata.resolveMetadata({ tags: ['#a', 'b'] }, { ...keys, keywords: 'tags' }, { ...ctx, tags: [] });
    assert.equal(info.keywords, 'a, b');
});

await check('metadata: info dictionary is written and read back from the PDF', async () => {
    const info = { title: 'Sample note', author: 'Ann', subject: 'Testing', keywords: 'a, b', creator: 'Print-Ready PDF Export', creationDate: new Date('2026-01-02T03:04:05Z') };
    const pdf = await renderBytes(buildDef({}, 'print', info));
    assert.equal(infoString(pdf, 'Title'), 'Sample note');
    assert.equal(infoString(pdf, 'Author'), 'Ann');
    assert.equal(infoString(pdf, 'Subject'), 'Testing');
    assert.equal(infoString(pdf, 'Keywords'), 'a, b');
    assert.equal(infoString(pdf, 'Creator'), 'Print-Ready PDF Export');
    assert.match(infoString(pdf, 'CreationDate') ?? '', /^D:20260102/);
    assert.match(pdf, /DisplayDocTitle\s+true/, 'viewers show the title');
    const blank = await renderBytes(buildDef({}, 'print', { title: 'T', creator: 'Print-Ready PDF Export', creationDate: new Date() }));
    assert.equal(infoString(blank, 'Author'), undefined, 'blank fields are left out');
    const off = await renderBytes(buildDef({ embedMetadata: false }));
    assert.equal(infoString(off, 'Title'), undefined);
    assert.equal(infoString(off, 'Creator'), 'pdfmake', 'with metadata off pdfmake keeps its own creator');
});

await check('table of contents: entries, levels and page numbers', async () => {
    const def = buildDef({ includeToc: true, tocMaxLevel: 2, tocTitle: 'Contents' });
    const pdf = await renderBytes(def);
    const pages = pageTexts(pdf);
    const toc = pages[0];
    assert.match(toc, /Contents/);
    assert.match(toc, /Introduction/);
    assert.match(toc, /Details/);
    assert.match(toc, /Second page/);
    assert.doesNotMatch(toc, /Third level/, 'level 3 is not listed with levels 1-2');
    // The sample has headings on physical pages 2 and 3 once the contents page is added.
    assert.match(toc, /Introduction 2/);
    assert.ok(pages.length >= 3, `content starts after the contents page (${pages.length} pages)`);
    const level1 = pageTexts(await renderBytes(buildDef({ includeToc: true, tocMaxLevel: 1 })))[0];
    assert.doesNotMatch(level1, /Details/);
    const none = pageTexts(await renderBytes(buildDef({ includeToc: false })));
    assert.doesNotMatch(none[0], /Contents/);
    const untitled = pageTexts(await renderBytes(buildDef({ includeToc: true, tocTitle: '' })))[0];
    assert.match(untitled, /Introduction/);
});

await check('header and footer: variables, slots and page numbers', async () => {
    const pdf = await renderBytes(buildDef({
        headerLeft: '{title}', headerRight: '{mode} {date}', footerLeft: 'Page {page} of {pages}',
        includePageNumbers: true, pageNumberFormat: 'n', pageNumberAlign: 'right',
    }));
    const pages = pageTexts(pdf);
    assert.ok(pages.length >= 2);
    assert.match(pages[0], /Sample note/);
    assert.match(pages[0], /print 2026-01-02/);
    assert.match(pages[0], /Page 1 of 2/);
    assert.match(pages[1], /Page 2 of 2/);
    const joined = pageTexts(await renderBytes(buildDef({ footerRight: 'Draft', includePageNumbers: true, pageNumberFormat: 'n', pageNumberAlign: 'right' })));
    assert.match(joined[0], /Draft · 1/, 'text then a dot then the page number in the same slot');
});

await check('page numbers: first number and hiding the first page', async () => {
    const pages = pageTexts(await renderBytes(buildDef({ pageNumberStart: 5, hidePageNumberOnFirstPage: true, pageNumberFormat: 'n-slash-total' })));
    assert.doesNotMatch(pages[0], /5 \/ 6/, 'the first page shows no number');
    assert.match(pages[1], /6 \/ 6/, 'the second page is numbered from the starting number');
    const hidden = pageTexts(await renderBytes(buildDef({ hidePageNumberOnFirstPage: true, pageNumberFormat: 'n' })));
    assert.doesNotMatch(hidden[0], /\b1\b/, 'no number on the first page');
    assert.match(hidden[1], /\b2\b/, 'the second page keeps its number');
});

await check('font: Times is used only when serif is selected; code stays Courier', async () => {
    const sans = baseNames(await renderBytes(buildDef({})));
    assert.ok(sans.some(n => n.startsWith('Helvetica')));
    assert.ok(!sans.some(n => n.startsWith('Times')), 'no Times font in a sans PDF');
    const serif = baseNames(await renderBytes(buildDef({ bodyFont: 'serif' })));
    assert.ok(serif.some(n => n.startsWith('Times')));
    assert.ok(serif.some(n => n.startsWith('Courier')), 'code blocks stay Courier');
    assert.ok(!serif.some(n => n === 'Helvetica'), 'body text is not Helvetica');
});

await check('file name template and per-note overrides', () => {
    const vars = { title: 'My: Title?', file: 'note', mode: 'print', date: '2026-01-02' };
    assert.equal(templates.exportStem('{file}-{mode}', vars), 'note-print');
    assert.equal(templates.exportStem('{title}-{date}-{mode}', vars), 'My Title -2026-01-02-print');
    assert.equal(templates.exportStem('', vars), 'note-print', 'an empty template uses the default');
    assert.equal(templates.exportStem('???', vars), 'note-print', 'a template that leaves nothing uses the default');
    assert.equal(templates.exportStem('{file}-{mode}', vars, '-selection'), 'note-print-selection');
    const warnings = [];
    const o = overrides.parseNoteOverrides({
        'pdf-page-size': 'a4', 'pdf-orientation': 'Landscape', 'pdf-margins': '36 40 36 40', 'pdf-mode': 'preserve', 'pdf-toc': 'true',
    }, w => warnings.push(w));
    assert.deepEqual(o, { pageSize: 'A4', pageOrientation: 'landscape', margins: [36, 40, 36, 40], mode: 'preserve', toc: true });
    assert.equal(warnings.length, 0);
    const bad = overrides.parseNoteOverrides({ 'pdf-page-size': 'huge', 'pdf-orientation': 3, 'pdf-margins': [1, 2], 'pdf-mode': 'x', 'pdf-toc': 'maybe' }, w => warnings.push(w));
    assert.deepEqual(bad, {});
    assert.equal(warnings.length, 5, 'each invalid value is reported');
    assert.deepEqual(overrides.parseNoteOverrides({ 'pdf-margins': 50 }).margins, [50, 50, 50, 50]);
    assert.deepEqual(overrides.parseNoteOverrides({ 'pdf-margins': [10, 20, 30, 40] }).margins, [10, 20, 30, 40]);
    assert.equal(overrides.parseNoteOverrides({ 'pdf-margins': 999 }).margins, undefined, 'out of range is ignored');
    const applied = overrides.applyNoteOverrides({ ...DEFAULT_SETTINGS }, o);
    assert.equal(applied.pageSize, 'A4');
    assert.equal(applied.marginLeft, 40);
    assert.equal(applied.includeToc, true);
    assert.equal(DEFAULT_SETTINGS.pageSize, 'LETTER', 'the saved settings are not changed');
});

await check('page size and orientation overrides change the PDF page', async () => {
    const def = buildDef(overrides.applyNoteOverrides({ ...DEFAULT_SETTINGS }, { pageSize: 'A4', pageOrientation: 'landscape' }));
    const pdf = await renderBytes(def);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    assert.ok(box, 'media box found');
    assert.ok(Math.abs(Number(box[1]) - 841.89) < 0.5 && Math.abs(Number(box[2]) - 595.28) < 0.5, `A4 landscape, got ${box[1]} x ${box[2]}`);
});

const baselineDir = process.argv[2];
if (baselineDir) {
    await check(`defaults match the baseline document definition (${path.basename(baselineDir)})`, async () => {
        const old = await bundle(path.resolve(baselineDir), 'baseline', false);
        for (const mode of ['print', 'preserve']) {
            const make = (m) => {
                const ex = new m.PDFExporter({}, { ...m.DEFAULT_SETTINGS });
                ex.info = { title: 'x', creator: 'x', creationDate: new Date() };
                return ex.buildDocDef(structuredClone(nodes), mode);
            };
            // Header, footer and background are functions: compare what they return. Other functions
            // (table layouts) are compared by source, which is unchanged.
            const strip = def => JSON.stringify({
                ...def,
                header: typeof def.header === 'function' ? def.header(1, 3, { width: 600, height: 800 }) : def.header,
                footer: typeof def.footer === 'function' ? def.footer(1, 3, { width: 600, height: 800 }) : def.footer,
                background: typeof def.background === 'function' ? def.background(1, { width: 600, height: 800 }) : def.background,
            }, (k, v) => (typeof v === 'function' ? `fn:${v.toString()}` : v));
            const a = make(old);
            const b = make(mod);
            delete b.info;
            delete b.displayTitle;
            assert.equal(strip(b), strip(a), `${mode}: the document definition is unchanged apart from PDF info`);
        }
    });
}

console.log(`\n${passed} checks passed`);
