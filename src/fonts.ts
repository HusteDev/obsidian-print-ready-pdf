// pdfmake's browser build can only read font files from its virtual file
// system. The PDF standard fonts (Helvetica, Courier) are not embedded, but
// pdfkit still needs their AFM metric files, which it reads from
// `data/<Name>.afm`. Bundle them as text (esbuild `.afm` text loader) and hand
// them to createPdf() as the vfs, or every export fails with
// "File 'data/Helvetica.afm' not found in virtual file system".
import helvetica from '@foliojs-fork/pdfkit/js/data/Helvetica.afm';
import helveticaBold from '@foliojs-fork/pdfkit/js/data/Helvetica-Bold.afm';
import helveticaOblique from '@foliojs-fork/pdfkit/js/data/Helvetica-Oblique.afm';
import helveticaBoldOblique from '@foliojs-fork/pdfkit/js/data/Helvetica-BoldOblique.afm';
import courier from '@foliojs-fork/pdfkit/js/data/Courier.afm';
import courierBold from '@foliojs-fork/pdfkit/js/data/Courier-Bold.afm';
import courierOblique from '@foliojs-fork/pdfkit/js/data/Courier-Oblique.afm';
import courierBoldOblique from '@foliojs-fork/pdfkit/js/data/Courier-BoldOblique.afm';
import timesRoman from '@foliojs-fork/pdfkit/js/data/Times-Roman.afm';
import timesBold from '@foliojs-fork/pdfkit/js/data/Times-Bold.afm';
import timesItalic from '@foliojs-fork/pdfkit/js/data/Times-Italic.afm';
import timesBoldItalic from '@foliojs-fork/pdfkit/js/data/Times-BoldItalic.afm';

export const FONTS = {
    Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
    },
    Times: {
        normal: 'Times-Roman',
        bold: 'Times-Bold',
        italics: 'Times-Italic',
        bolditalics: 'Times-BoldItalic',
    },
    Courier: {
        normal: 'Courier',
        bold: 'Courier-Bold',
        italics: 'Courier-Oblique',
        bolditalics: 'Courier-BoldOblique',
    },
};

export const FONT_VFS: Record<string, string> = {
    'data/Helvetica.afm': helvetica,
    'data/Helvetica-Bold.afm': helveticaBold,
    'data/Helvetica-Oblique.afm': helveticaOblique,
    'data/Helvetica-BoldOblique.afm': helveticaBoldOblique,
    'data/Courier.afm': courier,
    'data/Courier-Bold.afm': courierBold,
    'data/Courier-Oblique.afm': courierOblique,
    'data/Courier-BoldOblique.afm': courierBoldOblique,
    'data/Times-Roman.afm': timesRoman,
    'data/Times-Bold.afm': timesBold,
    'data/Times-Italic.afm': timesItalic,
    'data/Times-BoldItalic.afm': timesBoldItalic,
};
