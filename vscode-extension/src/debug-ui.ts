import * as http from 'http';
import * as child_process from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    diagnosticStoryMarkdown,
    parseDiagnosticStory,
    type DiagnosticStory,
} from './diagnostic-story';
import type { MentorService } from './mentor';
import { getLatestBuild } from './tooling-state';
import {
    resolveBundledTraceCollector,
    resolveConfiguredTraceCollector,
} from './trace-collector-distribution';

let mentorService: MentorService | undefined;
let ownedTraceCollectorProcess: child_process.ChildProcess | undefined;

interface TraceCollectorTask {
    taskId: number;
    eventCount: number;
    lastLamport: number;
}

interface TraceCollectorLaunch {
    command: string;
    prefixArgs: string[];
    cwd: string;
    label: string;
}

interface TraceCollectorEvent {
    eventId: number;
    taskId: number;
    kind: string;
    lamportClock: number;
    attributes?: Record<string, string>;
    timestamp?: string;
    file?: string;
    line?: number;
    function?: string;
}

interface ManifestSourceLocation {
    file: string;
    line: number;
    column: number;
}

interface ManifestTaskResolution {
    taskId: number;
    displayName: string;
    resolved: boolean;
    targets?: string[];
    output?: string;
    source?: ManifestSourceLocation;
}

interface DebugSessionInfo {
    sessionId: string;
    status: string;
    label?: string;
}

interface DebugTaskState {
    taskId: number;
    taskName: string;
    status: string;
    lamportClock: number;
    values?: Record<string, string>;
}

interface DebugChannelState {
    channel: string;
    status: string;
    lamportClock: number;
    backlog?: number;
    lastPayloadHash?: string;
    values?: Record<string, string>;
}

interface DebugSystemState {
    session: DebugSessionInfo;
    tasks: DebugTaskState[];
    channels: DebugChannelState[];
    capturedAt: string;
}

interface DebugBreakpoint {
    id: string;
    kind: string;
    visualKind: string;
    source?: {
        file: string;
        line: number;
        column: number;
    };
    enabled: boolean;
    label?: string;
    condition?: string;
}

interface DebugBreakpointHit {
    hitId: number;
    breakpointId: string;
    kind: string;
    visualKind: string;
    source?: {
        file: string;
        line: number;
        column: number;
    };
    eventId: number;
    taskId: number;
    eventKind: string;
    lamportClock: number;
    snapshotId: number;
    hitAt: string;
    attributes?: Record<string, string>;
}

interface DebugBreakpointSyncPayload {
    breakpoints: Array<{
        kind: 'Source';
        visualKind: 'source-task';
        source: {
            file: string;
            line: number;
            column: number;
        };
        enabled: boolean;
        label?: string;
        condition?: string;
    }>;
}

class TraceCollectorClient {
    constructor(private readonly baseUrl: string) {
    }

    async health(): Promise<boolean> {
        try {
            await this.getJson('/health');
            return true;
        } catch {
            return false;
        }
    }

    async tasks(): Promise<TraceCollectorTask[]> {
        return this.getJson<TraceCollectorTask[]>('/tasks');
    }

    async events(limit = 100): Promise<TraceCollectorEvent[]> {
        return this.getJson<TraceCollectorEvent[]>(`/events?limit=${encodeURIComponent(limit)}`);
    }

    async resolveTask(taskId: number): Promise<ManifestTaskResolution | undefined> {
        try {
            return await this.getJson<ManifestTaskResolution>(`/manifest/tasks/${encodeURIComponent(taskId)}`);
        } catch {
            return undefined;
        }
    }

    async story(eventId: number, context = 3): Promise<DiagnosticStory> {
        const result = await this.getJson<unknown>(
            `/events/${encodeURIComponent(eventId)}/story?context=${encodeURIComponent(context)}`);
        return parseDiagnosticStory(result);
    }

    async state(): Promise<DebugSystemState> {
        return this.getJson<DebugSystemState>('/debug/state');
    }

    async session(): Promise<DebugSessionInfo> {
        return this.getJson<DebugSessionInfo>('/debug/session');
    }

    async resumeSession(): Promise<DebugSessionInfo> {
        return this.requestJson<DebugSessionInfo>('POST', '/debug/session/resume', {});
    }

    async startSession(label: string): Promise<DebugSessionInfo> {
        return this.requestJson<DebugSessionInfo>('POST', '/debug/session/start', { label });
    }

    async syncSourceBreakpoints(payload: DebugBreakpointSyncPayload): Promise<DebugBreakpoint[]> {
        return this.requestJson<DebugBreakpoint[]>('PUT', '/debug/breakpoints/source', payload);
    }

    async breakpoints(): Promise<DebugBreakpoint[]> {
        return this.getJson<DebugBreakpoint[]>('/debug/breakpoints');
    }

    async breakpointHits(limit = 50): Promise<DebugBreakpointHit[]> {
        return this.getJson<DebugBreakpointHit[]>(`/debug/breakpoints/hits?limit=${encodeURIComponent(limit)}`);
    }

