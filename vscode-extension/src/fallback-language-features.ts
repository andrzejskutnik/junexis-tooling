import * as vscode from 'vscode';

interface TopLevelSymbol {
    keyword: string;
    name: string;
    range: vscode.Range;
    selectionRange: vscode.Range;
    bodyText: string;
    headerText: string;
}

interface NestedHoverSymbol {
    name: string;
    kind: string;
    detail: string;
}

interface HoverMatch {
    topLevel?: TopLevelSymbol;
    nested?: NestedHoverSymbol;
}

const declarationPattern = /^\s*(struct|enum|fn|task|pipeline|service|device|api|protocol|narrative)\s+(\w+)/gm;

const kindMap: Record<string, vscode.SymbolKind> = {
    struct: vscode.SymbolKind.Struct,
    enum: vscode.SymbolKind.Enum,
    fn: vscode.SymbolKind.Function,
    task: vscode.SymbolKind.Class,
    pipeline: vscode.SymbolKind.Module,
    service: vscode.SymbolKind.Class,
    device: vscode.SymbolKind.Interface,
    api: vscode.SymbolKind.Interface,
    protocol: vscode.SymbolKind.Interface,
    narrative: vscode.SymbolKind.String,
};

const keywordDocs: Record<string, string> = {
    struct: 'Keyword that declares a structural data type.',
    enum: 'Keyword that declares an enumeration type.',
    task: 'Task declaration. Defines an execution unit in Junexis.',
    fn: 'Pure function declaration. Used for deterministic transformation logic.',
    pipeline: 'Pipeline declaration. Composes tasks into a flow.',
    service: 'Service declaration.',
    device: 'Device declaration for embedded or external hardware.',
    api: 'API declaration for HTTP-style contracts.',
    protocol: 'Protocol declaration for bindings and transport rules.',
    narrative: 'Narrative metadata block for intent and observability.',
    if: 'Conditional branch keyword.',
    else: 'Alternative branch for a conditional statement.',
    for: 'Iteration keyword for collection traversal.',
    in: 'Keyword used in iteration and membership-style constructs.',
    loop: 'Infinite or long-running processing loop keyword.',
    every: 'Periodic execution keyword.',
    return: 'Return keyword for functions.',
    send: 'Keyword used to send a value to a channel or downstream target.',
    recv: 'Keyword used to receive a value from a channel.',
    ack: 'Queue acknowledgement primitive. `ack message` confirms processing of a value received from `queue<T>`. Status: proposed; Go/TypeScript lowering exists.',
    nack: 'Queue negative acknowledgement primitive. `nack message reason text` keeps delivery context for retry/DLQ policy. Status: proposed; Go/TypeScript lowering exists.',
    latest: 'Stream latest-value primitive. `latest(stream<T>) -> T` reads the latest known stream value without ACK. Status: proposed; empty-stream semantics are experimental.',
    batch: 'Queue batch snapshot primitive. `batch(queue<T>, Int) -> List<T>` returns queued payloads without ACK/NACK. Status: proposed; stream batching is intentionally unsupported.',
    match: 'Pattern matching keyword.',
    delay: 'Delay execution for a duration.',
    parallel: 'Marks a parallel execution branch.',
    chan: 'Point-to-point communication channel.',
    queue: 'Durable queue communication type.',
    stream: 'Broadcast/latest-wins communication stream.',
    state: 'Persistent task-local state declaration.',
    config: 'Configuration access scope.',
    deviceRef: 'Device-bound configuration and hardware access scope.',
    hardware: 'Device hardware configuration section.',
    network: 'Device network configuration section.',
    storage: 'Device storage configuration section.',
    timing: 'Device timing configuration section.',
    external: 'Device external integration section.',
    embedded: 'Platform annotation for embedded targets.',
    server: 'Platform annotation for server-side targets.',
    report: 'Platform annotation for reporting or frontend targets.',
};

const builtinTypeDocs: Record<string, string> = {
    Int: 'Built-in integer numeric type.',
    Float: 'Built-in floating-point numeric type.',
    Bool: 'Built-in boolean type.',
    Text: 'Built-in text/string type.',
    Time: 'Built-in temporal value type.',
    Duration: 'Built-in duration type for intervals such as 5s or 5m.',
    Map: 'Built-in associative collection type.',
    u8: 'Unsigned 8-bit integer type.',
    u16: 'Unsigned 16-bit integer type.',
    u32: 'Unsigned 32-bit integer type.',
    u64: 'Unsigned 64-bit integer type.',
    i8: 'Signed 8-bit integer type.',
    i16: 'Signed 16-bit integer type.',
    i32: 'Signed 32-bit integer type.',
    i64: 'Signed 64-bit integer type.',
    f32: '32-bit floating-point numeric type.',
    f64: '64-bit floating-point numeric type.',
};

