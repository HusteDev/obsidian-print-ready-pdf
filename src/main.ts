import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { PDFMakeSettings, DEFAULT_SETTINGS, ExportMode } from './types';
import { PDFExporter } from './pdfExporter';
import { PDFMakeSettingTab } from './settings';
import { ExportProgress } from './progress';

export default class PDFMakePlugin extends Plugin {
    settings: PDFMakeSettings;
    /** Single-flight guard: one export at a time. */
    private exporting = false;
    private unloaded = false;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'export-pdf',
            name: 'Export to PDF (default mode)',
            checkCallback: (checking) => {
                if (this.app.workspace.getActiveViewOfType(MarkdownView)?.file) {
                    if (!checking) this.exportCurrentFile(this.settings.defaultMode);
                    return true;
                }
                return false;
            },
        });

        this.addCommand({
            id: 'export-pdf-print',
            name: 'Export to PDF (print optimized)',
            checkCallback: (checking) => {
                if (this.app.workspace.getActiveViewOfType(MarkdownView)?.file) {
                    if (!checking) this.exportCurrentFile('print');
                    return true;
                }
                return false;
            },
        });

        this.addCommand({
            id: 'export-pdf-preserve',
            name: 'Export to PDF (preserve formatting)',
            checkCallback: (checking) => {
                if (this.app.workspace.getActiveViewOfType(MarkdownView)?.file) {
                    if (!checking) this.exportCurrentFile('preserve');
                    return true;
                }
                return false;
            },
        });

        // Show a visual "— Page Break —" indicator in reading/preview mode
        // for === markers so users know where page breaks will land.
        this.registerMarkdownPostProcessor((el) => {
            el.querySelectorAll('p').forEach(p => {
                if (this.settings.pageBreakSyntax !== 'callout' && p.children.length === 0 && p.textContent?.trim() === '===') {
                    p.addClass('pdfmake-page-break-marker');
                    p.textContent = '— Page Break —';
                }
            });
        });

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file, source) => {
                if (!['more-options', 'file-explorer-context-menu'].includes(source) || !(file instanceof TFile) || file.extension !== 'md') return;
                menu.addSeparator();
                menu.addItem(item => item
                    .setTitle('Print-Ready PDF: export (default mode)')
                    .setIcon('file-down')
                    .onClick(() => this.exportFile(file, this.settings.defaultMode)));
                menu.addItem(item => item
                    .setTitle('Print-Ready PDF: export (print optimized)')
                    .setIcon('printer')
                    .onClick(() => this.exportFile(file, 'print')));
                menu.addItem(item => item
                    .setTitle('Print-Ready PDF: export (preserve formatting)')
                    .setIcon('file-text')
                    .onClick(() => this.exportFile(file, 'preserve')));
            })
        );

        this.addSettingTab(new PDFMakeSettingTab(this.app, this));
    }

    private async exportCurrentFile(mode: ExportMode): Promise<void> {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) {
            new Notice('No active markdown file');
            return;
        }
        await this.exportFile(file, mode);
    }

    /** Prefer the live editor buffer (unsaved edits) over the file on disk. */
    private async readContent(file: TFile): Promise<string> {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) {
                return view.editor?.getValue() ?? view.getViewData();
            }
        }
        return this.app.vault.read(file);
    }

    private async exportFile(file: TFile, mode: ExportMode): Promise<void> {
        if (this.exporting) {
            new Notice('A PDF export is already running');
            return;
        }
        this.exporting = true;
        const progress = new ExportProgress();
        try {
            const content = await this.readContent(file);
            const exporter = new PDFExporter(this.app, this.settings, () => this.unloaded);
            await exporter.exportNote(content, file, mode, progress);
        } catch (err: any) {
            console.error('[Print-Ready PDF]', err);
            new Notice(`PDF export failed: ${err?.message ?? err}`);
        } finally {
            progress.hide();
            this.exporting = false;
        }
    }

    onunload() {
        // An in-flight export stops at its next checkpoint instead of writing after unload.
        this.unloaded = true;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