    private getJson<T>(urlPath: string): Promise<T> {
        const url = new URL(urlPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);

        return new Promise<T>((resolve, reject) => {
            const req = http.get(url, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; });
                response.on('end', () => {
                    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`TraceCollector ${response.statusCode ?? 'unknown'} for ${url.pathname}: ${body}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy(new Error(`TraceCollector request timed out: ${url.toString()}`));
            });
        });
    }

    private requestJson<T>(method: string, urlPath: string, body: unknown): Promise<T> {
        const url = new URL(urlPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
        const payload = JSON.stringify(body);

        return new Promise<T>((resolve, reject) => {
            const req = http.request(url, {
                method,
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload)
                }
            }, response => {
                let responseBody = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { responseBody += chunk; });
                response.on('end', () => {
                    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`TraceCollector ${response.statusCode ?? 'unknown'} for ${url.pathname}: ${responseBody}`));
                        return;
                    }

                    if (!responseBody.trim()) {
                        resolve(undefined as T);
                        return;
                    }

                    try {
                        resolve(JSON.parse(responseBody) as T);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy(new Error(`TraceCollector request timed out: ${url.toString()}`));
            });
            req.write(payload);
            req.end();
        });
    }
}

class DebugTaskItem extends vscode.TreeItem {
    constructor(
        readonly task: TraceCollectorTask,
        readonly resolution: ManifestTaskResolution | undefined,
    ) {
        const label = resolution?.resolved ? resolution.displayName : `Task ${task.taskId}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        const targets = resolution?.targets?.length ? resolution.targets.join(', ') : 'target unknown';
        this.description = `${targets} · ${task.eventCount} event(s) · L=${task.lastLamport}`;
        this.tooltip = new vscode.MarkdownString(undefined, true);
        this.tooltip.appendMarkdown(`**${label}**\n\n`);
        this.tooltip.appendMarkdown(`Task ID: \`${task.taskId}\`\n\n`);
        this.tooltip.appendMarkdown(`Targets: \`${targets}\`\n\n`);
        this.tooltip.appendMarkdown(`Events: \`${task.eventCount}\`\n\n`);
        this.tooltip.appendMarkdown(`Last Lamport: \`${task.lastLamport}\`\n\n`);
        if (resolution?.output) {
            this.tooltip.appendMarkdown(`Output: \`${resolution.output}\`\n\n`);
        }
        if (resolution?.source) {
            this.tooltip.appendMarkdown(`Source: \`${resolution.source.file}:${resolution.source.line}:${resolution.source.column}\``);
            this.command = {
                command: 'junexis.debug.openTaskSource',
                title: 'Open Junexis task source',
                arguments: [resolution]
            };
        }
        this.iconPath = new vscode.ThemeIcon('zap');
        this.contextValue = 'junexisDebugTask';
    }
}

class DebugEventItem extends vscode.TreeItem {
    constructor(
        readonly event: TraceCollectorEvent,
        readonly taskName: string,
    ) {
        super(`#${event.eventId} ${taskName}`, vscode.TreeItemCollapsibleState.None);
        const payloadHash = event.attributes?.payloadHash;
        this.description = `${event.kind} · L=${event.lamportClock}${payloadHash ? ` · ${payloadHash}` : ''}`;
        this.tooltip = new vscode.MarkdownString(undefined, true);
        this.tooltip.appendMarkdown(`**Event #${event.eventId}**\n\n`);
        this.tooltip.appendMarkdown(`Task: \`${taskName}\` (\`${event.taskId}\`)\n\n`);
        this.tooltip.appendMarkdown(`Kind: \`${event.kind}\`\n\n`);
        this.tooltip.appendMarkdown(`Lamport: \`${event.lamportClock}\`\n\n`);
        if (event.file && event.line) {
            this.tooltip.appendMarkdown(`Source: \`${event.file}:${event.line}\`\n\n`);
        }
        if (event.function) {
            this.tooltip.appendMarkdown(`Function: \`${event.function}\`\n\n`);
        }
        if (event.attributes && Object.keys(event.attributes).length > 0) {
            this.tooltip.appendMarkdown('Attributes:\n\n');
            for (const [key, value] of Object.entries(event.attributes)) {
                this.tooltip.appendMarkdown(`- \`${key}\`: \`${value}\`\n`);
            }
        }
        this.iconPath = new vscode.ThemeIcon(event.kind.includes('SEND') ? 'arrow-up' : event.kind.includes('RECV') ? 'arrow-down' : 'circle-outline');
        this.command = {
            command: 'junexis.debug.explainEvent',
            title: 'Explain Junexis debug event',
            arguments: [event.eventId]
        };
        this.contextValue = 'junexisDebugEvent';
    }
}

class DebugTasksProvider implements vscode.TreeDataProvider<DebugTaskItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebugTaskItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: DebugTaskItem[] = [];

    async refresh(client: TraceCollectorClient): Promise<void> {
        const tasks = await client.tasks();
        const items: DebugTaskItem[] = [];
        for (const task of tasks) {
            items.push(new DebugTaskItem(task, await client.resolveTask(task.taskId)));
        }
        this.items = items;
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.items = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DebugTaskItem): vscode.TreeItem {
        return element;
    }

    getChildren(): DebugTaskItem[] {
        return this.items;
    }
}

class DebugTraceProvider implements vscode.TreeDataProvider<DebugEventItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebugEventItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: DebugEventItem[] = [];
    private lastEventId: number | undefined;

    async refresh(client: TraceCollectorClient): Promise<void> {
        const events = await client.events(100);
        const taskNameCache = new Map<number, string>();
        const items: DebugEventItem[] = [];

        for (const event of events) {
            let taskName = taskNameCache.get(event.taskId);
            if (!taskName) {
                const resolution = await client.resolveTask(event.taskId);
                taskName = resolution?.resolved ? resolution.displayName : `Task ${event.taskId}`;
                taskNameCache.set(event.taskId, taskName);
            }
            items.push(new DebugEventItem(event, taskName));
        }

        this.items = items;
        this.lastEventId = events.length > 0 ? events[events.length - 1].eventId : undefined;
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.items = [];
        this.lastEventId = undefined;
        this._onDidChangeTreeData.fire();
    }

    getLastEventId(): number | undefined {
        return this.lastEventId;
    }

    getTreeItem(element: DebugEventItem): vscode.TreeItem {
        return element;
    }

    getChildren(): DebugEventItem[] {
        return this.items;
    }
}

class DebugStateItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string | undefined,
        icon: vscode.ThemeIcon,
        readonly children: DebugStateItem[] = [],
    ) {
        super(label, children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = icon;
    }
}

class DebugStateProvider implements vscode.TreeDataProvider<DebugStateItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebugStateItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private roots: DebugStateItem[] = [];

    async refresh(client: TraceCollectorClient): Promise<void> {
        const state = await client.state();
        const taskItems = state.tasks.map(task => new DebugStateItem(
            task.taskName,
            `${task.status} · L=${task.lamportClock}`,
            new vscode.ThemeIcon('zap'),
            Object.entries(task.values ?? {}).map(([key, value]) =>
                new DebugStateItem(key, value, new vscode.ThemeIcon('symbol-field')))
        ));

        const channelItems = state.channels.map(channel => new DebugStateItem(
            channel.channel,
            `${channel.status}${channel.backlog !== undefined ? ` · backlog=${channel.backlog}` : ''} · L=${channel.lamportClock}`,
            new vscode.ThemeIcon('arrow-swap'),
            [
                ...(channel.lastPayloadHash ? [new DebugStateItem('lastPayloadHash', channel.lastPayloadHash, new vscode.ThemeIcon('symbol-key'))] : []),
                ...Object.entries(channel.values ?? {}).map(([key, value]) =>
                    new DebugStateItem(key, value, new vscode.ThemeIcon('symbol-field')))
            ]
        ));

        this.roots = [
            new DebugStateItem('Session', `${state.session.status}${state.session.label ? ` · ${state.session.label}` : ''}`, new vscode.ThemeIcon('debug-alt')),
            new DebugStateItem('Tasks', `${taskItems.length}`, new vscode.ThemeIcon('list-tree'), taskItems),
            new DebugStateItem('Channels', `${channelItems.length}`, new vscode.ThemeIcon('symbol-event'), channelItems),
        ];
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.roots = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DebugStateItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DebugStateItem): DebugStateItem[] {
        return element ? element.children : this.roots;
    }
}

class DebugSessionItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string | undefined,
        icon: vscode.ThemeIcon,
        readonly children: DebugSessionItem[] = [],
        command?: vscode.Command,
    ) {
        super(label, children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = icon;
        this.command = command;
    }
}

