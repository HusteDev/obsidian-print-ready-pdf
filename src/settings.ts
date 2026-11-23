import { App, PluginSettingTab, Setting } from 'obsidian';
import type PDFMakePlugin from './main';
import type { PDFMakeSettings } from './types';
import { PAGE_NUMBER_FORMATS } from './pageNumbers';
import { FONT_EXTENSIONS } from './fallbackFonts';

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
            .setDesc('Paper size of the exported PDF.')
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
            .setDesc('Body text size. Heading sizes are fixed.')
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
            .setDesc('Reduce the font size so the longest line fits without wrapping.')
            .addToggle(t => t
                .setValue(this.plugin.settings.codeShrinkToFit)
                .onChange(async v => {
                    this.plugin.settings.codeShrinkToFit = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Show code block language')
            .setDesc('Print the language name above each fenced code block that has one.')
            .addToggle(t => t
                .setValue(this.plugin.settings.showCodeLanguage)
                .onChange(async v => {
                    this.plugin.settings.showCodeLanguage = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Minimum code font size (pt)')
            .setDesc('Longer lines wrap below this size.')
            .addSlider(s => s
                .setLimits(5, 10, 0.5)
                .setValue(this.plugin.settings.codeMinFontSize)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.codeMinFontSize = v;
                    await this.plugin.saveSettings();
                })
            );

        // ── Fonts ────────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Fallback fonts').setHeading();
        containerEl.createEl('p', {
            text: 'The built-in fonts only cover Western European characters. To export CJK, Cyrillic, Greek, symbols or emoji, add font files (.ttf, .otf, .ttc, .woff, .woff2). Each character uses the first font in this list that has it. A small symbol font (Greek letters and common math symbols) is built in; fonts added here take priority. Fonts are read only when a note needs them. Use a vault path or an absolute path. CJK fonts are large, so a regional subset keeps exports fast.',
            cls: 'setting-item-description',
        });

        const listId = 'print-ready-pdf-font-list';
        const dl = containerEl.createEl('datalist', { attr: { id: listId } });
        for (const f of this.app.vault.getFiles()) {
            if (FONT_EXTENSIONS.includes(f.extension.toLowerCase())) dl.createEl('option', { value: f.path });
        }

        const fonts = this.plugin.settings.fallbackFonts;
        const save = async (list: string[]) => {
            this.plugin.settings.fallbackFonts = list;
            await this.plugin.saveSettings();
        };
        fonts.forEach((path, i) => {
            new Setting(containerEl)
                .setName(`Fallback font ${i + 1}`)
                .addText(t => {
                    t.setPlaceholder('Fonts/NotoSansCJK-Regular.ttc')
                        .setValue(path)
                        .onChange(async v => {
                            const list = [...this.plugin.settings.fallbackFonts];
                            list[i] = v.trim();
                            await save(list);
                        });
                    t.inputEl.setAttr('list', listId);
                    t.inputEl.addClass('pdfmake-font-input');
                })
                .addExtraButton(b => b
                    .setIcon('trash')
                    .setTooltip('Remove')
                    .onClick(async () => {
                        await save(this.plugin.settings.fallbackFonts.filter((_, j) => j !== i));
                        this.display();
                    })
                );
        });
        new Setting(containerEl)
            .addButton(b => b
                .setButtonText('Add fallback font')
                .onClick(async () => {
                    await save([...this.plugin.settings.fallbackFonts, '']);
                    this.display();
                })
            );

        // ── Page Breaks ──────────────────────────────────────────────────────

        new Setting(containerEl).setName('Page breaks').setHeading();

        new Setting(containerEl)
            .setName('Page break syntax')
            .setDesc('Which syntax forces a page break: a line with ===, a > [!page-break] callout, or both.')
            .addDropdown(d => d
                .addOptions({
                    both:          'Both (recommended)',
                    'triple-equals': '=== only',
                    callout:       'Callout only',
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
        const li1 = ul.createEl('li');
        li1.createEl('code', { text: '===' });
        li1.appendText(' — shown as a "— Page Break —" marker in reading view');
        const li2 = ul.createEl('li');
        li2.createEl('code', { text: '> [!page-break]' });
        li2.appendText(' — renders as an ordinary callout in Obsidian (no page-break marker); the break happens only in the exported PDF');

        // ── Export ───────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Export options').setHeading();

        new Setting(containerEl)
            .setName('Default export mode')
            .setDesc('Used by "Export to PDF (default mode)". Print optimized is a plain print layout; Preserve formatting keeps Obsidian\'s styling (callout colors, highlights, heading sizes). The other commands always use their own mode.')
            .addDropdown(d => d
                .addOptions({
                    print:    'Print optimized',
                    preserve: 'Preserve formatting',
                })
                .setValue(this.plugin.settings.defaultMode)
                .onChange(async v => {
                    this.plugin.settings.defaultMode = v as PDFMakeSettings['defaultMode'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Print text in color')
            .setDesc('Print optimized is black and white by default. Turn on to print text colors as displayed. Images are never converted.')
            .addToggle(t => t
                .setValue(this.plugin.settings.printInColor)
                .onChange(async v => {
                    this.plugin.settings.printInColor = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Dark page in preserve mode')
            .setDesc('Dark page with light text. Uses a lot of ink.')
            .addToggle(t => t
                .setValue(this.plugin.settings.preserveDarkPage)
                .onChange(async v => {
                    this.plugin.settings.preserveDarkPage = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Include page numbers')
            .addToggle(t => t
                .setValue(this.plugin.settings.includePageNumbers)
                .onChange(async v => {
                    this.plugin.settings.includePageNumbers = v;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.settings.includePageNumbers) {
            new Setting(containerEl)
                .setName('Page number format')
                .addDropdown(d => d
                    .addOptions(PAGE_NUMBER_FORMATS)
                    .setValue(this.plugin.settings.pageNumberFormat)
                    .onChange(async v => {
                        this.plugin.settings.pageNumberFormat = v as PDFMakeSettings['pageNumberFormat'];
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('Page number position')
                .addDropdown(d => d
                    .addOptions({ left: 'Left', center: 'Center', right: 'Right' })
                    .setValue(this.plugin.settings.pageNumberAlign)
                    .onChange(async v => {
                        this.plugin.settings.pageNumberAlign = v as PDFMakeSettings['pageNumberAlign'];
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName('Output folder')
            .setDesc('Vault folder for saved PDFs. Leave empty to save next to the note. Existing files are never overwritten.')
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