const keywordCompletions = [
    'task',
    'fn',
    'struct',
    'enum',
    'pipeline',
    'service',
    'device',
    'api',
    'protocol',
    'narrative',
    'state',
    'config',
    'chan',
    'queue',
    'stream',
    'ack',
    'nack',
    'latest',
    'batch',
    '@embedded',
    '@server',
    '@report',
];

const builtinTypeCompletions = [
    'Int',
    'Float',
    'Bool',
    'Text',
    'Time',
    'Duration',
    'Map',
    'u8',
    'u16',
    'u32',
    'u64',
    'i8',
    'i16',
    'i32',
    'i64',
    'f32',
    'f64',
];

function openBraceIndex(text: string, declarationStart: number): number {
    const openBrace = text.indexOf('{', declarationStart);
    return openBrace === -1 ? text.length : openBrace;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectTopLevelSymbols(document: vscode.TextDocument): TopLevelSymbol[] {
    const symbols: TopLevelSymbol[] = [];
    const text = document.getText();
    let match: RegExpExecArray | null;

    while ((match = declarationPattern.exec(text)) !== null) {
        const keyword = match[1];
        const name = match[2];
        const start = match.index + match[0].indexOf(name);
        const startPos = document.positionAt(start);
        const endPos = startPos.translate(0, name.length);
        const block = findDeclarationBlock(document, match.index);

        symbols.push({
            keyword,
            name,
            range: block.range,
            selectionRange: new vscode.Range(startPos, endPos),
            bodyText: block.bodyText,
            headerText: text.slice(match.index, openBraceIndex(text, match.index)).trim(),
        });
    }

    return symbols;
}

function findDeclarationBlock(document: vscode.TextDocument, declarationStart: number): { range: vscode.Range; bodyText: string } {
    const text = document.getText();
    const openBrace = text.indexOf('{', declarationStart);

    if (openBrace === -1) {
        const line = document.lineAt(document.positionAt(declarationStart).line).range;
        return { range: line, bodyText: '' };
    }

    let depth = 0;
    for (let index = openBrace; index < text.length; index += 1) {
        const char = text[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    range: new vscode.Range(document.positionAt(declarationStart), document.positionAt(index + 1)),
                    bodyText: text.slice(openBrace + 1, index),
                };
            }
        }
    }

    return {
        range: new vscode.Range(document.positionAt(declarationStart), document.positionAt(text.length)),
        bodyText: text.slice(openBrace + 1),
    };
}

function collectChildSymbols(symbol: TopLevelSymbol): vscode.DocumentSymbol[] {
    if (!symbol.bodyText.trim()) {
        return [];
    }

    if (symbol.keyword === 'struct') {
        return collectStructFieldSymbols(symbol);
    }

    if (symbol.keyword === 'task') {
        return collectTaskChildSymbols(symbol);
    }

    if (symbol.keyword === 'device') {
        return collectSectionSymbols(symbol, ['hardware', 'network', 'storage', 'timing', 'external']);
    }

    if (symbol.keyword === 'pipeline') {
        return collectPipelineUseSymbols(symbol);
    }

    return [];
}

function collectStructFieldSymbols(symbol: TopLevelSymbol): vscode.DocumentSymbol[] {
    const fields: vscode.DocumentSymbol[] = [];
    const pattern = /^\s*(\w+)\s*:\s*.+$/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(symbol.bodyText)) !== null) {
        const fieldName = match[1];
        const childRange = symbol.selectionRange;
        fields.push(new vscode.DocumentSymbol(
            fieldName,
            'field',
            vscode.SymbolKind.Field,
            childRange,
            childRange,
        ));
    }

    return fields;
}

function collectTaskChildSymbols(symbol: TopLevelSymbol): vscode.DocumentSymbol[] {
    const children: vscode.DocumentSymbol[] = [];

    children.push(...collectSectionSymbols(symbol, ['config']));

    const statePattern = /^\s*state\s+(\w+)/gm;
    let stateMatch: RegExpExecArray | null;
    while ((stateMatch = statePattern.exec(symbol.bodyText)) !== null) {
        const stateName = stateMatch[1];
        children.push(new vscode.DocumentSymbol(
            stateName,
            'state',
            vscode.SymbolKind.Variable,
            symbol.selectionRange,
            symbol.selectionRange,
        ));
    }

    const hookPattern = /^\s*on_(\w+)/gm;
    let hookMatch: RegExpExecArray | null;
    while ((hookMatch = hookPattern.exec(symbol.bodyText)) !== null) {
        const hookName = 'on_' + hookMatch[1];
        children.push(new vscode.DocumentSymbol(
            hookName,
            'lifecycle hook',
            vscode.SymbolKind.Event,
            symbol.selectionRange,
            symbol.selectionRange,
        ));
    }

    return children;
}

