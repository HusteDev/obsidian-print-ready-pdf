# Print-Ready PDF Export

Export an Obsidian note to PDF with [pdfmake](https://github.com/bpampuch/pdfmake). Two modes, explicit page breaks, and full layout control.

## Features

- **Print optimized** mode: clean, print-friendly output.
- **Preserve formatting** mode: keeps Obsidian's styling (heading sizes, callout colors, highlights, code blocks) on a white page with dark text. An optional setting (off by default) renders a dark page instead.
- Embeds vault and remote images from `![[image.png]]`, `![[image.png|300]]` and `![alt](path/image.png)`.
- Page breaks: put `===` alone on a line, or use a `> [!page-break]` callout, to force a new page (configurable).
- Page size (Letter, A4, Legal, Tabloid, A3, A5), orientation, margins and font size are set in the plugin's settings.
- Exports never overwrite: if the file exists, a number is appended (`note-print (1).pdf`).

<!-- TODO: capture docs/screenshot.png (settings tab and a sample exported PDF), then embed: ![Print-Ready PDF Export](docs/screenshot.png) -->

## Usage

- Command palette: **Print-Ready PDF: export (default mode)**, **Print-Ready PDF: export (print optimized)** or **Print-Ready PDF: export (preserve formatting)**.
- File menu (the note's "More options" menu) and the file explorer's right-click menu: the same exports.

The PDF is saved into your vault, in the output folder if you set one, otherwise next to the exported note.

## What is exported

The note is rendered with Obsidian's own reading-view renderer and the result is converted to PDF, so the output follows what you see in Reading view rather than the raw markup: inline HTML (`<b>`, `<span style="color:...">`, `<u>`, `<sub>`, `<details>`, raw HTML tables, alignment), callouts of every type (theme colours, inline-formatted titles, long callouts split across pages), embedded notes, footnotes, task lists, tables (alignment, spans, formatted cells), images at their specified size (`|300`, `|300x200`, `width`/`height` attributes) including images in the middle of a line, SVG/GIF/WebP images, Mermaid diagrams, `%%comments%%` and HTML comments (hidden), and front matter (omitted). The note is read from the editor, so unsaved edits are included.

## Limitations

- Only characters in the WinAnsi (Windows-1252) set render correctly: Western European languages. CJK, Cyrillic, Greek, Arabic, Hebrew, emoji and most symbols are not supported, because only the built-in Helvetica and Courier fonts are used.
- Math (LaTeX) is exported as plain glyph text, not typeset. PDF, audio and video embeds become a placeholder line. Interactive plugin output is exported as Reading view shows it once it has finished rendering.
- Preserve mode uses fixed colors; it does not follow your Obsidian theme.
- Mobile: the code uses only browser APIs (no Node modules), writes through the vault API and downscales images (longest edge 1400 px on phones, 1800 px on desktop; JPEGs stay JPEG). It has not been verified on a device yet. PDF layout runs on the main thread, so very long notes make the app pause for a few seconds while "Building PDF…" shows; phones can run out of memory on notes with hundreds of large images.

## Installation

Until it appears in the community plugin list, install manually: copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/print-ready-pdf/`, then enable the plugin.

## Development

```
npm ci
npm run build
```

## License

MIT. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for bundled libraries.

## Non-Latin characters and symbols

The built-in PDF fonts cover Western European text only. To export CJK, Cyrillic, Greek, arrows, symbols or emoji, add one or more font files under Settings → Print-Ready PDF → Fallback fonts (vault path, or an absolute path on desktop; `.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`). Each character uses the first listed font that contains it. Fonts are loaded only when a note needs them and are not bundled. Emoji render as monochrome glyphs. On mobile, prefer a regional subset font (CJK fonts are large). Characters no font covers are replaced with `?` and a notice is shown.
