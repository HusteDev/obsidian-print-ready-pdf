# Print-Ready PDF Export

Export an Obsidian note to PDF with [pdfmake](https://github.com/bpampuch/pdfmake). Two modes, explicit page breaks, and full layout control.

## Features

- **Print optimized** mode: clean, print-friendly output. All text, callouts, links and code are black and white by default; turn on "Print text in color" in settings to print colors as displayed. Images are never converted.
- **Preserve formatting** mode: keeps Obsidian's styling (heading sizes, callout colors, highlights, code blocks) on a white page with dark text. An optional setting (off by default) renders a dark page instead.
- Embeds vault and remote images from `![[image.png]]`, `![[image.png|300]]` and `![alt](path/image.png)`.
- Page breaks: put `===` alone on a line, or use a `> [!page-break]` callout, to force a new page (configurable).
- Page size (Letter, A4, Legal, Tabloid, A3, A5), orientation, margins, font size and page-number style (1, 1 of 10, 1 / 10, Page 1, Page 1 of 10, – 1 –; left, center or right) are set in the plugin's settings.
- Exports never overwrite: if the file exists, a number is appended (`note-print (1).pdf`).

<!-- TODO: capture docs/screenshot.png (settings tab and a sample exported PDF), then embed: ![Print-Ready PDF Export](docs/screenshot.png) -->

## Usage

- Command palette: **Export to PDF (default mode)**, **Export to PDF (print optimized)** or **Export to PDF (preserve formatting)** (Obsidian shows them prefixed with the plugin name).
- File menu (the note's "More options" menu) and the file explorer's right-click menu: the same exports.

The PDF is saved into your vault, in the output folder if you set one, otherwise next to the exported note.

## What is exported

The note is rendered with Obsidian's own reading-view renderer and the result is converted to PDF, so the output follows what you see in Reading view rather than the raw markup: inline HTML (`<b>`, `<span style="color:...">`, `<u>`, `<sub>`, `<details>`, raw HTML tables, alignment), callouts of every type (theme colours, inline-formatted titles, long callouts split across pages), embedded notes, footnotes, task lists, tables (alignment, spans, formatted cells), images at their specified size (`|300`, `|300x200`, `width`/`height` attributes), SVG/GIF/WebP images, Mermaid diagrams, `%%comments%%` and HTML comments (hidden), and front matter (omitted). The note is read from the editor, so unsaved edits are included.

## Limitations

- The built-in fonts (Helvetica and Courier) cover Western European text (Windows-1252). Other scripts, arrows, symbols and emoji need a fallback font you add yourself; see "Non-Latin characters and symbols" below. Without one they are replaced with `?`. Fallback fonts have a single weight, so bold or italic text in those scripts prints in regular weight.
- An image in the middle of a line of text is placed on its own line, between the text before and after it.
- Math (LaTeX) is exported as plain glyph text, not typeset. PDF, audio and video embeds become a placeholder line. Interactive plugin output is exported as Reading view shows it once it has finished rendering.
- Preserve mode does not follow your Obsidian theme: page, text and code colors are fixed, and only callout colors come from the theme.
- Mobile: it has not been verified on a device yet. Everything except reading fallback fonts from an absolute disk path (desktop only, via Node's `fs`) uses browser and Obsidian APIs; it writes through the vault API and downscales images (longest edge 1400 px on phones, 1800 px on desktop; JPEGs stay JPEG). WOFF and WOFF2 fallback fonts need the browser's `DecompressionStream` (Electron, iOS 16.4+, Android WebView). PDF layout runs on the main thread, so very long notes make the app pause for a few seconds while "Building PDF…" shows; phones can run out of memory on notes with hundreds of large images.

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
