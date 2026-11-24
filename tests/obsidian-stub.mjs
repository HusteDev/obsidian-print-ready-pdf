// Minimal stand-ins for the parts of the obsidian module that the exporter imports,
// so the document building code can run under Node.
export class App {}
export class Component {}
export class Notice {}
export class TFile {}
export const MarkdownRenderer = {};
export const Platform = { isDesktopApp: true, isMobile: false };
export const normalizePath = (p) => p;
export const getAllTags = () => null;
export const requestUrl = () => Promise.reject(new Error('no network in tests'));
