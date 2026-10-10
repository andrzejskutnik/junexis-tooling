import { parse } from '@junexislang/parser';
import { Printer } from './printer';
import { FormatConfig, DEFAULT_CONFIG } from './config';

export function format(source: string, config: Partial<FormatConfig> = {}): string {
    const fullConfig: FormatConfig = { ...DEFAULT_CONFIG, ...config };

    try {
        const ast = parse(source);

        if (ast.body.length === 0 && source.trim().length > 0) {
            console.warn('[Formatter] Parser returned empty AST - source may have syntax errors');
            return source;
        }

        const printer = new Printer(fullConfig);
        return printer.print(ast);
    } catch (error) {
        console.error('[Formatter] Parse error:', error);
        return source;
    }
}

export function isFormatted(source: string, config: Partial<FormatConfig> = {}): boolean {
    const formatted = format(source, config);
    return source === formatted;
}