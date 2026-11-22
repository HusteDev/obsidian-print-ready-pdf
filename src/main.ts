import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { PDFMakeSettings, DEFAULT_SETTINGS, ExportMode } from './types';
import { parseMarkdown } from './markdownParser';
import { PDFExporter } from './pdfExporter';
import { PDFMakeSettingTab } from './settings';

export default class PDFMakePlugin extends Plugin {
    settings: PDFMakeSettings;

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
                if (p.textContent?.trim() === '===') {
                    p.addClass('pdfmake-page-break-marker');
                    p.textContent = '— Page Break —';
                }
            });
        });

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file, source) => {
                if (source !== 'more-options' || !(file instanceof TFile) || file.extension !== 'md') return;
                menu.addSeparator();
                menu.addItem(item => item
                    .setTitle('Export to PDF (default mode)')
                    .setIcon('file-down')
                    .onClick(() => this.exportFile(file, this.settings.defaultMode)));
                menu.addItem(item => item
                    .setTitle('Export to PDF (print optimized)')
                    .setIcon('printer')
                    .onClick(() => this.exportFile(file, 'print')));
                menu.addItem(item => item
                    .setTitle('Export to PDF (preserve formatting)')
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

    private async exportFile(file: TFile, mode: ExportMode): Promise<void> {
        try {
            new Notice('Generating PDF…');
            const content = await this.app.vault.read(file);
            const nodes = parseMarkdown(content, this.settings.pageBreakSyntax);
            const exporter = new PDFExporter(this.app, this.settings);
            await exporter.exportNote(nodes, file, mode);
        } catch (err: any) {
            console.error('[Print-Ready PDF]', err);
            new Notice(`PDF export failed: ${err?.message ?? err}`);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
