export interface PanelReady { sessionId?: string; kind: 'server' | 'report'; url: string; }

/** Parses CLI control lines, never prefixed child-process output. */
export function parsePanelReady(line: string): PanelReady | undefined {
    if (line.length > 16384) return undefined;
    let event: PanelReady;
    try {
        if (line.startsWith('JUNEXIS_READY ')) {
            const value = JSON.parse(line.slice(14));
            if (!value || value.schema !== 'junexis.panel-ready/1'
                || typeof value.sessionId !== 'string'
                || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId)
                || !['server', 'report'].includes(value.kind) || typeof value.url !== 'string') return undefined;
            event = { sessionId: value.sessionId, kind: value.kind, url: value.url };
        } else if (line.startsWith('READY report · ')) {
            event = { kind: 'report', url: line.slice('READY report · '.length).trim() };
        } else return undefined;
        const url = new URL(event.url);
        if (!['http:', 'https:'].includes(url.protocol)
            || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
            || url.username || url.password) return undefined;
        return event;
    } catch { return undefined; }
}

/** Bounds partial lines and discards oversized records instead of parsing a suffix. */
export class CliLines {
    private pending = '';
    private oversized = false;
    constructor(private readonly receive: (line: string) => void) {}
    push(chunk: string): void {
        for (const part of chunk.split(/(?<=\n)/)) {
            if (!this.oversized) {
                this.pending += part;
                if (this.pending.length > 16384) { this.pending = ''; this.oversized = true; }
            }
            if (part.endsWith('\n')) {
                if (!this.oversized) this.receive(this.pending.replace(/\r?\n$/, ''));
                this.pending = ''; this.oversized = false;
            }
        }
    }
}
