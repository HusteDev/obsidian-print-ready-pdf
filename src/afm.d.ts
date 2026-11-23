declare module '*.afm' {
    const content: string;
    export default content;
}

declare module '*.ttf' {
    const content: Uint8Array;
    export default content;
}
