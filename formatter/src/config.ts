export interface FormatConfig {
    indentSize: number;
    lineWidth: number;
    trailingComma: boolean;
    semicolons: boolean;
}

export const DEFAULT_CONFIG: FormatConfig = {
    indentSize: 2,
    lineWidth: 80,
    trailingComma: true,
    semicolons: false,
};

export function loadConfig(configPath?: string): FormatConfig {
    return { ...DEFAULT_CONFIG };
}