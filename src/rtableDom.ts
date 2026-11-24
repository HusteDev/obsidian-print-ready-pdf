import { App, Component, MarkdownRenderer } from 'obsidian';
import { effectiveAlign, effectiveStyle, parseRtable, RT_FONT_SIZES, rtColorCss, RtModel } from './rtable';

const FONT_FAMILIES: Record<string, string> = {
    sans: 'var(--font-interface)',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'var(--font-monospace)',
};

/** Builds the same table markup that Interactive Tables renders, so one reader handles both. */
async function buildTable(app: App, model: RtModel, sourcePath: string, component: Component): Promise<HTMLElement> {
    const root = createDiv({ cls: 'rt-root prpdf-rtable-fallback' });
    const wrap = root.createDiv({ cls: 'rt-wrap' });
    const table = wrap.createEl('table', { cls: 'rt-table' });
    const colgroup = table.createEl('colgroup');
    for (let c = 0; c < model.cols; c++) {
        const col = colgroup.createEl('col');
        const w = model.widths[c];
        if (w != null) col.setCssProps({ width: `${w}px` });
    }
    const tbody = table.createEl('tbody');
    for (let r = 0; r < model.rows; r++) {
        const tr = tbody.createEl('tr', { cls: r === 0 ? 'rt-header-row' : '' });
        for (const cell of model.cells.filter(x => x.r === r).sort((a, b) => a.c - b.c)) {
            const td = tr.createEl(r === 0 ? 'th' : 'td', { cls: 'rt-cell' });
            if (cell.rs > 1) td.rowSpan = cell.rs;
            if (cell.cs > 1) td.colSpan = cell.cs;
            const { h, v } = effectiveAlign(model, cell);
            const s = effectiveStyle(model, cell);
            const css: Record<string, string> = {};
            if (h) css['text-align'] = h;
            if (v) css['vertical-align'] = v;
            if (s.bg) css['background-color'] = rtColorCss(s.bg, true);
            if (s.color) css.color = rtColorCss(s.color, false);
            if (s.bold) css['font-weight'] = 'bold';
            if (s.italic) css['font-style'] = 'italic';
            if (s.strike) css['text-decoration'] = 'line-through';
            if (s.size) css['font-size'] = RT_FONT_SIZES[s.size];
            if (s.font) css['font-family'] = FONT_FAMILIES[s.font] ?? `"${s.font}", var(--font-text)`;
            td.setCssProps(css);
            const content = td.createDiv({ cls: 'rt-cell-content' });
            if (cell.text.trim()) await MarkdownRenderer.render(app, cell.text, content, sourcePath, component);
        }
    }
    return root;
}

/**
 * Without the Interactive Tables plugin an `rtable` block renders as a plain code block. Replace
 * each one with a table built from its source so the PDF shows a table, not raw text.
 */
export async function renderRtableFallbacks(app: App, host: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    const blocks = Array.from(host.querySelectorAll('pre')).filter(pre => pre.querySelector('code.language-rtable') !== null || pre.classList.contains('language-rtable'));
    for (const pre of blocks) {
        try {
            const model = parseRtable(pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
            if (!model) continue;
            const table = await buildTable(app, model, sourcePath, component);
            const holder = pre.parentElement;
            if (holder && holder.classList.contains('el-pre') && holder.children.length === 1) holder.replaceWith(table);
            else pre.replaceWith(table);
        } catch (err) {
            console.warn('[Print-Ready PDF] Could not read an rtable block; leaving it as code', err);
        }
    }
}
