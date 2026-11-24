import { App, PluginSettingTab, Setting } from 'obsidian';
import { META_FIELDS, META_FIXED_INFO } from './metadata';
import { NOTE_KEYS } from './noteOverrides';
import { BodyFont } from './types';
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
            text: 'Values are in points (pt). One inch is 72 pt, and one centimetre is about 28 pt.',
            cls: 'setting-item-description',
        });

        const marginDefs: { key: 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'; label: string }[] = [
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
                    .setValue(this.plugin.settings[key])
                    .setDynamicTooltip()
                    .onChange(async v => {
                        this.plugin.settings[key] = v;
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
            .setName('Body font')
            .setDesc('Both fonts are built into every PDF viewer, so nothing is embedded. Code always stays in a monospace font.')
            .addDropdown(d => d
                .addOptions({ sans: 'Sans (Helvetica)', serif: 'Serif (Times)' })
                .setValue(this.plugin.settings.bodyFont)
                .onChange(async v => {
                    this.plugin.settings.bodyFont = v as BodyFont;
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
            text: 'The built-in fonts only cover the basic character set. To export other scripts, symbols or emoji, add font files (.ttf, .otf, .ttc, .woff, .woff2). Each character uses the first font in this list that has it. A small symbol font for math is built in; fonts added here take priority. Fonts are read only when a note needs them. Use a vault path or an absolute path. Large fonts slow exports down, so prefer a subset font.',
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

        // ── Table of contents ────────────────────────────────────────────────

        new Setting(containerEl).setName('Table of contents').setHeading();

        new Setting(containerEl)
            .setName('Add a table of contents')
            .setDesc(`Lists the headings with page numbers on its own first page. A note can turn it on or off with the ${NOTE_KEYS.toc} property.`)
            .addToggle(t => t
                .setValue(this.plugin.settings.includeToc)
                .onChange(async v => {
                    this.plugin.settings.includeToc = v;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.settings.includeToc) {
            new Setting(containerEl)
                .setName('Heading levels')
                .setDesc('The deepest heading level listed.')
                .addDropdown(d => d
                    .addOptions({ '1': 'Level 1 only', '2': 'Levels 1 to 2', '3': 'Levels 1 to 3' })
                    .setValue(String(this.plugin.settings.tocMaxLevel))
                    .onChange(async v => {
                        this.plugin.settings.tocMaxLevel = Number(v) as 1 | 2 | 3;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('Title')
                .setDesc('Heading above the table of contents. Leave empty for none.')
                .addText(t => t
                    .setPlaceholder('Contents')
                    .setValue(this.plugin.settings.tocTitle)
                    .onChange(async v => {
                        this.plugin.settings.tocTitle = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // ── Headers and footers ──────────────────────────────────────────────

        new Setting(containerEl).setName('Headers and footers').setHeading();
        const hfInfo = containerEl.createDiv({ cls: 'pdfmake-info-box' });
        hfInfo.createEl('p', { text: 'Each of the six fields is optional. Leave all header fields empty for no header. You can use these variables:' });
        const hfList = hfInfo.createEl('ul');
        for (const [name, what] of [
            ['{title}', 'the PDF title (see PDF metadata below)'],
            ['{date}', 'the export date, YYYY-MM-DD'],
            ['{page}', 'the page number as printed (see the first page number setting below)'],
            ['{pages}', 'the last page number as printed'],
            ['{mode}', 'print or preserve'],
        ]) {
            const li = hfList.createEl('li');
            li.createEl('code', { text: name });
            li.appendText(` ${what}`);
        }
        hfInfo.createEl('p', { text: 'The page number options below still work. If footer text shares a position with the page number, the text comes first, then a dot, then the number. Characters that the built-in fonts lack become a plain stand-in or a question mark.' });

        const hfFields: { key: 'headerLeft' | 'headerCenter' | 'headerRight' | 'footerLeft' | 'footerCenter' | 'footerRight'; name: string }[] = [
            { key: 'headerLeft', name: 'Header, left' },
            { key: 'headerCenter', name: 'Header, center' },
            { key: 'headerRight', name: 'Header, right' },
            { key: 'footerLeft', name: 'Footer, left' },
            { key: 'footerCenter', name: 'Footer, center' },
            { key: 'footerRight', name: 'Footer, right' },
        ];
        for (const f of hfFields) {
            new Setting(containerEl)
                .setName(f.name)
                .addText(t => t
                    .setPlaceholder(f.key.startsWith('header') ? '{title}' : '{date}')
                    .setValue(this.plugin.settings[f.key])
                    .onChange(async v => {
                        this.plugin.settings[f.key] = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // ── PDF metadata ─────────────────────────────────────────────────────

        new Setting(containerEl).setName('PDF metadata').setHeading();
        containerEl.createEl('p', {
            text: 'These fields are written into the PDF, where viewers show them in the document properties and the window title. For each field you can name the frontmatter property to read it from. Leave the box empty to use the default property shown in gray. When the property is missing or empty, the rule under each field applies.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Embed metadata')
            .setDesc('Turn off to leave all of the fields below out of the PDF.')
            .addToggle(t => t
                .setValue(this.plugin.settings.embedMetadata)
                .onChange(async v => {
                    this.plugin.settings.embedMetadata = v;
                    await this.plugin.saveSettings();
                })
            );

        for (const field of META_FIELDS) {
            new Setting(containerEl)
                .setName(field.label)
                .setDesc(`${field.autoFill}`)
                .addText(t => t
                    .setPlaceholder(field.defaultKey)
                    .setValue(this.plugin.settings.metadataKeys[field.id])
                    .onChange(async v => {
                        this.plugin.settings.metadataKeys[field.id] = v.trim();
                        await this.plugin.saveSettings();
                    })
                );
        }
        for (const fixed of META_FIXED_INFO) {
            new Setting(containerEl)
                .setName(fixed.label)
                .setDesc(`Always set automatically: ${fixed.value}. Not read from frontmatter.`);
        }

        // ── Per-note overrides ───────────────────────────────────────────────

        new Setting(containerEl).setName('Per-note overrides').setHeading();
        const ovInfo = containerEl.createDiv({ cls: 'pdfmake-info-box' });
        ovInfo.createEl('p', { text: 'A note can change some settings for its own exports with these frontmatter properties. Invalid values are ignored with a message in the developer console.' });
        const ovList = ovInfo.createEl('ul');
        for (const [key, what] of [
            [NOTE_KEYS.pageSize, 'LETTER, A4, LEGAL, TABLOID, A3 or A5'],
            [NOTE_KEYS.orientation, 'portrait or landscape'],
            [NOTE_KEYS.margins, 'one number, or four numbers: top right bottom left (points)'],
            [NOTE_KEYS.mode, 'print or preserve (used by the default-mode export only)'],
            [NOTE_KEYS.toc, 'true or false'],
        ]) {
            const li = ovList.createEl('li');
            li.createEl('code', { text: key });
            li.appendText(`: ${what}`);
        }

        // ── Export ───────────────────────────────────────────────────────────

        new Setting(containerEl).setName('Output').setHeading();

        new Setting(containerEl)
            .setName('Default export mode')
            .setDesc('Used by the default-mode export command. Print optimized is a plain print layout; preserve formatting keeps the styling from Obsidian (callout colors, highlights, heading sizes). The other commands always use their own mode.')
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

            new Setting(containerEl)
                .setName('First page number')
                .setDesc('The number printed on the first page. The table of contents still counts pages from the start of the PDF.')
                .addText(t => t
                    .setPlaceholder('1')
                    .setValue(String(this.plugin.settings.pageNumberStart))
                    .onChange(async v => {
                        const n = Number.parseInt(v, 10);
                        if (Number.isFinite(n) && n >= 0 && n <= 9999) {
                            this.plugin.settings.pageNumberStart = n;
                            await this.plugin.saveSettings();
                        }
                    })
                );

            new Setting(containerEl)
                .setName('Hide number on first page')
                .setDesc('Later pages keep their numbers.')
                .addToggle(t => t
                    .setValue(this.plugin.settings.hidePageNumberOnFirstPage)
                    .onChange(async v => {
                        this.plugin.settings.hidePageNumberOnFirstPage = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName('Output folder')
            .setDesc('Vault folder for exported PDF files. Leave empty to save next to the note. Existing files are never overwritten.')
            .addText(t => t
                .setPlaceholder('Exports/PDF')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async v => {
                    this.plugin.settings.outputFolder = v.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('File name')
            .setDesc('Template for the PDF file name, without .pdf. Variables: {file} (note name), {title}, {date} (YYYY-MM-DD) and {mode}. Characters not allowed in file names are removed. Export selection adds -selection to the end.')
            .addText(t => t
                .setPlaceholder('{file}-{mode}')
                .setValue(this.plugin.settings.filenameTemplate)
                .onChange(async v => {
                    this.plugin.settings.filenameTemplate = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Open the PDF after export')
            .setDesc('Opens the saved PDF in a new tab.')
            .addToggle(t => t
                .setValue(this.plugin.settings.openAfterExport)
                .onChange(async v => {
                    this.plugin.settings.openAfterExport = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Show ribbon icon')
            .setDesc('Adds a ribbon button that exports the current note in the default mode.')
            .addToggle(t => t
                .setValue(this.plugin.settings.showRibbonIcon)
                .onChange(async v => {
                    this.plugin.settings.showRibbonIcon = v;
                    await this.plugin.saveSettings();
                    this.plugin.updateRibbon();
                })
            );
    }
}
