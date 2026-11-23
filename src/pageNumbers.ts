import type { PageNumberFormat } from './types';

export const PAGE_NUMBER_FORMATS: Record<PageNumberFormat, string> = {
    'n': '1',
    'n-of-total': '1 of 10',
    'n-slash-total': '1 / 10',
    'page-n': 'Page 1',
    'page-n-of-total': 'Page 1 of 10',
    'dash-n-dash': '– 1 –',
};

export function formatPageNumber(format: PageNumberFormat, page: number, total: number): string {
    switch (format) {
        case 'n': return `${page}`;
        case 'n-of-total': return `${page} of ${total}`;
        case 'page-n': return `Page ${page}`;
        case 'page-n-of-total': return `Page ${page} of ${total}`;
        case 'dash-n-dash': return `– ${page} –`;
        case 'n-slash-total':
        default: return `${page} / ${total}`;
    }
}