class DebugSessionProvider implements vscode.TreeDataProvider<DebugSessionItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebugSessionItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private roots: DebugSessionItem[] = [
        new DebugSessionItem('TraceCollector disconnected', debugConfigUrl(), new vscode.ThemeIcon('debug-disconnect'))
    ];

    async refresh(client: TraceCollectorClient): Promise<void> {
        const [session, hits, events, state] = await Promise.all([
            client.session().catch(() => undefined),
            client.breakpointHits(20).catch(() => [] as DebugBreakpointHit[]),
            client.events(20).catch(() => [] as TraceCollectorEvent[]),
            client.state().catch(() => undefined)
        ]);

        const latestHit = hits.length > 0 ? hits[hits.length - 1] : undefined;
        const latestEvent = events.length > 0 ? events[events.length - 1] : undefined;
        const status = session?.status ?? state?.session?.status ?? 'created';
        const statusLower = status.toLowerCase();
        const statusIcon = statusLower === 'paused'
            ? new vscode.ThemeIcon('debug-pause')
            : statusLower === 'running'
                ? new vscode.ThemeIcon('debug-alt')
                : statusLower === 'stopped'
                    ? new vscode.ThemeIcon('debug-stop')
                    : new vscode.ThemeIcon('debug-alt-small');

        const sessionChildren: DebugSessionItem[] = [
            new DebugSessionItem('TraceCollector', debugConfigUrl(), new vscode.ThemeIcon('radio-tower')),
            new DebugSessionItem('Session ID', session?.sessionId ?? 'n/a', new vscode.ThemeIcon('symbol-key')),
            new DebugSessionItem('Label', session?.label ?? 'n/a', new vscode.ThemeIcon('tag')),
            new DebugSessionItem('Tasks', `${state?.tasks.length ?? 0}`, new vscode.ThemeIcon('list-tree'), [], {
                command: 'junexis.debug.showTasks',
                title: 'Show Junexis debug tasks'
            }),
            new DebugSessionItem('Channels', `${state?.channels.length ?? 0}`, new vscode.ThemeIcon('arrow-swap'), [], {
                command: 'junexis.debug.showState',
                title: 'Show Junexis debug state'
            }),
        ];

        const hitChildren = latestHit
            ? [
                new DebugSessionItem('Source', latestHit.source ? `${latestHit.source.file}:${latestHit.source.line}:${latestHit.source.column}` : 'unknown', new vscode.ThemeIcon('file-code')),
                new DebugSessionItem('Event', `#${latestHit.eventId} ${latestHit.eventKind}`, new vscode.ThemeIcon('symbol-event')),
                new DebugSessionItem('Snapshot', `#${latestHit.snapshotId}`, new vscode.ThemeIcon('database')),
                new DebugSessionItem('Lamport', `${latestHit.lamportClock}`, new vscode.ThemeIcon('watch')),
            ]
            : [new DebugSessionItem('No breakpoint hit yet', 'run demo or trigger runtime input', new vscode.ThemeIcon('circle-slash'))];

        const eventChildren = latestEvent
            ? [
                new DebugSessionItem('Task', `${latestEvent.taskId}`, new vscode.ThemeIcon('zap')),
                new DebugSessionItem('Kind', latestEvent.kind, new vscode.ThemeIcon('symbol-event')),
                new DebugSessionItem('Lamport', `${latestEvent.lamportClock}`, new vscode.ThemeIcon('watch')),
                ...(latestEvent.file && latestEvent.line
                    ? [new DebugSessionItem('Source', `${latestEvent.file}:${latestEvent.line}`, new vscode.ThemeIcon('file-code'))]
                    : [])
            ]
            : [new DebugSessionItem('No trace event yet', 'waiting for runtime activity', new vscode.ThemeIcon('circle-slash'))];

        this.roots = [
            new DebugSessionItem('Status', status, statusIcon, sessionChildren),
            new DebugSessionItem(
                'Latest breakpoint hit',
                latestHit ? `#${latestHit.hitId} · event #${latestHit.eventId}` : 'none',
                latestHit ? breakpointIcon(latestHit.visualKind) : new vscode.ThemeIcon('debug-breakpoint-unverified'),
                hitChildren,
                latestHit
                    ? {
                        command: 'junexis.debug.showLatestBreakpointHit',
                        title: 'Show latest Junexis breakpoint hit'
                    }
                    : undefined
            ),
            new DebugSessionItem(
                'Latest trace event',
                latestEvent ? `#${latestEvent.eventId} · ${latestEvent.kind}` : 'none',
                new vscode.ThemeIcon('timeline-view-icon'),
                eventChildren,
                latestEvent
                    ? {
                        command: 'junexis.debug.explainEvent',
                        title: 'Explain latest Junexis debug event'
                    }
                    : undefined
            ),
            new DebugSessionItem('Actions', undefined, new vscode.ThemeIcon('tools'), [
                new DebugSessionItem('Refresh', 'read TraceCollector state', new vscode.ThemeIcon('refresh'), [], {
                    command: 'junexis.debug.refresh',
                    title: 'Refresh Junexis debug session'
                }),
                new DebugSessionItem('Continue', 'resume paused debug session/runtime gate', new vscode.ThemeIcon('debug-continue'), [], {
                    command: 'junexis.debug.continueSession',
                    title: 'Continue Junexis debug session'
                }),
                new DebugSessionItem('Open latest snapshot', 'show runtime state at latest hit', new vscode.ThemeIcon('open-preview'), [], {
                    command: 'junexis.debug.showLatestDebugSnapshot',
                    title: 'Show latest Junexis debug snapshot'
                }),
                new DebugSessionItem('Stop local session', 'stop local TraceCollector listener', new vscode.ThemeIcon('debug-stop'), [], {
                    command: 'junexis.debug.stopSession',
                    title: 'Stop Junexis debug session'
                }),
            ]),
        ];
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.roots = [
            new DebugSessionItem('TraceCollector disconnected', debugConfigUrl(), new vscode.ThemeIcon('debug-disconnect'))
        ];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DebugSessionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DebugSessionItem): DebugSessionItem[] {
        return element ? element.children : this.roots;
    }
}

class DebugBreakpointItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string | undefined,
        icon: vscode.ThemeIcon,
        readonly children: DebugBreakpointItem[] = [],
        command?: vscode.Command,
    ) {
        super(label, children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = icon;
        this.command = command;
    }
}

class DebugBreakpointsProvider implements vscode.TreeDataProvider<DebugBreakpointItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebugBreakpointItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private roots: DebugBreakpointItem[] = [];

    async refresh(client: TraceCollectorClient): Promise<void> {
        const [breakpoints, hits] = await Promise.all([
            client.breakpoints(),
            client.breakpointHits(50)
        ]);

        const breakpointItems = breakpoints.map(bp => new DebugBreakpointItem(
            bp.label || bp.source ? breakpointLabel(bp) : bp.id,
            `${bp.kind} · ${bp.enabled ? 'enabled' : 'disabled'}`,
            breakpointIcon(bp.visualKind),
            [
                ...(bp.source ? [new DebugBreakpointItem('source', `${bp.source.file}:${bp.source.line}:${bp.source.column}`, new vscode.ThemeIcon('file-code'))] : []),
                ...(bp.condition ? [new DebugBreakpointItem('condition', bp.condition, new vscode.ThemeIcon('symbol-operator'))] : []),
                new DebugBreakpointItem('id', bp.id, new vscode.ThemeIcon('symbol-key')),
            ]
        ));

        const hitItems = hits.map(hit => new DebugBreakpointItem(
            `#${hit.hitId} ${hit.kind}`,
            `${hit.eventKind} · event #${hit.eventId} · snapshot #${hit.snapshotId}${hit.source ? ` · ${path.basename(hit.source.file)}:${hit.source.line}` : ''}`,
            breakpointIcon(hit.visualKind),
            [
                ...(hit.source ? [new DebugBreakpointItem('source', `${hit.source.file}:${hit.source.line}:${hit.source.column}`, new vscode.ThemeIcon('file-code'))] : []),
                new DebugBreakpointItem('breakpoint', hit.breakpointId, new vscode.ThemeIcon('debug-breakpoint')),
                new DebugBreakpointItem('task', `${hit.taskId}`, new vscode.ThemeIcon('zap')),
                new DebugBreakpointItem('lamport', `${hit.lamportClock}`, new vscode.ThemeIcon('watch')),
                ...Object.entries(hit.attributes ?? {}).map(([key, value]) =>
                    new DebugBreakpointItem(key, value, new vscode.ThemeIcon('symbol-field'))),
            ],
            {
                command: 'junexis.debug.openBreakpointHitSource',
                title: 'Open Junexis breakpoint hit source',
                arguments: [hit]
            }
        ));

        this.roots = [
            new DebugBreakpointItem('Breakpoints', `${breakpointItems.length}`, new vscode.ThemeIcon('debug-breakpoint'), breakpointItems),
            new DebugBreakpointItem('Hits', `${hitItems.length}`, new vscode.ThemeIcon('debug-breakpoint-log'), hitItems),
        ];
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.roots = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DebugBreakpointItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DebugBreakpointItem): DebugBreakpointItem[] {
        return element ? element.children : this.roots;
    }
}

