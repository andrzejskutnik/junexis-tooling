import { Token, TokenType, KEYWORDS, Position, SourceLocation } from "./token";

/**
 * Lexer for junexislang
 * Converts source code into a stream of tokens
 */
export class Lexer {
  private source: string;
  private position: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  /**
   * Tokenize the entire source code
   */
  public tokenize(): Token[] {
    this.tokens = [];

    while (!this.isAtEnd()) {
      this.skipWhitespace();

      if (this.isAtEnd()) {
        break;
      }

      const token = this.nextToken();
      if (token) {
        this.tokens.push(token);
      } else {
        // nextToken() returned null (EOF reached)
        break;
      }
    }

    // Add EOF token
    this.tokens.push(this.makeToken(TokenType.EOF, ""));

    return this.tokens;
  }

  /**
   * Get next token from source
   */
  private nextToken(): Token | null {
    const char = this.peek();

    // Comments (Phase 8.2)
    if (char === "/" && this.peekNext() === "/") {
      return this.readLineComment();
    }

    if (char === "/" && this.peekNext() === "*") {
      return this.readBlockComment();
    }

    // String literals
    if (char === '"' || char === "'") {
      return this.readString();
    }

    // Numbers
    if (this.isDigit(char)) {
      return this.readNumber();
    }

    // Identifiers and keywords
    if (this.isAlpha(char) || char === "_") {
      return this.readIdentifierOrKeyword();
    }

    // Platform annotations
    if (char === "@") {
      return this.readPlatformAnnotation();
    }

    // Operators and punctuation
    return this.readOperatorOrPunctuation();
  }

  /**
   * Read string literal (supports single-line "..." and multi-line """...""")
   */
  private readString(): Token {
    const start = this.currentPosition();
    const firstQuote = this.advance();

    // Check for triple-quote multi-line string
    if (firstQuote === '"' && this.peek() === '"' && this.peekNext() === '"') {
      this.advance(); // Second quote
      this.advance(); // Third quote
      return this.readMultiLineString(start);
    }

    // Single-line string
    let value = "";
    while (!this.isAtEnd() && this.peek() !== firstQuote) {
      if (this.peek() === "\\") {
        this.advance(); // Skip escape character
        value += this.advance();
      } else {
        value += this.advance();
      }
    }

    if (!this.isAtEnd()) {
      this.advance(); // Closing quote
    }

    return {
      type: TokenType.STRING,
      value: value,
      location: this.makeLocation(start),
    };
  }

  /**
   * Read multi-line string ("""...""")
   */
  private readMultiLineString(start: Position): Token {
    let value = "";

    // Read until we find closing """
    while (!this.isAtEnd()) {
      // Check for closing triple-quote
      if (
        this.peek() === '"' &&
        this.peekNext() === '"' &&
        this.position + 2 < this.source.length &&
        this.source[this.position + 2] === '"'
      ) {
        this.advance(); // First quote
        this.advance(); // Second quote
        this.advance(); // Third quote
        break;
      }

      const char = this.advance();

      // Track newlines inside multi-line strings
      if (char === "\n") {
        this.line++;
        this.column = 1;
      }

      value += char;
    }

    return {
      type: TokenType.STRING,
      value: value.trim(), // Trim leading/trailing whitespace for multi-line strings
      location: this.makeLocation(start),
    };
  }

  /**
   * Read number literal
   */
  private readNumber(): Token {
    const start = this.currentPosition();
    let value = "";

    while (
      !this.isAtEnd() &&
      (this.isDigit(this.peek()) || this.peek() === ".")
    ) {
      value += this.advance();
    }

    // Handle suffixes (f32, u64, duration units, etc.)
    let suffix = "";
    if (this.isAlpha(this.peek())) {
      while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
        suffix += this.advance();
      }
    }

    // Check if suffix is a duration unit (s, m, h, ms, ns, us)
    const durationUnits = ["s", "m", "h", "ms", "ns", "us"];
    if (durationUnits.includes(suffix)) {
      return {
        type: TokenType.DURATION,
        value: value + suffix, // Include unit in value (e.g., "5s")
        location: this.makeLocation(start),
      };
    }

