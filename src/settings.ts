import { App, PluginSettingTab, Setting } from 'obsidian';
import type PDFMakePlugin from './main';
import type { PDFMakeSettings } from './types';
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

        // ── Fonts ────────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Fallback fonts').setHeading();
        containerEl.createEl('p', {
            text: 'The built-in fonts only cover Western European characters. To export CJK, Cyrillic, Greek, symbols or emoji, add font files (.ttf, .otf, .ttc, .woff, .woff2). Each character uses the first font in this list that has it. Fonts are read only when a note needs them. Nothing is bundled. Use a vault path, or on desktop an absolute path. Large fonts (CJK) use a lot of memory on mobile; prefer a regional subset.',
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
            .setDesc('Used by the "Export to PDF" command and the plain file-menu entry. The other commands always use their own mode.')
            .addDropdown(d => d
                .addOptions({
                    print:    'Print optimized: clean, black and white',
                    preserve: 'Preserve formatting: keeps Obsidian styling (callout colors, highlights, heading sizes) on a white page',
                })
                .setValue(this.plugin.settings.defaultMode)
                .onChange(async v => {
                    this.plugin.settings.defaultMode = v as PDFMakeSettings['defaultMode'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Dark page in preserve mode')
            .setDesc('Off by default. Renders preserve-formatting exports with a dark page and light text, like Obsidian\'s dark theme. Uses a lot of ink; not recommended for printing.')
            .addToggle(t => t
                .setValue(this.plugin.settings.preserveDarkPage)
                .onChange(async v => {
                    this.plugin.settings.preserveDarkPage = v;
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
