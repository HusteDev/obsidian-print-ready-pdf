# Settings and frontmatter reference

Everything below is optional. With the default settings, exports look the same as before these options existed. The only visible addition is the PDF title and other info that viewers show in the document properties.

## PDF metadata

Under **Settings → Print-Ready PDF → PDF metadata**. The plugin writes these fields into the PDF info dictionary, and viewers show them in the document properties and the window title.

For each field you can type the name of the frontmatter property to read it from. Leave the box empty to use the default property. Property names match exactly first, then ignoring case. Lists are joined with commas, and values that are objects are ignored.

| Field | Default property | When the property is missing or empty |
| --- | --- | --- |
| Title | `title` | Auto-filled with the note name (without `.md`). |
| Author | `author` | Not auto-filled: left blank and left out of the PDF. |
| Subject | `subject` | Not auto-filled: left blank and left out of the PDF. |
| Keywords | `keywords` | Auto-filled with the note's tags (without `#`). Blank if the note has no tags. |
| Creator | not read | Always `Print-Ready PDF Export`. |
| Creation date | not read | Always the time of the export. |

Example frontmatter:

```yaml
---
title: Quarterly report
author: Ann Lee
subject: Sales, Q3
keywords: [sales, report]
---
```

If your notes use other property names, type them in the settings, for example `by` for Author or `summary` for Subject.

The **Embed metadata** toggle (on by default) turns the whole section off. With it off, none of the fields above are written and the PDF keeps the library's default creator.

The frontmatter is read from Obsidian's cache for the file, so a change you just typed may not be used until Obsidian has saved and re-indexed the note.

## Table of contents

Settings: **Add a table of contents** (off by default), **Heading levels** (1, 1 to 2, or 1 to 3) and **Title** (default `Contents`, empty for none).

The contents go on their own first page, with page numbers, and the note starts on the second page. A note can switch it on or off for itself with `pdf-toc`. If the note has no headings at the chosen levels, no contents page is added.

The page numbers in the contents are the real pages of the PDF. If you set a **First page number** other than 1, the printed numbers differ from the contents.

## Headers and footers

Six optional text fields: header and footer, each with left, center and right. Leave all header fields empty for no header. Variables:

| Variable | Replaced with |
| --- | --- |
| `{title}` | the PDF title (see the metadata rules above) |
| `{date}` | the export date, YYYY-MM-DD |
| `{page}` | the page number as printed |
| `{pages}` | the last page number as printed |
| `{mode}` | `print` or `preserve` |

The page number setting (**Include page numbers**, format and position) keeps working. If footer text is in the same position as the page number, the text comes first, then a dot, then the number, for example `Draft · 3 / 8`. **First page number** sets the number printed on page 1, and **Hide number on first page** leaves the number off page 1 only. Header and footer text can only use characters the built-in fonts have. Others become a plain stand-in or `?`.

## Body font

**Sans** uses Helvetica and **Serif** uses Times. Both are built into every PDF viewer, so no font is embedded. Code blocks always stay in Courier.

## File name and opening

- **File name** is a template for the PDF name without `.pdf`. Variables: `{file}` (note name), `{title}`, `{date}` and `{mode}`. The default is `{file}-{mode}`, which gives `note-print.pdf`. Characters that are not allowed in file names are removed, and an empty result falls back to the default. An existing file is never overwritten; a number is added instead.
- **Open the PDF after export** opens the saved PDF in a new tab in Obsidian.
- **Show ribbon icon** adds a ribbon button that exports the current note in the default mode.

## Commands

- **Export to PDF (default mode)**, **Export to PDF (print optimized)** and **Export to PDF (preserve formatting)**.
- **Export selection to PDF** exports only the selected text, rendered as a note body. The file name gets `-selection` at the end. It is also in the editor's right-click menu when text is selected. Frontmatter overrides and metadata come from the note's own frontmatter.

## Per-note overrides

A note can change settings for its own exports with these frontmatter properties:

| Property | Values |
| --- | --- |
| `pdf-page-size` | `LETTER`, `A4`, `LEGAL`, `TABLOID`, `A3`, `A5` |
| `pdf-orientation` | `portrait` or `landscape` |
| `pdf-margins` | one number for all sides, or four numbers `top right bottom left`, in points (0 to 300) |
| `pdf-mode` | `print` or `preserve`; used only by the default-mode commands, not the print and preserve ones |
| `pdf-toc` | `true` or `false` |

```yaml
---
title: Wide table
pdf-page-size: A4
pdf-orientation: landscape
pdf-margins: 36
pdf-toc: true
---
```

Invalid values are ignored, and a message is written to the developer console.
