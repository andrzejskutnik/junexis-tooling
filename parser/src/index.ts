// Export lexer
export { Lexer } from './lexer/lexer';
export { Token, TokenType, Position, SourceLocation } from './lexer/token';

// Export AST nodes
export * from './ast/nodes';

// Export parser
export { Parser } from './parser/parser';
import { Parser } from './parser/parser';

/**
 * Convenience function to parse junexislang source code
 */
export function parse(source: string) {
    const parser = new Parser(source);
    return parser.parse();
}