function collectSectionSymbols(symbol: TopLevelSymbol, sectionNames: string[]): vscode.DocumentSymbol[] {
    const sections: vscode.DocumentSymbol[] = [];

    for (const sectionName of sectionNames) {
        const pattern = new RegExp('^\\s*' + sectionName + '\\s*\\{', 'gm');
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(symbol.bodyText)) !== null) {
            sections.push(new vscode.DocumentSymbol(
                sectionName,
                'section',
                vscode.SymbolKind.Namespace,
                symbol.selectionRange,
                symbol.selectionRange,
            ));
        }
    }

    return sections;
}

function collectPipelineUseSymbols(symbol: TopLevelSymbol): vscode.DocumentSymbol[] {
    const uses: vscode.DocumentSymbol[] = [];
    const pattern = /^\s*use\s+(\w+)/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(symbol.bodyText)) !== null) {
        uses.push(new vscode.DocumentSymbol(
            match[1],
            'use',
            vscode.SymbolKind.Operator,
            symbol.selectionRange,
            symbol.selectionRange,
        ));
    }

    return uses;
}

function findNestedHoverSymbol(symbol: TopLevelSymbol, word: string): NestedHoverSymbol | undefined {
    if (symbol.keyword === 'struct') {
        const fieldPattern = new RegExp('^\\s*' + escapeRegex(word) + '\\s*:\\s*(.+)$', 'm');
        const fieldMatch = symbol.bodyText.match(fieldPattern);
        if (fieldMatch) {
            return { name: word, kind: 'field', detail: fieldMatch[1].trim() };
        }
    }

    if (symbol.keyword === 'task') {
        const statePattern = new RegExp('^\\s*state\\s+' + escapeRegex(word) + '\\s*:\\s*(.+)$', 'm');
        const stateMatch = symbol.bodyText.match(statePattern);
        if (stateMatch) {
            return { name: word, kind: 'state', detail: stateMatch[1].trim() };
        }

        if (symbol.bodyText.includes('config {')) {
            const configPattern = new RegExp('^\\s*' + escapeRegex(word) + '\\s*:\\s*(.+)$', 'm');
            const configMatch = symbol.bodyText.match(configPattern);
            if (configMatch) {
                return { name: word, kind: 'config', detail: configMatch[1].trim() };
            }
        }

        const parameterPattern = new RegExp('\\b' + escapeRegex(word) + '\\s*:\\s*([^,)]+)', 'm');
        const parameterMatch = symbol.headerText.match(parameterPattern);
        if (parameterMatch) {
            return { name: word, kind: 'parameter', detail: parameterMatch[1].trim() };
        }

        if (word.startsWith('on_') && symbol.bodyText.match(new RegExp('^\\s*' + escapeRegex(word) + '\\b', 'm'))) {
            return { name: word, kind: 'lifecycle hook', detail: 'Task lifecycle block' };
        }
    }

    if (symbol.keyword === 'device') {
        const sectionPattern = new RegExp('^\\s*' + escapeRegex(word) + '\\s*\\{', 'm');
        if (symbol.bodyText.match(sectionPattern)) {
            return { name: word, kind: 'section', detail: 'Device configuration section' };
        }
    }

    return undefined;
}

function findMatchingSymbol(document: vscode.TextDocument, position: vscode.Position): HoverMatch {
    const word = getWordAt(document, position);
    if (!word) {
        return {};
    }

    const symbols = collectTopLevelSymbols(document);
    const topLevel = symbols.find(symbol => symbol.name === word);
    if (topLevel) {
        return { topLevel };
    }

    const enclosing = symbols.find(symbol => symbol.range.contains(position));
    if (!enclosing) {
        return {};
    }

    const nested = findNestedHoverSymbol(enclosing, word);
    if (nested) {
        return {
            topLevel: enclosing,
            nested,
        };
    }

    return {};
}

function describeTopLevelSymbol(symbol: TopLevelSymbol): string {
    switch (symbol.keyword) {
        case 'struct':
            return 'Type declaration defined in the current file.';
        case 'enum':
            return 'Enumeration declaration defined in the current file.';
        case 'fn':
            return 'Pure function declaration defined in the current file.';
        case 'task':
            return 'Task declaration defined in the current file.';
        case 'pipeline':
            return 'Pipeline declaration defined in the current file.';
        case 'service':
            return 'Service declaration defined in the current file.';
        case 'device':
            return 'Device declaration defined in the current file.';
        case 'api':
            return 'API declaration defined in the current file.';
        case 'protocol':
            return 'Protocol declaration defined in the current file.';
        case 'narrative':
            return 'Narrative declaration defined in the current file.';
        default:
            return 'Local declaration in the current file.';
    }
}

