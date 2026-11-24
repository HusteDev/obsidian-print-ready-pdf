# Interactive Tables in the PDF

Print-Ready PDF Export turns `rtable` code blocks from the [Interactive Tables](https://github.com/HusteDev/obsidian-interactive-tables) plugin into real PDF tables. This note is a sample. Export it to see the result.

It works with or without that plugin installed. With it, the table is read as Reading view shows it. Without it, the block would normally show as plain code, so the export reads the block's text itself and builds the same table.

```rtable
widths: 140, auto, 220
cell-style: 3:2=bg:yellow;bold, 4:3=bg:#ffeeaa;color:#c00
| Item     | Owner       | Notes                         |
| :------- | :---------: | ----------------------------- |
| Q3 plan  | <           | Spans two columns             |
| Rollout  | **Dana**    | - step one<br>- step two      |
| ^        | Ops         | `Rollout` spans two rows      |
```

What the export keeps:

- **Merged cells.** `<` joins a cell to the one on its left, and `^` joins it to the one above.
- **Column widths.** `widths:` sets pixel widths. They keep their proportions on the page and shrink together if the table is too wide. Columns marked `auto` fit their content.
- **Header row.** The first row repeats at the top of each page when the table is long.
- **Cell formatting.** Background and text colors, bold, italic, strikethrough, size, font (sans, serif or mono) and alignment, from the `col-style`, `row-style` and `cell-style` lines.
- **Cell content.** Bold, italic, code, links, lists and line breaks inside cells.

How colors print:

- In **Print optimized** mode (black and white by default), cell backgrounds become a light grey that keeps the text readable, and text colors are dropped. Bold, italic and size stay.
- In **Preserve formatting** mode, and in Print optimized with "Print text in color" on, colors are kept. Text whose color would be hard to read on its background switches to black or white.

What is not carried over: row heights, vertical alignment (PDF table cells have none), and named fonts other than sans, serif and mono.
