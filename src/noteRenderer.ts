import { App, Component, MarkdownRenderer } from 'obsidian';
import { PAGEBREAK_SENTINEL } from './types';
import { renderRtableFallbacks } from './rtableDom';

const SETTLE_TIMEOUT_MS = 10_000;
const QUIET_MS = 300;

/**
 * A line of 3+ `=` directly under a paragraph or list item is parsed as a setext H1
 * underline. Replace such lines (outside frontmatter and fenced code) with a
 * standalone sentinel paragraph so the extractor can emit a page break instead.
 */
export function protectPageBreaks(markdown: string): string {
    const lines = markdown.split('\n');
    let i = 0;
    if (/^---\s*$/.test(lines[0] ?? '')) {
        for (let j = 1; j < lines.length; j++) {
            if (/^(---|\.\.\.)\s*$/.test(lines[j])) { i = j + 1; break; }
        }
    }
    const out = lines.slice(0, i);
    let fence: { ch: string; len: number } | null = null;
    for (; i < lines.length; i++) {
        const line = lines[i];
        const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (f) {
            if (!fence) fence = { ch: f[1][0], len: f[1].length };
            else if (f[1][0] === fence.ch && f[1].length >= fence.len && /^\s{0,3}(`+|~+)\s*$/.test(line)) fence = null;
            out.push(line);
        } else if (!fence && /^\s{0,3}={3,}\s*\r?$/.test(line)) {
            out.push('', PAGEBREAK_SENTINEL, '');
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
}

const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

/**
 * Renders markdown with Obsidian's own reading-view pipeline into a detached,
 * off-screen element that is still attached to the document, so theme CSS,
 * layout, embeds and plugin post-processors all run. Caller must call `dispose`.
 */
export interface RenderedNote {
    el: HTMLElement;
    dispose(): void;
}

export async function renderNote(
    app: App,
    markdown: string,
    sourcePath: string,
    widthPx: number,
): Promise<RenderedNote> {
    const component = new Component();
    component.load();
    const host = document.body.createDiv({ cls: 'markdown-preview-view markdown-rendered pdfmake-render-host' });
    host.setAttribute('style', [
        'position:fixed', 'left:-100000px', 'top:0', `width:${Math.round(widthPx)}px`,
        'visibility:hidden', 'pointer-events:none', 'overflow:visible', 'height:auto',
    ].join(';'));
    const dispose = () => {
        component.unload();
        host.remove();
    };
    try {
        await MarkdownRenderer.render(app, markdown, host, sourcePath, component);
        await renderRtableFallbacks(app, host, sourcePath, component);
        await settle(host);
        return { el: host, dispose };
    } catch (err) {
        dispose();
        throw err;
    }
}

/** Wait for async post-processors (embeds, mermaid, dataview, images) to finish. */
async function settle(host: HTMLElement): Promise<void> {
    let lastChange = Date.now();
    const observer = new MutationObserver(() => { lastChange = Date.now(); });
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    const start = Date.now();
    try {
        while (Date.now() - start < SETTLE_TIMEOUT_MS) {
            await sleep(100);
            const loading = host.querySelector('.is-loading') !== null;
            const imagesPending = Array.from(host.querySelectorAll('img')).some(i => !i.complete);
            if (!loading && !imagesPending && Date.now() - lastChange >= QUIET_MS) return;
        }
        console.warn('[Print-Ready PDF] Rendered note did not settle within the timeout; exporting as-is');
    } finally {
        observer.disconnect();
    }
}
