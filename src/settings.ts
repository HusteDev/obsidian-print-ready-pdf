import { App, PluginSettingTab, Setting } from 'obsidian';
import type PDFMakePlugin from './main';
import type { PDFMakeSettings } from './types';

export class PDFMakeSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: PDFMakePlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Page Layout ──────────────────────────────────────────────────────

        new Setting(containerEl).setName('Page layout').setHeading();

        new Setting(containerEl)
            .setName('Page size')
            .setDesc('Standard paper size for exported PDF')
            .addDropdown(d => d
                .addOptions({
                    LETTER:  'US Letter (8.5″ × 11″)',
                    A4:      'A4 (210 × 297 mm)',
                    LEGAL:   'US Legal (8.5″ × 14″)',
                    TABLOID: 'Tabloid (11″ × 17″)',
                    A3:      'A3 (297 × 420 mm)',
                    A5:      'A5 (148 × 210 mm)',
                })
                .setValue(this.plugin.settings.pageSize)
                .onChange(async v => {
                    this.plugin.settings.pageSize = v as PDFMakeSettings['pageSize'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Orientation')
            .addDropdown(d => d
                .addOptions({ portrait: 'Portrait', landscape: 'Landscape' })
                .setValue(this.plugin.settings.pageOrientation)
                .onChange(async v => {
                    this.plugin.settings.pageOrientation = v as PDFMakeSettings['pageOrientation'];
                    await this.plugin.saveSettings();
                })
            );

        // ── Margins ──────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Margins').setHeading();
        containerEl.createEl('p', {
            text: 'Values in points (pt). 72 pt = 1 inch, 28 pt ≈ 1 cm.',
            cls: 'setting-item-description',
        });

        const marginDefs: { key: keyof PDFMakeSettings; label: string }[] = [
            { key: 'marginTop',    label: 'Top'    },
            { key: 'marginRight',  label: 'Right'  },
            { key: 'marginBottom', label: 'Bottom' },
            { key: 'marginLeft',   label: 'Left'   },
        ];

        for (const { key, label } of marginDefs) {
            new Setting(containerEl)
                .setName(`${label} margin`)
                .addSlider(s => s
                    .setLimits(28, 180, 4)
                    .setValue(this.plugin.settings[key] as number)
                    .setDynamicTooltip()
                    .onChange(async v => {
                        (this.plugin.settings as any)[key] = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // ── Typography ───────────────────────────────────────────────────────

        new Setting(containerEl).setName('Typography').setHeading();

        new Setting(containerEl)
            .setName('Base font size (pt)')
            .setDesc('Body text size. Heading sizes are fixed per export mode and do not change with this.')
            .addSlider(s => s
                .setLimits(8, 18, 1)
                .setValue(this.plugin.settings.baseFontSize)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.baseFontSize = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Shrink code blocks to fit')
            .setDesc('Reduce a code block\'s font size just enough that its longest line fits without wrapping, so the block keeps the line breaks you wrote.')
            .addToggle(t => t
                .setValue(this.plugin.settings.codeShrinkToFit)
                .onChange(async v => {
                    this.plugin.settings.codeShrinkToFit = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Minimum code font size (pt)')
            .setDesc('Code blocks never shrink below this size; lines still too long at this size wrap.')
            .addSlider(s => s
                .setLimits(5, 10, 0.5)
                .setValue(this.plugin.settings.codeMinFontSize)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.codeMinFontSize = v;
                    await this.plugin.saveSettings();
                })
            );

        // ── Page Breaks ──────────────────────────────────────────────────────

        new Setting(containerEl).setName('Page breaks').setHeading();

        new Setting(containerEl)
            .setName('Page break syntax')
            .setDesc('Which syntax triggers a hard page break during export.')
            .addDropdown(d => d
                .addOptions({
                    both:          'Both styles (recommended)',
                    'triple-equals': 'Triple equals (===) only',
                    callout:       'Callout (> [!page-break]) only',
                })
                .setValue(this.plugin.settings.pageBreakSyntax)
                .onChange(async v => {
                    this.plugin.settings.pageBreakSyntax = v as PDFMakeSettings['pageBreakSyntax'];
                    await this.plugin.saveSettings();
                })
            );

        // Info box
        const info = containerEl.createDiv({ cls: 'pdfmake-info-box' });
        info.createEl('p', { text: 'Insert a page break anywhere in your note using either:' });
        const ul = info.createEl('ul');
        ul.createEl('li').createEl('code', { text: '===' });
        const li2 = ul.createEl('li');
        li2.createEl('code', { text: '> [!page-break]' });
        li2.appendText(' — rendered as an Obsidian callout with a visual hint in preview');

        // ── Export ───────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Export options').setHeading();

        new Setting(containerEl)
            .setName('Default export mode')
            .setDesc('Used by the "Export to PDF" command and the plain file-menu entry. The other commands always use their own mode.')
            .addDropdown(d => d
                .addOptions({
                    print:    'Print optimized: clean, black and white',
                    preserve: 'Preserve formatting: dark, approximates the Obsidian default theme',
                })
                .setValue(this.plugin.settings.defaultMode)
                .onChange(async v => {
                    this.plugin.settings.defaultMode = v as PDFMakeSettings['defaultMode'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Include page numbers')
            .setDesc('Shows "current / total" in the footer of each page.')
            .addToggle(t => t
                .setValue(this.plugin.settings.includePageNumbers)
                .onChange(async v => {
                    this.plugin.settings.includePageNumbers = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Output folder')
            .setDesc('Vault-relative folder for saved PDFs. Created if missing. Leave empty to save next to the exported note. Existing files are never overwritten; a number is appended instead.')
            .addText(t => t
                .setPlaceholder('e.g. Exports/PDF')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async v => {
                    this.plugin.settings.outputFolder = v.trim();
                    await this.plugin.saveSettings();
                })
            );
    }
}
