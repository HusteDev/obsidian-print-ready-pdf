import { Notice } from 'obsidian';

/** Lets the browser paint and handle input; the heavy steps below block the main thread. */
export function yieldToUI(): Promise<void> {
    // requestAnimationFrame guarantees a paint opportunity; the timeout covers hidden windows where it never fires.
    return new Promise(resolve => {
        const done = () => { window.clearTimeout(t); window.setTimeout(resolve, 0); };
        const t = window.setTimeout(resolve, 100);
        window.requestAnimationFrame(done);
    });
}

/** One persistent notice whose text tracks the export stage. */
export class ExportProgress {
    private notice: Notice | null = new Notice('Generating PDF…', 0);

    /** Update the message, then yield so it is actually painted before the next blocking step. */
    async set(message: string): Promise<void> {
        this.notice?.setMessage(message);
        await yieldToUI();
    }

    hide(): void {
        this.notice?.hide();
        this.notice = null;
    }
}