function debugConfigUrl(): string {
    return vscode.workspace.getConfiguration('junexis').get<string>('debug.traceCollectorUrl', 'http://127.0.0.1:8080').trim() || 'http://127.0.0.1:8080';
}

function debugNarrativeRoot(): string {
    return vscode.workspace.getConfiguration('junexis').get<string>('debug.narrativeRoot', '').trim();
}

function createClient(): TraceCollectorClient {
    return new TraceCollectorClient(debugConfigUrl());
}

let lastSeenBreakpointHitId = 0;
let breakpointHitWatcher: NodeJS.Timeout | undefined;

function updateDebugStatusBar(
    statusBar: vscode.StatusBarItem,
    status: 'disconnected' | string,
    latestHit?: DebugBreakpointHit,
): void {
    statusBar.color = undefined;
    statusBar.backgroundColor = undefined;

    switch (status.toLowerCase()) {
        case 'running':
            statusBar.text = '$(debug-alt) Junexis Debug · running';
            statusBar.tooltip = `TraceCollector connected at ${debugConfigUrl()}. Debug session is running.`;
            return;
        case 'paused':
            statusBar.text = latestHit
                ? `$(debug-pause) Junexis Debug · paused on #${latestHit.hitId}`
                : '$(debug-pause) Junexis Debug · paused';
            statusBar.tooltip = latestHit
                ? `Paused on breakpoint hit #${latestHit.hitId}, event #${latestHit.eventId}, snapshot #${latestHit.snapshotId}. Click to refresh.`
                : 'Debug session is paused. Click to refresh.';
            statusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
            statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            return;
        case 'stopped':
            statusBar.text = '$(debug-stop) Junexis Debug · stopped';
            statusBar.tooltip = `TraceCollector connected at ${debugConfigUrl()}, but debug session is stopped.`;
            return;
        case 'created':
            statusBar.text = '$(debug-alt-small) Junexis Debug · created';
            statusBar.tooltip = `TraceCollector connected at ${debugConfigUrl()}, debug session has not started yet.`;
            return;
        case 'disconnected':
        default:
            statusBar.text = '$(debug-disconnect) Junexis Debug · disconnected';
            statusBar.tooltip = `TraceCollector is not reachable at ${debugConfigUrl()}`;
            return;
    }
}

function breakpointLabel(bp: DebugBreakpoint): string {
    if (bp.label) {
        return bp.label;
    }

    if (bp.source) {
        return `${path.basename(bp.source.file)}:${bp.source.line}`;
    }

    return bp.id;
}

function breakpointIcon(visualKind: string): vscode.ThemeIcon {
    switch (visualKind) {
        case 'communication':
            return new vscode.ThemeIcon('arrow-swap');
        case 'channel':
            return new vscode.ThemeIcon('symbol-event');
        case 'state':
            return new vscode.ThemeIcon('symbol-field');
        case 'narrative':
            return new vscode.ThemeIcon('book');
        case 'causality':
            return new vscode.ThemeIcon('type-hierarchy');
        case 'source-task':
        default:
            return new vscode.ThemeIcon('debug-breakpoint');
    }
}

function isJunexisBreakpoint(breakpoint: vscode.Breakpoint): breakpoint is vscode.SourceBreakpoint {
    if (!(breakpoint instanceof vscode.SourceBreakpoint)) {
        return false;
    }

    return path.extname(breakpoint.location.uri.fsPath).toLowerCase() === '.jnx';
}

function collectJunexisSourceBreakpoints(): DebugBreakpointSyncPayload {
    const breakpoints = vscode.debug.breakpoints
        .filter(isJunexisBreakpoint)
        .map(breakpoint => {
            const line = breakpoint.location.range.start.line + 1;
            const column = breakpoint.location.range.start.character + 1;
            const file = breakpoint.location.uri.fsPath;

            return {
                kind: 'Source' as const,
                visualKind: 'source-task' as const,
                source: { file, line, column },
                enabled: breakpoint.enabled,
                label: `${path.basename(file)}:${line}`,
                condition: breakpoint.condition || undefined
            };
        });

    return { breakpoints };
}

async function syncDebugBreakpoints(client: TraceCollectorClient, silent = false): Promise<number> {
    if (!await client.health()) {
        if (!silent) {
            await vscode.window.showWarningMessage(`Junexis: TraceCollector is not reachable at ${debugConfigUrl()}; breakpoints were not synced.`);
        }
        return 0;
    }

    const payload = collectJunexisSourceBreakpoints();
    const synced = await client.syncSourceBreakpoints(payload);
    const sourceCount = synced.filter(bp => bp.kind === 'Source').length;

    if (!silent) {
        await vscode.window.showInformationMessage(`Junexis: synced ${sourceCount} source breakpoint(s) to TraceCollector.`);
    }

    return sourceCount;
}

interface LocalTraceCollectorEndpoint {
    host: '127.0.0.1' | 'localhost';
    port: number;
}

function parseLocalTraceCollectorEndpoint(): LocalTraceCollectorEndpoint | undefined {
    try {
        const url = new URL(debugConfigUrl());
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
            return undefined;
        }

        const port = Number(url.port || '80');
        return Number.isInteger(port) && port > 0 && port <= 65535
            ? { host: url.hostname, port }
            : undefined;
    } catch {
        return undefined;
    }
}

function parseTraceCollectorPort(): number | undefined {
    return parseLocalTraceCollectorEndpoint()?.port;
}

async function findNarrativeRoot(context: vscode.ExtensionContext): Promise<string | undefined> {
    const configured = debugNarrativeRoot();
    if (configured) {
        return configured;
    }

    const candidates = [
        ...((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath)),
        path.resolve(context.extensionPath, '..', '..', 'junexis-narrative')
    ];

    for (const candidate of candidates) {
        const script = path.join(candidate, 'scripts', 'run-cnc-debug-demo.ps1');
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(script));
            return candidate;
        } catch {
            // keep searching
        }
    }

    return undefined;
}

async function findTraceCollectorServerProject(context: vscode.ExtensionContext): Promise<string | undefined> {
    const narrativeRoot = await findNarrativeRoot(context);
    if (!narrativeRoot) {
        return undefined;
    }
    const project = path.join(
        narrativeRoot,
        'Junexis.Debugger.TraceCollector.Server',
        'Junexis.Debugger.TraceCollector.Server.csproj');
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(project));
        return project;
    } catch {
        return undefined;
    }
}

async function resolveTraceCollectorLaunch(
    context: vscode.ExtensionContext,
): Promise<TraceCollectorLaunch | undefined> {
    const configuredPath = vscode.workspace
        .getConfiguration('junexis')
        .get<string>('debug.traceCollectorPath', '')
        .trim();
    const distribution = resolveConfiguredTraceCollector(configuredPath)
        ?? resolveBundledTraceCollector(context.extensionPath);
    if (distribution) {
        return {
            command: distribution.command,
            prefixArgs: [],
            cwd: distribution.cwd,
            label: `TraceCollector ${distribution.identity.version} (${distribution.identity.runtimeIdentifier})`,
        };
    }

    const project = await findTraceCollectorServerProject(context);
    return project
        ? {
            command: 'dotnet',
            prefixArgs: ['run', '--project', project, '--'],
            cwd: path.dirname(project),
            label: 'TraceCollector workspace project',
        }
        : undefined;
}

function execPowerShell(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise(resolve => {
        const proc = child_process.spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
            cwd,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
        proc.on('error', error => resolve({ stdout, stderr: String(error), code: -1 }));
        proc.on('close', code => resolve({ stdout, stderr, code }));
    });
}

