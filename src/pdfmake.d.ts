/** pdfmake's browser build ships no types; this covers the part the plugin uses. */
declare module 'pdfmake/build/pdfmake' {
    const pdfMake: {
        createPdf(
            docDefinition: object,
            tableLayouts: null,
            fonts: Record<string, unknown>,
            vfs: Record<string, string | ArrayBuffer>,
        ): { getBuffer(callback: (buffer: Uint8Array) => void): void };
    };
    export default pdfMake;
}