function describeNestedSymbol(topLevel: TopLevelSymbol, nested: NestedHoverSymbol): string {
    switch (nested.kind) {
        case 'field':
            return 'Field declared in `' + topLevel.name + '`.';
        case 'parameter':
            return 'Parameter declared in `' + topLevel.name + '`.';
        case 'state':
            return 'Persistent state declared in `' + topLevel.name + '`.';
        case 'config':
            return 'Configuration entry declared in `' + topLevel.name + '`.';
        case 'section':
            return 'Section declared in `' + topLevel.name + '`.';
        case 'lifecycle hook':
            return 'Lifecycle hook declared in `' + topLevel.name + '`.';
        default:
            return 'Declared inside `' + topLevel.name + '`.';
    }
}

function createHoverMarkdown(topLevel: TopLevelSymbol, nested?: NestedHoverSymbol): vscode.MarkdownString[] {
    if (nested) {
        return [
            new vscode.MarkdownString('```jnx\n' + nested.kind + ' ' + nested.name + ': ' + nested.detail + '\n```'),
            new vscode.MarkdownString(describeNestedSymbol(topLevel, nested))
        ];
    }

    return [
        new vscode.MarkdownString('```jnx\n' + topLevel.headerText + '\n```'),
        new vscode.MarkdownString(describeTopLevelSymbol(topLevel))
    ];
}

function getWordAt(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    return document.getText(document.getWordRangeAtPosition(position));
}

export function registerFallbackLanguageFeatures(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'junexis' },
            {
                provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
                    return collectTopLevelSymbols(document).map(symbol => {
                        const item = new vscode.DocumentSymbol(
                            symbol.name,
                            symbol.keyword,
                            kindMap[symbol.keyword] ?? vscode.SymbolKind.Module,
                            symbol.range,
                            symbol.selectionRange,
                        );
                        item.children = collectChildSymbols(symbol);
                        return item;
                    });
                }
            }
        )
    );

    disposables.push(registerFallbackEditorFeatures());
    return vscode.Disposable.from(...disposables);
}

export function registerFallbackEditorFeatures(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.languages.registerHoverProvider(
            { language: 'junexis' },
            {
                provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
                    const word = getWordAt(document, position);
                    if (!word) {
                        return undefined;
                    }

                    const match = findMatchingSymbol(document, position);
                    if (match.topLevel) {
                        return new vscode.Hover(createHoverMarkdown(match.topLevel, match.nested));
                    }

                    const builtinTypeDoc = builtinTypeDocs[word];
                    if (builtinTypeDoc) {
                        return new vscode.Hover([
                            new vscode.MarkdownString('```jnx\n' + word + '\n```'),
                            new vscode.MarkdownString(builtinTypeDoc),
                        ]);
                    }

                    const docKey = word === 'device' ? 'deviceRef' : word.startsWith('@') ? word.slice(1) : word;
                    const doc = keywordDocs[docKey];
                    if (!doc) {
                        return undefined;
                    }

                    return new vscode.Hover([
                        new vscode.MarkdownString('```jnx\n' + word + '\n```'),
                        new vscode.MarkdownString(doc),
                    ]);
                }
            }
        )
    );

    disposables.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'junexis' },
            {
                provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
                    const word = getWordAt(document, position);
                    if (!word) {
                        return undefined;
                    }

                    const declaration = collectTopLevelSymbols(document).find(symbol => symbol.name === word);
                    if (!declaration) {
                        return undefined;
                    }

                    return new vscode.Location(document.uri, declaration.selectionRange);
                }
            }
        )
    );

    disposables.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'junexis' },
            {
                provideCompletionItems(document: vscode.TextDocument): vscode.CompletionItem[] {
                    const items: vscode.CompletionItem[] = [];

                    for (const keyword of keywordCompletions) {
                        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                        item.insertText = keyword;
                        items.push(item);
                    }

                    for (const typeName of builtinTypeCompletions) {
                        const item = new vscode.CompletionItem(typeName, vscode.CompletionItemKind.TypeParameter);
                        item.insertText = typeName;
                        items.push(item);
                    }

                    for (const symbol of collectTopLevelSymbols(document)) {
                        const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Reference);
                        item.detail = 'Local ' + symbol.keyword;
                        item.insertText = symbol.name;
                        items.push(item);
                    }

                    return items;
                }
            }
        )
    );

    return vscode.Disposable.from(...disposables);
}