async function waitForTraceCollector(client: TraceCollectorClient, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await client.health()) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    return false;
}

async function stopLocalTraceCollector(
    sessionProvider: DebugSessionProvider,
    tasksProvider: DebugTasksProvider,
    traceProvider: DebugTraceProvider,
    stateProvider: DebugStateProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): Promise<void> {
    const port = parseTraceCollectorPort();
    if (!port) {
        await vscode.window.showWarningMessage('Junexis: Stop Debug Session działa tylko dla lokalnego TraceCollector URL z portem, np. http://127.0.0.1:8080.');
        return;
    }

    const choice = await vscode.window.showWarningMessage(
        `Junexis: zatrzymać lokalny proces nasłuchujący na porcie ${port}?`,
        { modal: true },
        'Stop Debug Session'
    );

    if (choice !== 'Stop Debug Session') {
        return;
    }

    let message = 'debug session stopped';
    if (ownedTraceCollectorProcess && ownedTraceCollectorProcess.exitCode === null) {
        ownedTraceCollectorProcess.kill();
        ownedTraceCollectorProcess = undefined;
        message = 'stopped TraceCollector owned by this extension host';
    } else {
        const command = [
            `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
            'if (-not $conn) { Write-Output "No listener"; exit 0 }',
            '$ownerProcessId = $conn.OwningProcess',
            'Stop-Process -Id $ownerProcessId -Force',
            'Write-Output "Stopped process $ownerProcessId"'
        ].join('; ');

        const result = await execPowerShell(command);
        if (result.code !== 0) {
            await vscode.window.showErrorMessage(`Junexis: nie udało się zatrzymać TraceCollector. ${result.stderr || result.stdout}`);
            return;
        }
        message = result.stdout.trim() || message;
    }

    sessionProvider.clear();
    tasksProvider.clear();
    traceProvider.clear();
    stateProvider.clear();
    breakpointsProvider.clear();
    updateDebugStatusBar(statusBar, 'disconnected');
    await vscode.window.showInformationMessage(`Junexis: ${message}`);
}

async function startCurrentBuildDebug(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    sessionProvider: DebugSessionProvider,
    tasksProvider: DebugTasksProvider,
    traceProvider: DebugTraceProvider,
    stateProvider: DebugStateProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): Promise<void> {
    const build = getLatestBuild();
    if (!build?.success || !build.buildId || !build.debugManifest || !build.latestBuildReceipt) {
        await vscode.window.showWarningMessage(
            'Junexis: build the active project first; no verified latest-build debug manifest is available.');
        return;
    }
    const endpoint = parseLocalTraceCollectorEndpoint();
    if (!endpoint) {
        await vscode.window.showWarningMessage(
            'Junexis: starting a local debugger requires a localhost TraceCollector URL with a port.');
        return;
    }
    const { host, port } = endpoint;
    if (ownedTraceCollectorProcess && ownedTraceCollectorProcess.exitCode === null) {
        await vscode.window.showWarningMessage(
            'Junexis: the current-build TraceCollector is already starting. Wait for it or stop the debug session.');
        return;
    }
    const client = createClient();
    if (await client.health()) {
        await vscode.window.showWarningMessage(
            'Junexis: a TraceCollector is already listening at the configured URL. Stop it before starting the current build so manifests cannot be mixed.');
        return;
    }
    let launch: TraceCollectorLaunch | undefined;
    try {
        launch = await resolveTraceCollectorLaunch(context);
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Junexis: configured TraceCollector distribution is invalid. ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (!launch) {
        await vscode.window.showWarningMessage(
            'Junexis: TraceCollector is not bundled for this platform. Install a platform VSIX, configure junexis.debug.traceCollectorPath, or open junexis-narrative for development.');
        return;
    }

    output.clear();
    output.appendLine(`Starting Junexis debug build ${build.buildId}`);
    output.appendLine(`Manifest: ${build.debugManifest}`);
    output.appendLine(`Backend: ${launch.label}`);
    const traceCollectorProcess = child_process.spawn(
        launch.command,
        [
            ...launch.prefixArgs,
            '--manifest',
            build.debugManifest,
            '--host',
            host,
            '--port',
            String(port),
        ],
        {
            cwd: launch.cwd,
            windowsHide: true,
        });
    ownedTraceCollectorProcess = traceCollectorProcess;
    traceCollectorProcess.stdout?.on('data', chunk => output.append(chunk.toString()));
    traceCollectorProcess.stderr?.on('data', chunk => output.append(chunk.toString()));
    traceCollectorProcess.on('error', error => {
        output.appendLine(`TraceCollector failed: ${error.message}`);
    });
    traceCollectorProcess.on('close', code => {
        output.appendLine(`TraceCollector stopped with code ${code ?? 'unknown'}.`);
        if (ownedTraceCollectorProcess === traceCollectorProcess) {
            ownedTraceCollectorProcess = undefined;
        }
    });

    if (!await waitForTraceCollector(client, 15000)) {
        if (traceCollectorProcess.exitCode === null) {
            traceCollectorProcess.kill();
        }
        if (ownedTraceCollectorProcess === traceCollectorProcess) {
            ownedTraceCollectorProcess = undefined;
        }
        output.show(true);
        await vscode.window.showErrorMessage(
            'Junexis: TraceCollector did not start. See the Junexis Debug output channel.');
        return;
    }

    await client.startSession(
        `${path.basename(build.projectRoot)} · ${build.buildId.slice(0, 12)}`);
    const syncedCount = await syncDebugBreakpoints(client, true);
    await resetBreakpointHitBaseline(client);
    await refreshDebugViews(
        client,
        sessionProvider,
        tasksProvider,
        traceProvider,
        stateProvider,
        breakpointsProvider,
        statusBar);
    startBreakpointHitWatcher(client, breakpointsProvider, statusBar);
    await vscode.commands.executeCommand('workbench.view.debug');
    await vscode.commands.executeCommand('junexisDebugSession.focus');
    await vscode.window.showInformationMessage(
        `Junexis: debugging verified build ${build.buildId.slice(0, 12)}; synced ${syncedCount} breakpoint(s).`);
}

function formatEventLine(event: TraceCollectorEvent, taskName: string): string {
    const attrs = event.attributes
        ? Object.entries(event.attributes).map(([key, value]) => `${key}=${value}`).join(', ')
        : '';
    return `#${event.eventId} ${taskName} ${event.kind} L=${event.lamportClock}${attrs ? ` · ${attrs}` : ''}`;
}

function formatAttributes(attributes?: Record<string, string>): string[] {
    const entries = Object.entries(attributes ?? {});
    if (entries.length === 0) {
        return ['_none_'];
    }

    return entries.map(([key, value]) => `- \`${key}\`: \`${value}\``);
}

async function buildDiagnosticStoryMarkdown(client: TraceCollectorClient, eventId: number): Promise<string[]> {
    const story = await client.story(eventId);
    const findings = mentorService
        ? await mentorService.findingsForStory(story).catch(() => undefined)
        : undefined;
    return diagnosticStoryMarkdown(story, findings).split('\n');
}

async function buildBreakpointSnapshotMarkdown(client: TraceCollectorClient, hit: DebugBreakpointHit): Promise<string> {
    const [state, events, storyLines] = await Promise.all([
        client.state().catch(() => undefined),
        client.events(100).catch(() => [] as TraceCollectorEvent[]),
        buildDiagnosticStoryMarkdown(client, hit.eventId).catch(error => [
            '## Diagnostic Story',
            '',
            `_Diagnostic Story unavailable: ${String(error instanceof Error ? error.message : error)}_`,
            ''
        ])
    ]);
    const event = events.find(candidate => candidate.eventId === hit.eventId);
    const taskResolution = await client.resolveTask(hit.taskId).catch(() => undefined);
    const taskName = taskResolution?.resolved ? taskResolution.displayName : `Task ${hit.taskId}`;
    const source = hit.source
        ? `${hit.source.file}:${hit.source.line}:${hit.source.column}`
        : '_no source location_';

    const lines = [
        `# Junexis Debug Snapshot #${hit.snapshotId}`,
        '',
        `Breakpoint hit: **#${hit.hitId}**`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Kind | \`${hit.kind}\` |`,
        `| Visual kind | \`${hit.visualKind}\` |`,
        `| Event | \`#${hit.eventId} ${hit.eventKind}\` |`,
        `| Task | \`${taskName}\` / \`${hit.taskId}\` |`,
        `| Lamport | \`${hit.lamportClock}\` |`,
        `| Source | \`${source}\` |`,
        `| Hit at | \`${hit.hitAt}\` |`,
        '',
        '## Runtime attributes at hit',
        '',
        ...formatAttributes(hit.attributes),
        ''
    ];

    if (event) {
        lines.push(
            '## Trace event',
            '',
            `- Event ID: \`${event.eventId}\``,
            `- Kind: \`${event.kind}\``,
            `- Function: \`${event.function ?? 'unknown'}\``,
            `- Source: \`${event.file && event.line ? `${event.file}:${event.line}` : 'unknown'}\``,
            '',
            '### Event attributes',
            '',
            ...formatAttributes(event.attributes),
            ''
        );
    }

    lines.push(...storyLines);

    if (state) {
        lines.push(
            '## Captured system state',
            '',
            `- Session: \`${state.session.status}\`${state.session.label ? ` — ${state.session.label}` : ''}`,
            `- Captured at: \`${state.capturedAt}\``,
            '',
            '### Tasks',
            ''
        );

        if (state.tasks.length === 0) {
            lines.push('_none_', '');
        } else {
            for (const task of state.tasks) {
                lines.push(`- \`${task.taskName}\` — \`${task.status}\`, L=\`${task.lamportClock}\``);
            }
            lines.push('');
        }

        lines.push('### Channels', '');
        if (state.channels.length === 0) {
            lines.push('_none_', '');
        } else {
            for (const channel of state.channels) {
                const backlog = channel.backlog === undefined ? '' : `, backlog=\`${channel.backlog}\``;
                const hash = channel.lastPayloadHash ? `, lastPayloadHash=\`${channel.lastPayloadHash}\`` : '';
                lines.push(`- \`${channel.channel}\` — \`${channel.status}\`, L=\`${channel.lamportClock}\`${backlog}${hash}`);
            }
            lines.push('');
        }
    }

    lines.push(
        '## Interpretation',
        '',
        'Ten snapshot oznacza, że wygenerowany runtime doszedł do miejsca w kodzie Junexis, które odpowiada breakpointowi. Na tym etapie debugger rejestruje hit i stan obserwowalny; pełne zatrzymywanie wykonywania runtime jest następnym etapem implementacji.',
        ''
    );

    return lines.join('\n');
}

async function showBreakpointSnapshot(hit: DebugBreakpointHit, client = createClient()): Promise<void> {
    const content = await buildBreakpointSnapshotMarkdown(client, hit);
    const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
}

async function refreshDebugViews(
    client: TraceCollectorClient,
    sessionProvider: DebugSessionProvider,
    tasksProvider: DebugTasksProvider,
    traceProvider: DebugTraceProvider,
    stateProvider: DebugStateProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
    revealNewBreakpointHit = false,
): Promise<void> {
    if (!await client.health()) {
        sessionProvider.clear();
        tasksProvider.clear();
        traceProvider.clear();
        stateProvider.clear();
        breakpointsProvider.clear();
        updateDebugStatusBar(statusBar, 'disconnected');
        return;
    }

    await sessionProvider.refresh(client);
    await tasksProvider.refresh(client);
    await traceProvider.refresh(client);
    await stateProvider.refresh(client);
    await breakpointsProvider.refresh(client);
    const [session, hits] = await Promise.all([
        client.session().catch(() => undefined),
        client.breakpointHits(20).catch(() => [] as DebugBreakpointHit[])
    ]);
    const latest = hits.length > 0 ? hits[hits.length - 1] : undefined;
    updateDebugStatusBar(statusBar, session?.status ?? 'created', latest);

    if (revealNewBreakpointHit) {
        if (latest && latest.hitId > lastSeenBreakpointHitId) {
            lastSeenBreakpointHitId = latest.hitId;
            await showBreakpointHit(latest, breakpointsProvider, statusBar);
        }
    }
}

async function explainEvent(client: TraceCollectorClient, eventId?: number): Promise<void> {
    const selected = eventId ?? Number(await vscode.window.showInputBox({
        title: 'Junexis: Explain Debug Event',
        prompt: 'Trace event ID',
        placeHolder: '8',
        validateInput: value => /^\d+$/.test(value.trim()) ? undefined : 'Event ID must be a number.'
    }));

    if (!selected || Number.isNaN(selected)) {
        return;
    }

    const lines = await buildDiagnosticStoryMarkdown(client, selected);

    const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: lines.join('\n')
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function explainLatestDebugHit(client: TraceCollectorClient): Promise<void> {
    const hits = await client.breakpointHits(50);
    const latest = hits.length > 0 ? hits[hits.length - 1] : undefined;
    if (!latest) {
        await vscode.window.showInformationMessage('Junexis: nie ma jeszcze trafionego breakpointa do wyjaśnienia.');
        return;
    }

    lastSeenBreakpointHitId = Math.max(lastSeenBreakpointHitId, latest.hitId);
    const lines = [
        `# Junexis why for breakpoint hit #${latest.hitId}`,
        '',
        `Snapshot: \`#${latest.snapshotId}\``,
        '',
        `Source: \`${latest.source ? `${latest.source.file}:${latest.source.line}:${latest.source.column}` : 'unknown'}\``,
        '',
        ...(await buildDiagnosticStoryMarkdown(client, latest.eventId))
    ];
    const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: lines.join('\n')
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function openTaskSource(resolution: ManifestTaskResolution): Promise<void> {
    if (!resolution.source) {
        return;
    }

    const uri = vscode.Uri.file(resolution.source.file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const position = new vscode.Position(Math.max(0, resolution.source.line - 1), Math.max(0, resolution.source.column - 1));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function openBreakpointHitSource(hit: DebugBreakpointHit): Promise<void> {
    if (!hit.source) {
        await vscode.window.showWarningMessage(`Junexis: breakpoint hit #${hit.hitId} nie ma lokalizacji źródłowej.`);
        return;
    }

    const uri = vscode.Uri.file(hit.source.file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const position = new vscode.Position(Math.max(0, hit.source.line - 1), Math.max(0, hit.source.column - 1));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function showBreakpointHit(
    hit: DebugBreakpointHit,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar?: vscode.StatusBarItem,
): Promise<void> {
    await openBreakpointHitSource(hit);
    await breakpointsProvider.refresh(createClient());
    await vscode.commands.executeCommand('junexisDebugBreakpoints.focus');
    if (statusBar) {
        updateDebugStatusBar(statusBar, 'paused', hit);
    }
    await showBreakpointSnapshot(hit);
    await vscode.window.showInformationMessage(
        `Junexis breakpoint hit #${hit.hitId}: ${hit.kind} event #${hit.eventId}, snapshot #${hit.snapshotId}.`
    );
}

async function showLatestBreakpointHit(client: TraceCollectorClient, breakpointsProvider: DebugBreakpointsProvider): Promise<void> {
    const hits = await client.breakpointHits(50);
    const latest = hits.length > 0 ? hits[hits.length - 1] : undefined;
    if (!latest) {
        await vscode.window.showInformationMessage('Junexis: nie ma jeszcze trafionych breakpointów w TraceCollectorze.');
        return;
    }

    lastSeenBreakpointHitId = Math.max(lastSeenBreakpointHitId, latest.hitId);
    await showBreakpointHit(latest, breakpointsProvider);
}

async function showLatestDebugSnapshot(client: TraceCollectorClient): Promise<void> {
    const hits = await client.breakpointHits(50);
    const latest = hits.length > 0 ? hits[hits.length - 1] : undefined;
    if (!latest) {
        await vscode.window.showInformationMessage('Junexis: nie ma jeszcze snapshotu breakpointa. Uruchom debug demo albo zsynchronizuj breakpointy i wywołaj zdarzenie runtime.');
        return;
    }

    lastSeenBreakpointHitId = Math.max(lastSeenBreakpointHitId, latest.hitId);
    await openBreakpointHitSource(latest);
    await showBreakpointSnapshot(latest, client);
}

async function continueDebugSession(
    client: TraceCollectorClient,
    sessionProvider: DebugSessionProvider,
    tasksProvider: DebugTasksProvider,
    traceProvider: DebugTraceProvider,
    stateProvider: DebugStateProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): Promise<void> {
    if (!await client.health()) {
        updateDebugStatusBar(statusBar, 'disconnected');
        await vscode.window.showWarningMessage(`Junexis: TraceCollector is not reachable at ${debugConfigUrl()}; cannot continue debug session.`);
        return;
    }

    const session = await client.resumeSession();
    updateDebugStatusBar(statusBar, session.status);
    await refreshDebugViews(client, sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, statusBar);
    await vscode.window.showInformationMessage(`Junexis: debug session continued (${session.status}).`);
}

async function resetBreakpointHitBaseline(client: TraceCollectorClient): Promise<void> {
    try {
        const hits = await client.breakpointHits(50);
        lastSeenBreakpointHitId = hits.reduce((max, hit) => Math.max(max, hit.hitId), 0);
    } catch {
        lastSeenBreakpointHitId = 0;
    }
}

function startBreakpointHitWatcher(
    client: TraceCollectorClient,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): void {
    if (breakpointHitWatcher) {
        clearInterval(breakpointHitWatcher);
        breakpointHitWatcher = undefined;
    }

    const deadline = Date.now() + 20000;
    breakpointHitWatcher = setInterval(() => {
        void (async () => {
            if (Date.now() > deadline) {
                if (breakpointHitWatcher) {
                    clearInterval(breakpointHitWatcher);
                    breakpointHitWatcher = undefined;
                }
                return;
            }

            if (!await client.health()) {
                return;
            }

            const hits = await client.breakpointHits(20);
            const latest = hits.length > 0 ? hits[hits.length - 1] : undefined;
            if (!latest || latest.hitId <= lastSeenBreakpointHitId) {
                return;
            }

            lastSeenBreakpointHitId = latest.hitId;
            if (breakpointHitWatcher) {
                clearInterval(breakpointHitWatcher);
                breakpointHitWatcher = undefined;
            }

            await showBreakpointHit(latest, breakpointsProvider, statusBar);
        })().catch(error => {
            console.error('Junexis breakpoint hit watcher failed', error);
        });
    }, 500);
}

async function runCncDebugDemo(
    context: vscode.ExtensionContext,
    sessionProvider: DebugSessionProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): Promise<void> {
    const narrativeRoot = await findNarrativeRoot(context);
    if (!narrativeRoot) {
        await vscode.window.showWarningMessage('Junexis: nie znalazłem repo junexis-narrative. Ustaw junexis.debug.narrativeRoot albo otwórz workspace z folderem junexis-narrative.');
        return;
    }

    const port = parseTraceCollectorPort();
    if (!port) {
        await vscode.window.showWarningMessage('Junexis: CNC Debug Demo wymaga lokalnego TraceCollector URL z portem, np. http://127.0.0.1:8080.');
        return;
    }

    const script = path.join(narrativeRoot, 'scripts', 'run-cnc-debug-demo.ps1');
    const activeJunexisBreakpoints = collectJunexisSourceBreakpoints().breakpoints.filter(bp => bp.enabled);
    const usesDemoFallbackBreakpoint = activeJunexisBreakpoints.length === 0;
    const fallbackArgument = usesDemoFallbackBreakpoint ? ' -SourceBreakpointLine 117' : '';
    const terminal = vscode.window.createTerminal({
        name: 'Junexis CNC Debug Demo',
        cwd: narrativeRoot
    });

    terminal.show();
    terminal.sendText(`powershell -ExecutionPolicy Bypass -File "${script}" -Port ${port} -KeepServer -WaitBeforeSeedSeconds 5${fallbackArgument}`);
    await vscode.commands.executeCommand('workbench.view.debug');
    await vscode.commands.executeCommand('junexisDebugSession.focus');

    const client = createClient();
    if (await waitForTraceCollector(client, 7000)) {
        const syncedCount = usesDemoFallbackBreakpoint
            ? 0
            : await syncDebugBreakpoints(client, true);
        await resetBreakpointHitBaseline(client);
        await sessionProvider.refresh(client);
        startBreakpointHitWatcher(client, breakpointsProvider, statusBar);
        const message = usesDemoFallbackBreakpoint
            ? 'Junexis: CNC Debug Demo używa fallback breakpointa na linii 117, bo VS Code nie ma aktywnych breakpointów .jnx.'
            : `Junexis: CNC Debug Demo uruchomione. Zsynchronizowano ${syncedCount} breakpoint(ów) .jnx przed seedem eventów.`;
        await vscode.window.showInformationMessage(message);
        return;
    }

    await vscode.window.showInformationMessage(`Junexis: CNC Debug Demo uruchomione na ${debugConfigUrl()}. Jeśli breakpointy nie zadziałają, użyj Junexis: Sync Debug Breakpoints i uruchom seed ponownie.`);
}

async function runCncLiveDebugDemo(
    context: vscode.ExtensionContext,
    sessionProvider: DebugSessionProvider,
    breakpointsProvider: DebugBreakpointsProvider,
    statusBar: vscode.StatusBarItem,
): Promise<void> {
    const narrativeRoot = await findNarrativeRoot(context);
    if (!narrativeRoot) {
        await vscode.window.showWarningMessage('Junexis: nie znalazłem repo junexis-narrative. Ustaw junexis.debug.narrativeRoot albo otwórz workspace z folderem junexis-narrative.');
        return;
    }

    const port = parseTraceCollectorPort();
    if (!port) {
        await vscode.window.showWarningMessage('Junexis: CNC Live Debug Demo wymaga lokalnego TraceCollector URL z portem, np. http://127.0.0.1:8080.');
        return;
    }

    const script = path.join(narrativeRoot, 'scripts', 'run-cnc-live-debug-demo.ps1');
    const activeJunexisBreakpoints = collectJunexisSourceBreakpoints().breakpoints.filter(bp => bp.enabled);
    const usesDemoFallbackBreakpoint = activeJunexisBreakpoints.length === 0;
    const fallbackArgument = usesDemoFallbackBreakpoint ? ' -SourceBreakpointLine 117' : '';
    const terminal = vscode.window.createTerminal({
        name: 'Junexis CNC Live Debug Demo',
        cwd: narrativeRoot
    });

    terminal.show();
    terminal.sendText(`powershell -ExecutionPolicy Bypass -File "${script}" -Port ${port} -TcpPort 9000 -KeepProcesses${fallbackArgument}`);
    await vscode.commands.executeCommand('workbench.view.debug');
    await vscode.commands.executeCommand('junexisDebugSession.focus');

    const client = createClient();
    if (await waitForTraceCollector(client, 7000)) {
        const syncedCount = usesDemoFallbackBreakpoint
            ? 0
            : await syncDebugBreakpoints(client, true);
        await resetBreakpointHitBaseline(client);
        await sessionProvider.refresh(client);
        startBreakpointHitWatcher(client, breakpointsProvider, statusBar);
        const message = usesDemoFallbackBreakpoint
            ? 'Junexis: CNC Live Debug Demo używa fallback breakpointa na linii 117, bo VS Code nie ma aktywnych breakpointów .jnx.'
            : `Junexis: CNC Live Debug Demo uruchomione. Zsynchronizowano ${syncedCount} breakpoint(ów) .jnx.`;
        await vscode.window.showInformationMessage(message);
        return;
    }

    await vscode.window.showInformationMessage(`Junexis: CNC Live Debug Demo uruchomione w terminalu. Jeśli UI nie przeskoczy do hitu, użyj Junexis: Refresh Debug Views.`);
}

export function registerJunexisDebugUi(
    context: vscode.ExtensionContext,
    mentor?: MentorService,
): vscode.Disposable {
    mentorService = mentor;
    const sessionProvider = new DebugSessionProvider();
    const tasksProvider = new DebugTasksProvider();
    const traceProvider = new DebugTraceProvider();
    const stateProvider = new DebugStateProvider();
    const breakpointsProvider = new DebugBreakpointsProvider();
    const debugStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
    const debugOutput = vscode.window.createOutputChannel('Junexis Debug');
    debugStatusBar.command = 'junexis.debug.refresh';
    updateDebugStatusBar(debugStatusBar, 'disconnected');
    let debugDemanded = false;
    const demandDebug = (): void => {
        if (!debugDemanded) {
            debugDemanded = true;
            debugStatusBar.show();
        }
    };
    const withDebugDemand = <T>(action: () => T): T => {
        demandDebug();
        return action();
    };
    const debugViews = [
        vscode.window.createTreeView('junexisDebugSession', { treeDataProvider: sessionProvider }),
        vscode.window.createTreeView('junexisDebugTasks', { treeDataProvider: tasksProvider }),
        vscode.window.createTreeView('junexisDebugTrace', { treeDataProvider: traceProvider }),
        vscode.window.createTreeView('junexisDebugState', { treeDataProvider: stateProvider }),
        vscode.window.createTreeView('junexisDebugBreakpoints', { treeDataProvider: breakpointsProvider }),
    ];

    const disposables: vscode.Disposable[] = [
        debugStatusBar,
        debugOutput,
        ...debugViews,
        ...debugViews.map(view => view.onDidChangeVisibility(event => {
            if (event.visible) {
                demandDebug();
            }
        })),
        vscode.commands.registerCommand('junexis.debug.refresh', () => withDebugDemand(async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Junexis Debug: refreshing TraceCollector state…' },
                () => refreshDebugViews(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar, true)
            );
        })),
        vscode.commands.registerCommand('junexis.debug.showTasks', () => withDebugDemand(async () => {
            await refreshDebugViews(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar);
            await vscode.commands.executeCommand('junexisDebugTasks.focus');
        })),
        vscode.commands.registerCommand('junexis.debug.showTrace', () => withDebugDemand(async () => {
            await refreshDebugViews(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar);
            await vscode.commands.executeCommand('junexisDebugTrace.focus');
        })),
        vscode.commands.registerCommand('junexis.debug.showState', () => withDebugDemand(async () => {
            await refreshDebugViews(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar);
            await vscode.commands.executeCommand('junexisDebugState.focus');
        })),
        vscode.commands.registerCommand('junexis.debug.showBreakpoints', () => withDebugDemand(async () => {
            await syncDebugBreakpoints(createClient(), true);
            await refreshDebugViews(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar);
            await vscode.commands.executeCommand('junexisDebugBreakpoints.focus');
        })),
        vscode.commands.registerCommand('junexis.debug.syncBreakpoints', () => withDebugDemand(async () => {
            await syncDebugBreakpoints(createClient(), false);
            await breakpointsProvider.refresh(createClient());
        })),
        vscode.commands.registerCommand('junexis.debug.explainEvent', (eventId?: number) => withDebugDemand(async () => {
            await explainEvent(createClient(), eventId ?? traceProvider.getLastEventId());
        })),
        vscode.commands.registerCommand('junexis.debug.openTaskSource', (resolution: ManifestTaskResolution) =>
            withDebugDemand(() => openTaskSource(resolution))),
        vscode.commands.registerCommand('junexis.debug.openBreakpointHitSource', (hit: DebugBreakpointHit) =>
            withDebugDemand(() => openBreakpointHitSource(hit))),
        vscode.commands.registerCommand('junexis.debug.showLatestBreakpointHit', () =>
            withDebugDemand(() => showLatestBreakpointHit(createClient(), breakpointsProvider))),
        vscode.commands.registerCommand('junexis.debug.showLatestDebugSnapshot', () =>
            withDebugDemand(() => showLatestDebugSnapshot(createClient()))),
        vscode.commands.registerCommand('junexis.debug.explainLatestDebugHit', () =>
            withDebugDemand(() => explainLatestDebugHit(createClient()))),
        vscode.commands.registerCommand('junexis.debug.continueSession', () =>
            withDebugDemand(() => continueDebugSession(createClient(), sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar))),
        vscode.commands.registerCommand('junexis.debug.startCurrentBuild', () =>
            withDebugDemand(() => startCurrentBuildDebug(
                context,
                debugOutput,
                sessionProvider,
                tasksProvider,
                traceProvider,
                stateProvider,
                breakpointsProvider,
                debugStatusBar))),
        vscode.commands.registerCommand('junexis.debug.runCncDemo', () =>
            withDebugDemand(() => runCncDebugDemo(context, sessionProvider, breakpointsProvider, debugStatusBar))),
        vscode.commands.registerCommand('junexis.debug.runCncLiveDemo', () =>
            withDebugDemand(() => runCncLiveDebugDemo(context, sessionProvider, breakpointsProvider, debugStatusBar))),
        vscode.commands.registerCommand('junexis.debug.stopSession', () =>
            withDebugDemand(() => stopLocalTraceCollector(sessionProvider, tasksProvider, traceProvider, stateProvider, breakpointsProvider, debugStatusBar))),
        vscode.debug.onDidChangeBreakpoints(() => {
            if (!debugDemanded) {
                return;
            }
            void syncDebugBreakpoints(createClient(), true).then(() => breakpointsProvider.refresh(createClient()), () => undefined);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('junexis.debug.traceCollectorUrl')) {
                updateDebugStatusBar(debugStatusBar, 'disconnected');
                sessionProvider.clear();
                tasksProvider.clear();
                traceProvider.clear();
                stateProvider.clear();
                breakpointsProvider.clear();
            }
        })
    ];

    context.subscriptions.push(new vscode.Disposable(() => {
        if (ownedTraceCollectorProcess && ownedTraceCollectorProcess.exitCode === null) {
            ownedTraceCollectorProcess.kill();
            ownedTraceCollectorProcess = undefined;
        }
        if (breakpointHitWatcher) {
            clearInterval(breakpointHitWatcher);
            breakpointHitWatcher = undefined;
        }
    }));

    return vscode.Disposable.from(
        ...disposables,
        new vscode.Disposable(() => {
            if (mentorService === mentor) {
                mentorService = undefined;
            }
        }),
    );
}
