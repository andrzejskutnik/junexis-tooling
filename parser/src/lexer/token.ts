/**
 * Token types for junexislang lexer
 */
export enum TokenType {
  // Literals
  STRING = "STRING",
  NUMBER = "NUMBER",
  BOOLEAN = "BOOLEAN",
  DURATION = "DURATION", // 5s, 10m, 1h, etc.

  // Identifiers
  IDENTIFIER = "IDENTIFIER",

  // Keywords - Declarations
  TASK = "TASK",
  PIPELINE = "PIPELINE",
  SUPERVISOR = "SUPERVISOR",
  NARRATIVE = "NARRATIVE",
  DEVICE = "DEVICE",
  REFERENCE = "REFERENCE",
  TYPE = "TYPE",
  STRUCT = "STRUCT",
  ENUM = "ENUM",
  FN = "FN",
  DEPLOYMENT = "DEPLOYMENT",

  // Keywords - Control Flow
  IF = "IF",
  ELSE = "ELSE",
  WHILE = "WHILE",
  FOR = "FOR",
  LOOP = "LOOP",
  MATCH = "MATCH",
  RETURN = "RETURN",
  BREAK = "BREAK",
  CONTINUE = "CONTINUE",

  // Keywords - Communication
  CHAN = "CHAN",
  QUEUE = "QUEUE",
  SEND = "SEND",
  TO = "TO",
  RECEIVE = "RECEIVE",
  RESPOND = "RESPOND",
  BROADCAST = "BROADCAST",

  // Keywords - Resilience
  CIRCUIT_BREAKER = "CIRCUIT_BREAKER",
  RETRY = "RETRY",
  BULKHEAD = "BULKHEAD",
  RATE_LIMITER = "RATE_LIMITER",

  // Keywords - Composition
  USE = "USE",
  PARALLEL = "PARALLEL",
  BRANCH = "BRANCH",
  SUPERVISE = "SUPERVISE",
  ON = "ON",

  // Keywords - Variables
  LET = "LET",
  CONST = "CONST",
  VAR = "VAR",
  STATE = "STATE",

  // Keywords - Imports
  IMPORT = "IMPORT",
  FROM = "FROM",
  AS = "AS",

  // Operators
  PLUS = "PLUS", // +
  MINUS = "MINUS", // -
  STAR = "STAR", // *
  SLASH = "SLASH", // /
  PERCENT = "PERCENT", // %
  ARROW = "ARROW", // ->
  FAT_ARROW = "FAT_ARROW", // =>
  PIPE = "PIPE", // |
  DOUBLE_PIPE = "DOUBLE_PIPE", // ||
  AMPERSAND = "AMPERSAND", // &
  DOUBLE_AMPERSAND = "DOUBLE_AMPERSAND", // &&
  NOT = "NOT", // not, !
  LESS_ARROW = "LESS_ARROW", // <-

  // Comparison
  EQUAL = "EQUAL", // ==
  NOT_EQUAL = "NOT_EQUAL", // !=
  LESS = "LESS", // <
  LESS_EQUAL = "LESS_EQUAL", // <=
  GREATER = "GREATER", // >
  GREATER_EQUAL = "GREATER_EQUAL", // >=

  // Delimiters
  LPAREN = "LPAREN", // (
  RPAREN = "RPAREN", // )
  LBRACE = "LBRACE", // {
  RBRACE = "RBRACE", // }
  LBRACKET = "LBRACKET", // [
  RBRACKET = "RBRACKET", // ]
  COMMA = "COMMA", // ,
  SEMICOLON = "SEMICOLON", // ;
  COLON = "COLON", // :
  DOT = "DOT", // .
  DOUBLE_COLON = "DOUBLE_COLON", // ::
  ASSIGN = "ASSIGN", // =

  // Platform Annotations
  AT = "AT", // @
  PLATFORM_ANNOTATION = "PLATFORM_ANNOTATION", // @embedded, @server, @report

  // Comments (Phase 8.2)
  LINE_COMMENT = "LINE_COMMENT", // // ...
  BLOCK_COMMENT = "BLOCK_COMMENT", // /* ... */
  DOC_COMMENT = "DOC_COMMENT", // /** ... */

  // Special
  NEWLINE = "NEWLINE",
  EOF = "EOF",
  UNKNOWN = "UNKNOWN",
}

/**
 * Position in source code
 */
export interface Position {
  line: number;
  column: number;
  offset: number;
}

/**
 * Source location range
 */
export interface SourceLocation {
  start: Position;
  end: Position;
}

/**
 * Token with type, value, and location
 */
export interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}

/**
 * Keywords map for quick lookup
 */
export const KEYWORDS: Map<string, TokenType> = new Map([
  // Declarations
  ["task", TokenType.TASK],
  ["pipeline", TokenType.PIPELINE],
  ["supervisor", TokenType.SUPERVISOR],
  ["narrative", TokenType.NARRATIVE],
  ["device", TokenType.DEVICE],
  ["reference", TokenType.REFERENCE],
  ["type", TokenType.TYPE],
  ["struct", TokenType.STRUCT],
  ["enum", TokenType.ENUM],
  ["fn", TokenType.FN],
  ["deployment", TokenType.DEPLOYMENT],

  // Control Flow
  ["if", TokenType.IF],
  ["else", TokenType.ELSE],
  ["while", TokenType.WHILE],
  ["for", TokenType.FOR],
  ["loop", TokenType.LOOP],
  ["match", TokenType.MATCH],
  ["return", TokenType.RETURN],
  ["break", TokenType.BREAK],
  ["continue", TokenType.CONTINUE],

  // Communication
  ["chan", TokenType.CHAN],
  ["queue", TokenType.QUEUE],
  ["send", TokenType.SEND],
  ["to", TokenType.TO],
  ["receive", TokenType.RECEIVE],
  ["respond", TokenType.RESPOND],
  ["broadcast", TokenType.BROADCAST],

  // Resilience
  ["circuit_breaker", TokenType.CIRCUIT_BREAKER],
  ["retry", TokenType.RETRY],
  ["bulkhead", TokenType.BULKHEAD],
  ["rate_limiter", TokenType.RATE_LIMITER],

  // Composition
  ["use", TokenType.USE],
  ["parallel", TokenType.PARALLEL],
  ["branch", TokenType.BRANCH],
  ["supervise", TokenType.SUPERVISE],
  ["on", TokenType.ON],

  // Variables
  ["let", TokenType.LET],
  ["const", TokenType.CONST],
  ["var", TokenType.VAR],
  ["state", TokenType.STATE],

  // Imports
  ["import", TokenType.IMPORT],
  ["from", TokenType.FROM],
  ["as", TokenType.AS],

  // Logical operators — keyword and symbolic forms share semantics
  ["or", TokenType.DOUBLE_PIPE],
  ["and", TokenType.DOUBLE_AMPERSAND],
  ["not", TokenType.NOT],

  // Boolean literals
  ["true", TokenType.BOOLEAN],
  ["false", TokenType.BOOLEAN],
]);
