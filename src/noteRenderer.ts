import { App, Component, MarkdownRenderer } from 'obsidian';

const SETTLE_TIMEOUT_MS = 10_000;
const QUIET_MS = 300;

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