    return {
      type: TokenType.NUMBER,
      value: value,
      location: this.makeLocation(start),
    };
  }

  /**
   * Read identifier or keyword
   */
  private readIdentifierOrKeyword(): Token {
    const start = this.currentPosition();
    let value = "";

    while (
      !this.isAtEnd() &&
      (this.isAlphaNumeric(this.peek()) || this.peek() === "_")
    ) {
      value += this.advance();
    }

    // Check if it's a keyword
    const tokenType = KEYWORDS.get(value) || TokenType.IDENTIFIER;

    return {
      type: tokenType,
      value: value,
      location: this.makeLocation(start),
    };
  }

  /**
   * Read platform annotation (@embedded, @server, etc.)
   */
  private readPlatformAnnotation(): Token {
    const start = this.currentPosition();
    let value = this.advance(); // @

    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    return {
      type: TokenType.PLATFORM_ANNOTATION,
      value: value,
      location: this.makeLocation(start),
    };
  }

  /**
   * Read operator or punctuation
   */
  private readOperatorOrPunctuation(): Token | null {
    const start = this.currentPosition();
    const char = this.advance(); // Two-character operators
    if (!this.isAtEnd()) {
      const next = this.peek();
      const twoChar = char + next;

      switch (twoChar) {
        case "->":
          this.advance();
          return this.makeToken(TokenType.ARROW, twoChar, start);
        case "=>":
          this.advance();
          return this.makeToken(TokenType.FAT_ARROW, twoChar, start);
        case "<-":
          this.advance();
          return this.makeToken(TokenType.LESS_ARROW, twoChar, start);
        case "==":
          this.advance();
          return this.makeToken(TokenType.EQUAL, twoChar, start);
        case "!=":
          this.advance();
          return this.makeToken(TokenType.NOT_EQUAL, twoChar, start);
        case "<=":
          this.advance();
          return this.makeToken(TokenType.LESS_EQUAL, twoChar, start);
        case ">=":
          this.advance();
          return this.makeToken(TokenType.GREATER_EQUAL, twoChar, start);
        case "||":
          this.advance();
          return this.makeToken(TokenType.DOUBLE_PIPE, twoChar, start);
        case "&&":
          this.advance();
          return this.makeToken(TokenType.DOUBLE_AMPERSAND, twoChar, start);
        case "::":
          this.advance();
          return this.makeToken(TokenType.DOUBLE_COLON, twoChar, start);
      }
    }

    // Single-character operators
    switch (char) {
      case "+":
        return this.makeToken(TokenType.PLUS, char, start);
      case "-":
        return this.makeToken(TokenType.MINUS, char, start);
      case "*":
        return this.makeToken(TokenType.STAR, char, start);
      case "/":
        return this.makeToken(TokenType.SLASH, char, start);
      case "%":
        return this.makeToken(TokenType.PERCENT, char, start);
      case "|":
        return this.makeToken(TokenType.PIPE, char, start);
      case "&":
        return this.makeToken(TokenType.AMPERSAND, char, start);
      case "!":
        return this.makeToken(TokenType.NOT, char, start);
      case "<":
        return this.makeToken(TokenType.LESS, char, start);
      case ">":
        return this.makeToken(TokenType.GREATER, char, start);
      case "(":
        return this.makeToken(TokenType.LPAREN, char, start);
      case ")":
        return this.makeToken(TokenType.RPAREN, char, start);
      case "{":
        return this.makeToken(TokenType.LBRACE, char, start);
      case "}":
        return this.makeToken(TokenType.RBRACE, char, start);
      case "[":
        return this.makeToken(TokenType.LBRACKET, char, start);
      case "]":
        return this.makeToken(TokenType.RBRACKET, char, start);
      case ",":
        return this.makeToken(TokenType.COMMA, char, start);
      case ";":
        return this.makeToken(TokenType.SEMICOLON, char, start);
      case ":":
        return this.makeToken(TokenType.COLON, char, start);
      case ".":
        return this.makeToken(TokenType.DOT, char, start);
      case "=":
        return this.makeToken(TokenType.ASSIGN, char, start);
      case "\0": // EOF null character
        return null; // Signal EOF to tokenize() loop
      default:
        return this.makeToken(TokenType.UNKNOWN, char, start);
    }
  }

  /**
   * Skip whitespace only (Phase 8.2 - comments are now tokens)
   */
  private skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const char = this.peek();

      // Whitespace
      if (char === " " || char === "\t" || char === "\r") {
        this.advance();
        continue;
      }

      // Newlines
      if (char === "\n") {
        this.advance();
        this.line++;
        this.column = 1;
        continue;
      }

      break;
    }
  }

  /**
   * Read line comment (// ...)
   * Phase 8.2 - Comments are now tokens
   */
  private readLineComment(): Token {
    const start = this.currentPosition();

    // Skip // prefix
    this.advance(); // /
    this.advance(); // /

    // Read comment content until end of line
    let content = "";
    while (!this.isAtEnd() && this.peek() !== "\n") {
      content += this.advance();
    }

    // Note: We don't consume the \n - it will be handled by skipWhitespace()

    return {
      type: TokenType.LINE_COMMENT,
      value: content,
      location: {
        start,
        end: this.currentPosition(),
      },
    };
  }

  /**
   * Read block comment
   * Phase 8.2 - Comments are now tokens
   */
  private readBlockComment(): Token {
    const start = this.currentPosition();

    // Skip /* or /** prefix
    this.advance(); // /
    this.advance(); // *

    // Check if this is a doc comment (/**)
    const isDocComment = this.peek() === "*" && this.peekNext() !== "/";
    if (isDocComment) {
      this.advance(); // Third * for doc comment
    }

    // Read comment content until */
    let content = "";
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance(); // *
        this.advance(); // /
        break;
      }

      if (this.peek() === "\n") {
        this.line++;
        this.column = 1;
      }

      content += this.advance();
    }

    return {
      type: isDocComment ? TokenType.DOC_COMMENT : TokenType.BLOCK_COMMENT,
      value: content,
      location: {
        start,
        end: this.currentPosition(),
      },
    };
  }

  /**
   * Character classification helpers
   */
  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }

  private isAlpha(char: string): boolean {
    return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }

  /**
   * Position tracking helpers
   */
  private peek(): string {
    if (this.isAtEnd()) {
      return "\0";
    }
    return this.source[this.position];
  }

  private peekNext(): string {
    if (this.position + 1 >= this.source.length) {
      return "\0";
    }
    return this.source[this.position + 1];
  }

  private advance(): string {
    if (this.isAtEnd()) {
      return "\0"; // Return null character at EOF instead of undefined
    }
    const char = this.source[this.position];
    this.position++;
    this.column++;
    return char;
  }

  private isAtEnd(): boolean {
    return this.position >= this.source.length;
  }

  private currentPosition(): Position {
    return {
      line: this.line,
      column: this.column,
      offset: this.position,
    };
  }

  private makeLocation(start: Position): SourceLocation {
    return {
      start: start,
      end: this.currentPosition(),
    };
  }

  private makeToken(type: TokenType, value: string, start?: Position): Token {
    return {
      type: type,
      value: value,
      location: this.makeLocation(start || this.currentPosition()),
    };
  }
}
