# Print-Ready PDF Export

Export an Obsidian note to PDF with [pdfmake](https://github.com/bpampuch/pdfmake). Two modes, explicit page breaks, and full layout control.

## Features

- **Print optimized** mode: clean, print-friendly output.
- **Preserve formatting** mode: approximates the Obsidian default dark theme (dark page, light text).
- Embeds vault images (PNG and JPEG) from `![[image.png]]`, `![[image.png|300]]` and `![alt](path/image.png)`.
- Page breaks: put `===` alone on a line, or use a `> [!page-break]` callout, to force a new page (configurable).
- Page size (Letter, A4, Legal, Tabloid, A3, A5), orientation, margins and font size are set in the plugin's settings.
- Exports never overwrite: if the file exists, a number is appended (`note-print (1).pdf`).

<!-- TODO: add screenshot (settings tab and a sample exported PDF) -->

## Usage

- Command palette: **Export to PDF (default mode)**, **Export to PDF (print optimized)** or **Export to PDF (preserve formatting)**.
- File menu (the note's "More options" menu): the same exports.

The PDF is saved into your vault, in the output folder if you set one, otherwise next to the exported note.

## Supported Markdown

Headings, paragraphs (single line breaks are kept), bold, italic, strikethrough, `==highlight==`, inline code, links, `[[wikilinks]]` (shown as plain text), bullet / numbered / task lists (nested), blockquotes, callouts (including foldable `[!note]-`), tables, fenced code blocks, horizontal rules, `%%comments%%` (removed from the output) and front matter (omitted).

## Limitations

- Only characters in the WinAnsi (Windows-1252) set render correctly: Western European languages. CJK, Cyrillic, Greek, Arabic, Hebrew, emoji and most symbols are not supported, because only the built-in Helvetica and Courier fonts are used.
- Not supported: footnotes, math (LaTeX), Mermaid and other diagram blocks, embedded notes (`![[note]]`), images inside a line of text (only images alone on a line), SVG/GIF/WebP images, remote images, nested tables, HTML.
- Preserve mode is always dark; it does not follow your current theme.
- Not yet tested on mobile.

## Installation

Until it appears in the community plugin list, install manually: copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/print-ready-pdf/`, then enable the plugin.

## Development

```
npm ci
npm run build
```

## License

MIT. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for bundled libraries.
