import { Token, TokenType, SourceLocation } from "../lexer/token";
import { Lexer } from "../lexer/lexer";
import {
  Program,
  Declaration,
  TaskDeclaration,
  TypeDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  PipelineDeclaration,
  PipelineStage,
  SupervisorDeclaration,
  DeploymentDeclaration,
  NarrativeDeclaration,
  DeviceDeclaration,
  Identifier,
  BlockStatement,
  Statement,
  LetStatement,
  IfStatement,
  ReturnStatement,
  ExpressionStatement,
  Expression,
  Parameter,
  TypeReference,
  PlatformAnnotation,
  BinaryExpression,
  UnaryExpression,
  ObjectExpression,
  ObjectProperty,
  ArrayExpression,
} from "../ast/nodes";

/**
 * Operator precedence levels for Pratt parser
 */
enum Precedence {
  NONE = 0,
  ASSIGNMENT = 1, // =
  OR = 2, // ||
  AND = 3, // &&
  EQUALITY = 4, // == !=
  COMPARISON = 5, // < > <= >=
  TERM = 6, // + -
  FACTOR = 7, // * / %
  UNARY = 8, // ! - +
  CALL = 9, // . () []
  PRIMARY = 10,
}

/**
 * Parser for junexislang
 * Implements recursive descent parsing
 */
export class Parser {
  private tokens: Token[] = [];
  private current: number = 0;
  private lastConsumedTokenIndex: number = -1; // Phase 8.2: Track boundary for comment collection
  private consumedTrailingCommentIndices: Set<number> = new Set(); // Phase 8.2: Track trailing comments to exclude from leading

  constructor(source: string) {
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
  }

  /**
   * Parse the entire program
   */
  public parse(): Program {
    const declarations: Declaration[] = [];

    // Collect file header comments (Phase 8.2)
    // All comments before first keyword token
    const fileHeaderComments: import("../ast/nodes").Comment[] = [];

    while (this.current < this.tokens.length) {
      const token = this.tokens[this.current];

      if (
        token.type === TokenType.LINE_COMMENT ||
        token.type === TokenType.BLOCK_COMMENT ||
        token.type === TokenType.DOC_COMMENT
      ) {
        fileHeaderComments.push(this.tokenToComment(token));
        this.consumedTrailingCommentIndices.add(this.current); // Mark as consumed
        this.current++;
      } else if (token.type === TokenType.NEWLINE) {
        this.current++; // Skip newlines
      } else {
        // Hit first keyword - stop collecting file header
        break;
      }
    }

    // Update boundary after file header collection
    this.lastConsumedTokenIndex = this.current - 1;

    while (!this.isAtEnd()) {
      const decl = this.parseDeclaration();
      if (decl) {
        declarations.push(decl);
      }
    }

    return {
      type: "Program",
      body: declarations,
      location: this.makeLocation(0, this.current),
      leadingComments:
        fileHeaderComments.length > 0 ? fileHeaderComments : undefined,
    };
  }

  /**
   * Collect leading comments (Phase 8.2 - IMPROVED)
   * Collects comment tokens between lastConsumedTokenIndex and current position
   * Excludes comments already used as trailing comments
   */
  private collectLeadingComments(): import("../ast/nodes").Comment[] {
    const comments: import("../ast/nodes").Comment[] = [];

    // Start from the token AFTER lastConsumedTokenIndex
    const startIndex = this.lastConsumedTokenIndex + 1;
    const endIndex = this.current - 1;

    // Scan forward from boundary to current position
    for (let i = startIndex; i <= endIndex; i++) {
      const token = this.tokens[i];

      // Skip if already consumed as trailing comment
      if (this.consumedTrailingCommentIndices.has(i)) {
        continue;
      }

      if (
        token.type === TokenType.LINE_COMMENT ||
        token.type === TokenType.BLOCK_COMMENT ||
        token.type === TokenType.DOC_COMMENT
      ) {
        comments.push(this.tokenToComment(token));
      }
      // Skip newlines and other whitespace tokens
    }

    return comments;
  }

  /**
   * Collect trailing comments (Phase 8.2)
   * Collects comments on the SAME LINE as previous token
   * Marks them as consumed to prevent re-collection as leading comments
   */
  private collectTrailingComments(): import("../ast/nodes").Comment[] {
    const comments: import("../ast/nodes").Comment[] = [];

    // Look forward from current position for comments on same line
    const prevToken = this.previous();
    if (!prevToken) return comments;

    const prevLine = prevToken.location.end.line;

    let i = this.current;
    while (i < this.tokens.length) {
      const token = this.tokens[i];

      // Stop if we hit a newline or different line
      if (token.location.start.line !== prevLine) {
        break;
      }

      if (
        token.type === TokenType.LINE_COMMENT ||
        token.type === TokenType.BLOCK_COMMENT ||
        token.type === TokenType.DOC_COMMENT
      ) {
        comments.push(this.tokenToComment(token));
        this.consumedTrailingCommentIndices.add(i); // Mark as consumed (Phase 8.2)
        i++;
      } else if (
        token.type === TokenType.NEWLINE ||
        token.type === TokenType.EOF
      ) {
        break;
      } else {
        i++;
      }
    }

    return comments;
  }

  /**
   * Convert Token to Comment AST node (Phase 8.2)
   */
  private tokenToComment(token: Token): import("../ast/nodes").Comment {
    let type: import("../ast/nodes").CommentType;
    let raw: string;

    if (token.type === TokenType.LINE_COMMENT) {
      type = "LineComment";
      raw = "//" + token.value;
    } else if (token.type === TokenType.DOC_COMMENT) {
      type = "DocComment";
      raw = "/**" + token.value + "*/";
    } else {
      type = "BlockComment";
      raw = "/*" + token.value + "*/";
    }

    return {
      type,
      content: token.value,
      raw,
      location: token.location,
    };
  }

  /**
   * Parse top-level declaration
   */
  private parseDeclaration(): Declaration | null {
    try {
      // Collect leading comments BEFORE parsing declaration (Phase 8.2)
      const leadingComments = this.collectLeadingComments();

      let decl: Declaration | null = null;

      // Task declaration
      if (this.match(TokenType.TASK)) {
        decl = this.parseTaskDeclaration();
      }
      // Type declaration
      else if (this.match(TokenType.TYPE)) {
        decl = this.parseTypeDeclaration();
      }
      // Enum declaration
      else if (this.match(TokenType.ENUM)) {
        decl = this.parseEnumDeclaration();
      }
      // Function declaration
      else if (this.match(TokenType.FN)) {
        decl = this.parseFunctionDeclaration();
      }
      // Pipeline declaration
      else if (this.match(TokenType.PIPELINE)) {
        decl = this.parsePipelineDeclaration();
      }
      // Supervisor declaration
      else if (this.match(TokenType.SUPERVISOR)) {
        decl = this.parseSupervisorDeclaration();
      }
      // Deployment declaration
      else if (this.match(TokenType.DEPLOYMENT)) {
        decl = this.parseDeploymentDeclaration();
      }
      // Narrative declaration
      else if (this.match(TokenType.NARRATIVE)) {
        decl = this.parseNarrativeDeclaration();
      }
      // Device declaration
      else if (this.match(TokenType.DEVICE)) {
        decl = this.parseDeviceDeclaration();
      }
      // Unknown declaration - skip and continue
      else {
        this.advance();
        return null;
      }

      // Attach comments to declaration (Phase 8.2)
      if (decl && leadingComments.length > 0) {
        decl.leadingComments = leadingComments;
      }

      // Collect trailing comments (Phase 8.2)
      if (decl) {
        const trailingComments = this.collectTrailingComments();
        if (trailingComments.length > 0) {
          decl.trailingComments = trailingComments;
        }
      }

      // Update boundary for next comment collection (Phase 8.2)
      this.lastConsumedTokenIndex = this.current - 1;

      return decl;
    } catch (error) {
      // Error recovery: skip to next declaration
      // Log error for debugging (can be removed in production)
      if (error instanceof Error) {
        console.error(
          `[Parser] Error in parseDeclaration at line ${
            this.peek().location.start.line
          }:`,
          error.message
        );
      }
      this.synchronize();
      return null;
    }
  }

  /**
   * Parse task declaration
   * task Name(params) @platform -> ReturnType { ... }
   */
  private parseTaskDeclaration(): TaskDeclaration {
    const start = this.previous();

    // Task name
    const name = this.parseIdentifier();

    // Parameters
    this.consume(TokenType.LPAREN, "Expected '(' after task name");
    const parameters = this.parseParameterList();
    this.consume(TokenType.RPAREN, "Expected ')' after parameters");

    // Platform annotation (optional)
    let platformAnnotation: PlatformAnnotation | undefined;
    if (this.check(TokenType.PLATFORM_ANNOTATION)) {
      platformAnnotation = this.parsePlatformAnnotation();
    }

    // Allow newline(s) after platform annotation
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }

    // Return type
    let returnType: TypeReference | undefined;
    if (this.match(TokenType.ARROW)) {
      returnType = this.parseTypeReference();
    }

    // Body (allow newline(s) before body)
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }

    // PHASE 8.1.5: Parse structured TaskBody if contains config/lifecycle
    const body = this.parseTaskBody();

    return {
      type: "TaskDeclaration",
      name,
      parameters,
      platformAnnotation,
      returnType,
      body,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse task body (structured: config + lifecycle + statements)
   * PHASE 8.1.5: Replaces generic BlockStatement parsing
   */
  private parseTaskBody(): import("../ast/nodes").TaskBody | BlockStatement {
    const start = this.peek();
    this.consume(TokenType.LBRACE, "Expected '{'");

    let config: import("../ast/nodes").ConfigBlock | undefined;
    const lifecycle: import("../ast/nodes").LifecycleHook[] = [];
    const statements: Statement[] = [];

    // Parse body content: config, lifecycle hooks, then statements
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Skip newlines
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }

      if (this.check(TokenType.RBRACE)) break;

      // Check for special keywords: config, on_*
      if (this.check(TokenType.IDENTIFIER)) {
        const keyword = this.peek().value;

        if (keyword === "config" && !config) {
          this.advance(); // consume 'config'
          config = this.parseConfigBlock();
          continue;
        }

        if (keyword.startsWith("on_") && keyword.length > 3) {
          this.advance(); // consume 'on_*'
          lifecycle.push(this.parseLifecycleHook(keyword));
          continue;
        }
      }

      // Otherwise, parse regular statement
      const posBeforeStatement = this.current;
      try {
        statements.push(this.parseStatement());
      } catch (e) {
        // Recovery: skip to next statement
        while (
          !this.isAtEnd() &&
          !this.check(TokenType.SEMICOLON) &&
          !this.check(TokenType.RBRACE) &&
          !this.check(TokenType.NEWLINE)
        ) {
          this.advance();
        }
        if (this.check(TokenType.SEMICOLON)) {
          this.advance();
        }
      }

      // Safety: prevent infinite loop if parser didn't advance
      if (
        this.current === posBeforeStatement &&
        !this.check(TokenType.RBRACE)
      ) {
        console.error(
          `[Parser] Stuck at token: ${this.peek().type} (line ${
            this.peek().location.start.line
          })`
        );
        this.advance(); // Force advance to break loop
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    // If task has config or lifecycle, return TaskBody; otherwise BlockStatement
    if (config || lifecycle.length > 0) {
      return {
        type: "TaskBody",
        config,
        lifecycle,
        statements,
        location: this.makeLocationFromStartToken(start),
      };
    } else {
      // Fallback to BlockStatement for backward compatibility
      return {
        type: "BlockStatement",
        statements,
        location: this.makeLocationFromStartToken(start),
      };
    }
  }

  /**
   * Parse type declaration
   * type Name = OtherType or type Name { fields }
   */
  private parseTypeDeclaration(): TypeDeclaration {
    const start = this.previous();

    // Type name
    const name = this.parseIdentifier();

    let definition: TypeReference;

    // Check for struct-style definition
    if (this.check(TokenType.LBRACE)) {
      definition = this.parseStructType();
    } else {
      // Type alias
      this.consume(TokenType.ASSIGN, "Expected '=' or '{' after type name");
      definition = this.parseTypeReference();
      this.match(TokenType.SEMICOLON); // Optional semicolon
    }

    return {
      type: "TypeDeclaration",
      name,
      definition,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse enum declaration
   * enum Name { Variant1, Variant2 }
   */
  private parseEnumDeclaration(): EnumDeclaration {
    const start = this.previous();

    // Enum name
    const name = this.parseIdentifier();

    // Variants
    this.consume(TokenType.LBRACE, "Expected '{' after enum name");
    const variants = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const variantName = this.parseIdentifier();
      variants.push({
        type: "EnumVariant" as const,
        name: variantName,
        location: variantName.location,
      });

      if (!this.match(TokenType.COMMA)) {
        break;
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after enum variants");

    return {
      type: "EnumDeclaration",
      name,
      variants,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse function declaration
   * fn name(params) -> ReturnType { ... }
   */
  private parseFunctionDeclaration(): FunctionDeclaration {
    const start = this.previous();

    // Function name
    const name = this.parseIdentifier();

    // Parameters
    this.consume(TokenType.LPAREN, "Expected '(' after function name");
    const parameters = this.parseParameterList();
    this.consume(TokenType.RPAREN, "Expected ')' after parameters");

    // Return type
    this.consume(TokenType.ARROW, "Expected '->' before return type");
    const returnType = this.parseTypeReference();

    // Body
    const body = this.parseBlockStatement();

    return {
      type: "FunctionDeclaration",
      name,
      parameters,
      returnType,
      body,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse pipeline declaration (stub for now)
   */
  private parsePipelineDeclaration(): PipelineDeclaration {
    const start = this.previous();
    const name = this.parseIdentifier();

    this.consume(TokenType.LBRACE, "Expected '{' after pipeline name");

    const stages: PipelineStage[] = [];

    // Parse pipeline stages (use Task -> Task; or use Task;)
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Parse "use TaskName -> TaskName;" or "use TaskName;"
      if (this.match(TokenType.USE)) {
        const stageStart = this.previous();
        const target = this.parseIdentifier();

        // Check for optional "-> output"
        // For now, we skip the arrow and output (parser doesn't store output in AST)
        if (this.match(TokenType.ARROW)) {
          this.advance(); // Skip output identifier
          // Check for .field access (e.g., BroadcastToClients.processed)
          if (this.match(TokenType.DOT)) {
            this.advance(); // Skip field name
          }
        }

        this.consume(TokenType.SEMICOLON, "Expected ';' after pipeline stage");

        stages.push({
          type: "PipelineStage",
          kind: "use",
          target,
          location: this.makeLocationFromToken(stageStart),
        });
      } else {
        // Unknown token - skip to next semicolon or closing brace
        this.advance();
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after pipeline stages");

    return {
      type: "PipelineDeclaration",
      name,
      stages,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse supervisor declaration (stub for now)
   */
  private parseSupervisorDeclaration(): SupervisorDeclaration {
    const start = this.previous();
    const name = this.parseIdentifier();

    // For now, just consume the block
    this.consume(TokenType.LBRACE, "Expected '{' after supervisor name");
    let depth = 1;
    while (depth > 0 && !this.isAtEnd()) {
      if (this.check(TokenType.LBRACE)) depth++;
      if (this.check(TokenType.RBRACE)) depth--;
      this.advance();
    }

    return {
      type: "SupervisorDeclaration",
      name,
      strategy: "one_for_one",
      children: [],
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse deployment declaration
   */
  private parseDeploymentDeclaration(): DeploymentDeclaration {
    const start = this.previous();

    // Parse deployment config block
    // Allow optional name before the opening brace: `deployment Name { ... }`
    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.STRING)) {
      this.advance();
    }
    this.consume(TokenType.LBRACE, "Expected '{' after 'deployment'");

    const config: Record<string, any> = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Handle simple key: value entries
      if (this.check(TokenType.IDENTIFIER)) {
        const keyTok = this.advance();
        if (this.check(TokenType.COLON)) {
          this.advance(); // consume ':'
          const value = this.parseConfigValue();
          config[keyTok.value] = value;
          this.match(TokenType.SEMICOLON); // Optional semicolon
          continue;
        }

        // Not a key:value – tolerate known patterns like `target @platform { ... }`
        // Try to skip until a block and then skip the block contents.
        if (this.check(TokenType.LBRACE)) {
          this.skipBlock();
          continue;
        }
        // Scan forward to next block or terminator
        while (
          !this.check(TokenType.LBRACE) &&
          !this.check(TokenType.SEMICOLON) &&
          !this.check(TokenType.RBRACE) &&
          !this.isAtEnd()
        ) {
          this.advance();
        }
        if (this.check(TokenType.LBRACE)) {
          this.skipBlock();
        } else {
          this.match(TokenType.SEMICOLON);
        }
      } else if (this.check(TokenType.LBRACE)) {
        // Unexpected bare block – skip it defensively
        this.skipBlock();
      } else {
        // Fallback: advance to avoid infinite loop
        this.advance();
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after deployment config");

    return {
      type: "DeploymentDeclaration",
      config,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse narrative declaration
   *
   * Example:
   * narrative "E-commerce Transaction" {
   *   intent "ensure atomic payment"
   *   scope "payment domain"
   *   compliance "PCI-DSS", "GDPR"
   *   applies_to { ProcessOrder, RefundOrder }
   *   trace full
   *   priority high
   * }
   */
  private parseNarrativeDeclaration(): NarrativeDeclaration {
    const start = this.previous();

    // Parse narrative name (string literal)
    const name = this.consume(
      TokenType.STRING,
      "Expected narrative name (string literal)"
    );

    this.consume(TokenType.LBRACE, "Expected '{' after narrative name");

    let intent: Token[] = [];
    let scope: Token | undefined;
    const compliance: Token[] = [];
    const appliesTo: any[] = [];
    let trace: string | undefined;
    let priority: string | undefined;
    let retention: Token | undefined;
    let stakeholders: any = undefined;
    let value_proposition: Token[] = [];
    let story_flow: Token[] = [];
    let degraded_semantics: any = undefined;

    // Parse narrative body attributes
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      if (this.check(TokenType.IDENTIFIER)) {
        const attrName = this.advance().value;

        switch (attrName) {
          case "intent":
            // Parse intent as array of strings: ["line 1", "line 2"]
            this.consume(TokenType.LBRACKET, "Expected '[' after 'intent'");
            while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
              const line = this.consume(
                TokenType.STRING,
                "Expected string in intent array"
              );
              intent.push(line);
              this.match(TokenType.COMMA); // Optional comma
            }
            this.consume(TokenType.RBRACKET, "Expected ']' after intent array");
            break;

          case "scope":
            scope = this.consume(
              TokenType.STRING,
              "Expected string after 'scope'"
            );
            break;

          case "compliance":
            // Parse compliance - dual mode: array of strings OR object
            if (this.check(TokenType.LBRACE)) {
              // Object mode: compliance { key: "value", ... }
              compliance.push(this.parseObjectLiteral());
            } else {
              // Array mode: compliance "PCI-DSS", "GDPR"
              do {
                const comp = this.consume(
                  TokenType.STRING,
                  "Expected compliance string"
                );
                compliance.push(comp);
              } while (this.match(TokenType.COMMA));
            }
            break;

          case "applies_to":
            // Parse applies_to { tasks: [...], events: "...", metrics: "..." }
            this.consume(TokenType.LBRACE, "Expected '{' after 'applies_to'");

            const appliesToData: any = {
              type: "NarrativeAppliesTo",
              tasks: undefined,
              events: undefined,
              metrics: undefined,
              location: this.makeLocationFromToken(this.previous()),
            };

            while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
              if (this.check(TokenType.IDENTIFIER)) {
                const field = this.advance().value;
                this.consume(TokenType.COLON, `Expected ':' after '${field}'`);

                if (field === "tasks") {
                  // Parse tasks: [TaskName, TaskName, ...]
                  this.consume(
                    TokenType.LBRACKET,
                    "Expected '[' after 'tasks:'"
                  );
                  const tasks: any[] = [];
                  while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
                    if (this.check(TokenType.IDENTIFIER)) {
                      const taskName = this.advance();
                      tasks.push({
                        type: "Identifier",
                        name: taskName.value,
                        location: taskName.location,
                      });
                    }
                    this.match(TokenType.COMMA);
                  }
                  this.consume(
                    TokenType.RBRACKET,
                    "Expected ']' after tasks list"
                  );
                  appliesToData.tasks = tasks;
                } else if (field === "events" || field === "metrics") {
                  // Parse events/metrics as string literal
                  const value = this.consume(
                    TokenType.STRING,
                    `Expected string after '${field}:'`
                  );
                  if (field === "events") {
                    appliesToData.events = {
                      type: "Literal",
                      value: value.value,
                      location: value.location,
                    };
                  } else {
                    appliesToData.metrics = {
                      type: "Literal",
                      value: value.value,
                      location: value.location,
                    };
                  }
                }
              }
              this.match(TokenType.COMMA); // Optional comma
            }

            this.consume(
              TokenType.RBRACE,
              "Expected '}' after applies_to block"
            );
            appliesTo.push(appliesToData);
            break;

          case "trace":
            // Parse trace policy: minimal | standard | full
            if (this.check(TokenType.IDENTIFIER)) {
              trace = this.advance().value;
            }
            break;

          case "priority":
            // Parse priority: low | normal | high | critical
            if (this.check(TokenType.IDENTIFIER)) {
              priority = this.advance().value;
            }
            break;

          case "retention":
            retention = this.consume(
              TokenType.STRING,
              "Expected string after 'retention'"
            );
            break;

          case "stakeholders":
            // Parse stakeholders { key: "value", ... }
            stakeholders = this.parseObjectLiteral();
            break;

          case "value_proposition":
            // Parse value_proposition as array of strings
            this.consume(
              TokenType.LBRACKET,
              "Expected '[' after 'value_proposition'"
            );
            while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
              const line = this.consume(
                TokenType.STRING,
                "Expected string in value_proposition array"
              );
              value_proposition.push(line);
              this.match(TokenType.COMMA);
            }
            this.consume(
              TokenType.RBRACKET,
              "Expected ']' after value_proposition array"
            );
            break;

          case "story_flow":
            // Parse story_flow as array of strings
            this.consume(TokenType.LBRACKET, "Expected '[' after 'story_flow'");
            while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
              const line = this.consume(
                TokenType.STRING,
                "Expected string in story_flow array"
              );
              story_flow.push(line);
              this.match(TokenType.COMMA);
            }
            this.consume(
              TokenType.RBRACKET,
              "Expected ']' after story_flow array"
            );
            break;

          case "degraded_semantics":
            // For now, skip the block (full parsing requires conditional logic)
            degraded_semantics = this.skipBlock();
            break;

          default:
            // Unknown attribute - skip
            this.advance();
        }

        this.match(TokenType.SEMICOLON); // Optional semicolon
      } else {
        this.advance(); // Skip unexpected tokens
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after narrative body");

    return {
      type: "NarrativeDeclaration",
      name: {
        type: "Literal",
        value: name.value,
        raw: name.value,
        location: name.location,
      },
      intent:
        intent.length > 0
          ? intent.map((t) => ({
              type: "Literal",
              value: t.value,
              raw: t.value,
              location: t.location,
            }))
          : undefined,
      scope: scope
        ? {
            type: "Literal",
            value: scope.value,
            raw: scope.value,
            location: scope.location,
          }
        : undefined,
      compliance:
        compliance.length > 0
          ? compliance.map((c) => ({
              type: "Literal",
              value: c.value,
              raw: c.value,
              location: c.location,
            }))
          : undefined,
      appliesTo: appliesTo.length > 0 ? appliesTo[0] : undefined,
      trace: trace as any, // Simplified - proper validation would check against TracePolicy
      priority: priority as any, // Simplified - proper validation would check against Priority
      retention: retention
        ? {
            type: "Literal",
            value: retention.value,
            raw: retention.value,
            location: retention.location,
          }
        : undefined,
      stakeholders: stakeholders,
      value_proposition:
        value_proposition.length > 0
          ? value_proposition.map((t) => ({
              type: "Literal",
              value: t.value,
              raw: t.value,
              location: t.location,
            }))
          : undefined,
      story_flow:
        story_flow.length > 0
          ? story_flow.map((t) => ({
              type: "Literal",
              value: t.value,
              raw: t.value,
              location: t.location,
            }))
          : undefined,
      degraded_semantics: degraded_semantics,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse device declaration
   * device "sensor_kitchen" @embedded(esp32_c3) {
   *   ip: "192.168.1.22",
   *   sensors: ["temperature", "humidity"]
   * }
   */
  private parseDeviceDeclaration(): DeviceDeclaration {
    const start = this.previous();

    // Parse device name (identifier, like type/task/enum)
    const name = this.parseIdentifier();

    // Parse optional platform annotation
    let platformAnnotation: PlatformAnnotation | undefined;
    if (this.check(TokenType.PLATFORM_ANNOTATION)) {
      platformAnnotation = this.parsePlatformAnnotation();
    }

    // Parse device body (properties, lifecycle, hardware blocks, reference)
    let body: any | undefined = undefined;
    if (this.check(TokenType.LBRACE)) {
      try {
        body = this.parseDeviceBody();
      } catch (err) {
        // If parsing fails, use skipBlock as fallback
        console.error(
          `[parseDeviceDeclaration] Error parsing body for device at line ${
            this.peek().location.start.line
          }:`,
          (err as Error).message
        );
        this.skipBlock();
        body = {
          type: "SkippedBlock",
          error: (err as Error).message,
        };
      }
    }

    return {
      type: "DeviceDeclaration",
      name: name, // name is already an Identifier node
      platformAnnotation,
      body: body, // Changed from config to body (matches AST structure)
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse config value (simplified - just consume until semicolon or closing brace)
   */
  private parseConfigValue(): any {
    // Handle object literals
    if (this.check(TokenType.LBRACE)) {
      this.advance();
      const obj: Record<string, any> = {};

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        if (this.check(TokenType.IDENTIFIER)) {
          const key = this.advance().value;
          this.consume(TokenType.COLON, "Expected ':' after key");
          const value = this.parseSimpleValue();
          obj[key] = value;
          this.match(TokenType.COMMA);
        } else {
          this.advance();
        }
      }

      this.consume(TokenType.RBRACE, "Expected '}'");
      return obj;
    }

    return this.parseSimpleValue();
  }

  /**
   * Parse simple value (string, number, identifier)
   */
  private parseSimpleValue(): any {
    if (this.check(TokenType.STRING)) {
      return this.advance().value;
    }
    if (this.check(TokenType.NUMBER)) {
      return this.advance().value;
    }
    if (this.check(TokenType.IDENTIFIER)) {
      return this.advance().value;
    }
    return null;
  }

  /**
   * Parse parameter list
   */
  private parseParameterList(): Parameter[] {
    const parameters: Parameter[] = [];

    if (this.check(TokenType.RPAREN)) {
      return parameters;
    }

    do {
      const name = this.parseIdentifier();
      this.consume(TokenType.COLON, "Expected ':' after parameter name");
      const paramType = this.parseTypeReference();

      parameters.push({
        type: "Parameter",
        name,
        paramType,
        location: name.location,
      });
    } while (this.match(TokenType.COMMA));

    return parameters;
  }

  /**
   * Parse type reference
   */
  private parseTypeReference(): TypeReference {
    const start = this.peek();

    // Array type: [T]
    if (this.match(TokenType.LBRACKET)) {
      const elementType = this.parseTypeReference();
      this.consume(TokenType.RBRACKET, "Expected ']' after array element type");

      return {
        type: "ArrayType",
        elementType,
        location: this.makeLocationFromStartToken(start),
      };
    }

    // Channel type: chan<T>
    if (this.match(TokenType.CHAN)) {
      this.consume(TokenType.LESS, "Expected '<' after 'chan'");
      const elementType = this.parseTypeReference();
      this.consume(
        TokenType.GREATER,
        "Expected '>' after channel element type"
      );

      return {
        type: "ChannelType",
        elementType,
        location: this.makeLocationFromStartToken(start),
      };
    }

    // Queue type: queue<T>
    if (this.match(TokenType.QUEUE)) {
      this.consume(TokenType.LESS, "Expected '<' after 'queue'");
      const elementType = this.parseTypeReference();
      this.consume(TokenType.GREATER, "Expected '>' after queue element type");

      return {
        type: "QueueType",
        elementType,
        location: this.makeLocationFromStartToken(start),
      };
    }

    // Simple type or generic
    const name = this.parseIdentifier();

    // Check for generic type: Type<T>
    if (this.match(TokenType.LESS)) {
      const typeArguments: TypeReference[] = [];

      do {
        typeArguments.push(this.parseTypeReference());
      } while (this.match(TokenType.COMMA));

      this.consume(
        TokenType.GREATER,
        "Expected '>' after generic type arguments"
      );

      return {
        type: "GenericType",
        base: name,
        typeArguments,
        location: this.makeLocationFromStartToken(start),
      };
    }

    // Simple type
    return {
      type: "SimpleType",
      name,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse struct type (for type declarations)
   */
  private parseStructType(): TypeReference {
    const start = this.peek();
    this.consume(TokenType.LBRACE, "Expected '{'");

    const fields = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const fieldName = this.parseIdentifier();
      this.consume(TokenType.COLON, "Expected ':' after field name");
      const fieldType = this.parseTypeReference();

      fields.push({
        type: "StructField" as const,
        name: fieldName,
        fieldType,
        location: fieldName.location,
      });

      this.match(TokenType.COMMA); // Optional comma
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return {
      type: "StructType",
      fields,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse platform annotation
   */
  private parsePlatformAnnotation(): PlatformAnnotation {
    const token = this.advance();
    const platform = token.value.substring(1); // Remove @ prefix

    let config: Record<string, Expression> | string | undefined;

    // Optional configuration: @embedded(cores = 1, memory = "64KB") OR @embedded("device_name") OR @embedded(device_id)
    if (this.match(TokenType.LPAREN)) {
      // Skip newlines and commas
      while (this.check(TokenType.NEWLINE) || this.check(TokenType.COMMA)) {
        this.advance();
      }

      // Single string literal name: @embedded("device")
      if (this.check(TokenType.STRING)) {
        const deviceName = this.advance();
        this.consume(TokenType.RPAREN, "Expected ')' after device name");
        config = deviceName.value;
      }
      // Identifier could be either a single name or start of key=value
      else if (this.check(TokenType.IDENTIFIER)) {
        const lookahead = this.tokens[this.current + 1];
        if (lookahead && lookahead.type === TokenType.ASSIGN) {
          // Key-value list
          config = {};
          while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
            // Skip separators
            if (this.check(TokenType.COMMA) || this.check(TokenType.NEWLINE)) {
              this.advance();
              continue;
            }

            const keyTok = this.consume(
              TokenType.IDENTIFIER,
              "Expected identifier as config key"
            );
            this.consume(TokenType.ASSIGN, "Expected '=' after config key");
            const value = this.parsePrimaryExpression();
            (config as any)[keyTok.value] = value;
          }
          this.consume(TokenType.RPAREN, "Expected ')' after platform config");
        } else {
          // Single identifier name
          const deviceName = this.advance();
          this.consume(TokenType.RPAREN, "Expected ')' after device name");
          config = deviceName.value;
        }
      } else {
        // Fallback: parse key-value pairs (defensive)
        config = {};
        while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
          if (this.check(TokenType.COMMA) || this.check(TokenType.NEWLINE)) {
            this.advance();
            continue;
          }
          const keyTok = this.consume(
            TokenType.IDENTIFIER,
            "Expected identifier as config key"
          );
          this.consume(TokenType.ASSIGN, "Expected '=' after config key");
          const value = this.parsePrimaryExpression();
          (config as any)[keyTok.value] = value;
        }
        this.consume(TokenType.RPAREN, "Expected ')' after platform config");
      }
    }

    return {
      type: "PlatformAnnotation",
      platform,
      config,
      location: this.makeLocationFromToken(token),
    };
  }

  /**
   * Parse expression with operator precedence (Pratt parser)
   */
  private parseExpression(
    precedence: Precedence = Precedence.NONE
  ): Expression {
    // Parse prefix (primary or unary)
    let left = this.parsePrefixExpression();

    // Parse infix operators while precedence allows
    while (precedence < this.getPrecedence(this.peek().type)) {
      left = this.parseInfixExpression(left);
    }

    return left;
  }

  /**
   * Parse prefix expression (primary or unary operator)
   */
  private parsePrefixExpression(): Expression {
    // Unary operators
    if (
      this.check(TokenType.MINUS) ||
      this.check(TokenType.PLUS) ||
      this.check(TokenType.NOT)
    ) {
      return this.parseUnaryExpression();
    }

    // Primary expressions (literals, identifiers, grouping)
    return this.parsePrimaryExpression();
  }

  /**
   * Parse unary expression (-, +)
   */
  private parseUnaryExpression(): UnaryExpression {
    const operator = this.advance();
    const operand = this.parseExpression(Precedence.UNARY);

    return {
      type: "UnaryExpression",
      operator: this.normalizeLogicalOperator(operator.value),
      operand,
      location: this.makeLocationFromToken(operator),
    };
  }

  /**
   * Parse infix expression (binary operators)
   */
  private parseInfixExpression(left: Expression): Expression {
    const token = this.peek();

    // Binary operators
    if (this.isBinaryOperator(token.type)) {
      return this.parseBinaryExpression(left);
    }

    return left;
  }

  /**
   * Parse binary expression
   */
  private parseBinaryExpression(left: Expression): BinaryExpression {
    const operator = this.advance();
    const precedence = this.getPrecedence(operator.type);

    // Right associative for assignment
    // With the strict `<` loop condition, a left-associative operator passes
    // its own precedence so that stronger operators bind inside the RHS.
    // Assignment is right-associative and therefore admits another assignment.
    const nextPrecedence =
      operator.type === TokenType.ASSIGN
        ? (precedence - 1) as Precedence
        : precedence;

    const right = this.parseExpression(nextPrecedence);

    return {
      type: "BinaryExpression",
      left,
      operator: this.normalizeLogicalOperator(operator.value),
      right,
      location: this.makeLocationFromToken(operator),
    };
  }

  /**
   * Get operator precedence
   */
  private getPrecedence(tokenType: TokenType): Precedence {
    switch (tokenType) {
      case TokenType.ASSIGN:
        return Precedence.ASSIGNMENT;
      case TokenType.DOUBLE_PIPE: // ||
        return Precedence.OR;
      case TokenType.DOUBLE_AMPERSAND: // &&
        return Precedence.AND;
      case TokenType.EQUAL: // ==
      case TokenType.NOT_EQUAL: // !=
        return Precedence.EQUALITY;
      case TokenType.LESS:
      case TokenType.LESS_EQUAL:
      case TokenType.GREATER:
      case TokenType.GREATER_EQUAL:
        return Precedence.COMPARISON;
      case TokenType.PLUS:
      case TokenType.MINUS:
        return Precedence.TERM;
      case TokenType.STAR:
      case TokenType.SLASH:
      case TokenType.PERCENT:
        return Precedence.FACTOR;
      case TokenType.DOT:
      case TokenType.LPAREN:
      case TokenType.LBRACKET:
        return Precedence.CALL;
      case TokenType.LBRACE:
        // Do not treat '{' as an infix/call precedence to avoid gluing 'identifier { ... }'
        return Precedence.NONE;
      default:
        return Precedence.NONE;
    }
  }

  /**
   * Check if token is binary operator
   */
  private isBinaryOperator(tokenType: TokenType): boolean {
    return [
      TokenType.PLUS,
      TokenType.MINUS,
      TokenType.STAR,
      TokenType.SLASH,
      TokenType.PERCENT,
      TokenType.EQUAL,
      TokenType.NOT_EQUAL,
      TokenType.LESS,
      TokenType.LESS_EQUAL,
      TokenType.GREATER,
      TokenType.GREATER_EQUAL,
      TokenType.DOUBLE_AMPERSAND, // &&
      TokenType.DOUBLE_PIPE, // ||
      TokenType.ASSIGN,
    ].includes(tokenType);
  }

  /** Normalize symbolic logical aliases to the canonical word form. */
  private normalizeLogicalOperator(operator: string): string {
    switch (operator) {
      case "||":
        return "or";
      case "&&":
        return "and";
      case "!":
        return "not";
      default:
        return operator;
    }
  }

  /**
   * Parse statement (for body content)
   */
  private parseStatement(): Statement {
    // Keywords that start statements
    if (this.check(TokenType.LET)) {
      return this.parseLetStatement();
    }

    if (this.check(TokenType.IF)) {
      return this.parseIfStatement();
    }

    if (this.check(TokenType.RETURN)) {
      return this.parseReturnStatement();
    }

    // Default: expression statement (covers config blocks, function calls, etc.)
    return this.parseExpressionStatement();
  }

  /**
   * Parse let statement
   */
  private parseLetStatement(): LetStatement {
    const start = this.advance(); // consume 'let'
    const name = this.parseIdentifier();

    let valueType: TypeReference | undefined;
    if (this.match(TokenType.COLON)) {
      valueType = this.parseTypeReference();
    }

    this.consume(TokenType.ASSIGN, "Expected '=' after variable name");
    const initializer = this.parseExpression();

    // Optional semicolon
    this.match(TokenType.SEMICOLON);

    return {
      type: "LetStatement",
      name,
      valueType,
      initializer,
      mutable: false, // TODO: check for 'mut' keyword
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse if statement (stub)
   */
  private parseIfStatement(): IfStatement {
    const start = this.advance(); // consume 'if'

    const condition = this.parseExpression();
    const consequent = this.parseBlockStatement();

    let alternate: Statement | undefined;
    if (this.match(TokenType.ELSE)) {
      alternate = this.parseBlockStatement();
    }

    return {
      type: "IfStatement",
      condition,
      consequent,
      alternate,
      location: this.makeLocationFromStartToken(start),
    };
  }
  /**
   * Parse return statement
   */
  private parseReturnStatement(): ReturnStatement {
    const start = this.advance(); // consume 'return'

    let value: Expression | undefined;
    if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE)) {
      value = this.parseExpression();
    }

    // Optional semicolon
    this.match(TokenType.SEMICOLON);

    return {
      type: "ReturnStatement",
      value,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse expression statement (covers config blocks, assignments, calls)
   */
  private parseExpressionStatement(): ExpressionStatement {
    const expr = this.parseExpression();

    // Optional semicolon
    this.match(TokenType.SEMICOLON);

    return {
      type: "ExpressionStatement",
      expression: expr,
      location: expr.location,
    };
  }

  /**
   * Parse block statement
   */
  private parseBlockStatement(): BlockStatement {
    const start = this.peek();
    this.consume(TokenType.LBRACE, "Expected '{'");

    const statements: Statement[] = [];

    // Parse statements until closing brace
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      try {
        statements.push(this.parseStatement());
      } catch (e) {
        // Tolerant recovery inside block: skip to next ';' or '}'
        while (
          !this.isAtEnd() &&
          !this.check(TokenType.SEMICOLON) &&
          !this.check(TokenType.RBRACE)
        ) {
          this.advance();
        }
        // Consume optional semicolon
        if (this.check(TokenType.SEMICOLON)) {
          this.advance();
        }
        // Continue with next potential statement
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    return {
      type: "BlockStatement",
      statements,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse primary expression (stub - will be expanded)
   */
  private parsePrimaryExpression(): Expression {
    const token = this.peek();

    // String literal
    if (this.match(TokenType.STRING)) {
      return {
        type: "Literal",
        value: this.previous().value,
        raw: this.previous().value,
        location: this.makeLocationFromToken(this.previous()),
      };
    }

    // Number literal
    if (this.match(TokenType.NUMBER)) {
      return {
        type: "Literal",
        value: parseFloat(this.previous().value),
        raw: this.previous().value,
        location: this.makeLocationFromToken(this.previous()),
      };
    }

    // Duration literal (5s, 10m, 1h, etc.)
    if (this.match(TokenType.DURATION)) {
      return {
        type: "DurationLiteral",
        value: this.previous().value,
        raw: this.previous().value,
        location: this.makeLocationFromToken(this.previous()),
      };
    }

    // Boolean literal
    if (this.match(TokenType.BOOLEAN)) {
      return {
        type: "Literal",
        value: this.previous().value === "true",
        raw: this.previous().value,
        location: this.makeLocationFromToken(this.previous()),
      };
    }

    // Grouping (parentheses)
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");
      return expr;
    }

    // Object literal { key: value }
    if (this.check(TokenType.LBRACE)) {
      return this.parseObjectExpression();
    }

    // Array literal [ item1, item2, ... ]
    if (this.check(TokenType.LBRACKET)) {
      return this.parseArrayExpression();
    }

    // Identifier (or identifier + block/object pattern)
    if (this.check(TokenType.IDENTIFIER)) {
      // Return simple identifier; any following '{' will start a separate expression/statement
      return this.parseIdentifier();
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  /**
   * Parse object expression { key: value, ... }
   * Supports both comma-separated and newline-separated properties
   */
  private parseObjectExpression(): ObjectExpression {
    const start = this.advance(); // consume '{'
    const properties: ObjectProperty[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Parse key (identifier)
      const key = this.parseIdentifier();

      this.consume(TokenType.COLON, "Expected ':' after object key");

      // Parse value (expression)
      const value = this.parseExpression();

      properties.push({
        type: "ObjectProperty",
        key,
        value,
        location: key.location,
      });

      // Comma is OPTIONAL (supports both `key: value,` and `key: value\n`)
      // If we see a comma, consume it
      // If we see closing brace, we're done
      // Otherwise, continue to next property (newline-separated)
      if (this.check(TokenType.COMMA)) {
        this.advance(); // consume comma
      } else if (this.check(TokenType.RBRACE)) {
        break; // end of object
      }
      // else: continue to next property (newline-separated, no comma)
    }

    this.consume(TokenType.RBRACE, "Expected '}' after object properties");

    return {
      type: "ObjectExpression",
      properties,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse array expression [ item1, item2, ... ]
   */
  private parseArrayExpression(): ArrayExpression {
    const start = this.advance(); // consume '['
    const elements: Expression[] = [];

    while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
      // Parse element (expression)
      elements.push(this.parseExpression());

      // Comma is OPTIONAL (like in objects)
      if (this.check(TokenType.COMMA)) {
        this.advance(); // consume comma
      } else if (this.check(TokenType.RBRACKET)) {
        break; // end of array
      }
    }

    this.consume(TokenType.RBRACKET, "Expected ']' after array elements");

    return {
      type: "ArrayExpression",
      elements,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse identifier
   */
  private parseIdentifier(): Identifier {
    const token = this.consume(TokenType.IDENTIFIER, "Expected identifier");

    return {
      type: "Identifier",
      name: token.value,
      location: this.makeLocationFromToken(token),
    };
  }

  /**
   * Token manipulation helpers
   */
  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  /**
   * Lookahead helper: Check if upcoming tokens match object literal pattern { key: value }
   * Returns true if next tokens after { are: IDENTIFIER COLON
   */
  // isObjectLiteral: removed (no longer used)

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();

    throw new Error(`${message} at line ${this.peek().location.start.line}`);
  }

  /**
   * Parse object literal { key: "value", key2: "value2" }
   * Supports: strings, numbers, booleans, arrays, nested objects
   */
  private parseObjectLiteral(): any {
    const start = this.peek();
    this.consume(TokenType.LBRACE, "Expected '{' for object literal");

    const properties: Array<{ key: string; value: any }> = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Parse key: identifier or string
      let key: string;
      if (this.check(TokenType.IDENTIFIER)) {
        key = this.advance().value;
      } else if (this.check(TokenType.STRING)) {
        key = this.advance().value;
      } else {
        throw new Error("Expected property key (identifier or string)");
      }

      // Check for colon OR shorthand nested object (key { ... })
      let value: any;
      if (this.check(TokenType.COLON)) {
        this.advance(); // consume ':'

        // Parse value: string, number, boolean, array, or nested object
        if (this.check(TokenType.STRING)) {
          const token = this.advance();
          value = {
            type: "Literal",
            value: token.value,
            raw: token.value,
            location: token.location,
          };
        } else if (this.check(TokenType.NUMBER)) {
          const token = this.advance();
          value = {
            type: "Literal",
            value: parseFloat(token.value),
            raw: token.value,
            location: token.location,
          };
        } else if (this.check(TokenType.BOOLEAN)) {
          const token = this.advance();
          value = {
            type: "Literal",
            value: token.value === "true",
            raw: token.value,
            location: token.location,
          };
        } else if (this.check(TokenType.LBRACKET)) {
          // Array literal
          this.advance(); // consume '['
          const elements: any[] = [];
          while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
            if (this.check(TokenType.STRING)) {
              const token = this.advance();
              elements.push({
                type: "Literal",
                value: token.value,
                raw: token.value,
                location: token.location,
              });
            } else if (this.check(TokenType.NUMBER)) {
              const token = this.advance();
              elements.push({
                type: "Literal",
                value: parseFloat(token.value),
                raw: token.value,
                location: token.location,
              });
            }
            this.match(TokenType.COMMA);
          }
          this.consume(TokenType.RBRACKET, "Expected ']' after array elements");
          value = {
            type: "ArrayExpression",
            elements,
            location: start.location,
          };
        } else if (this.check(TokenType.LBRACE)) {
          // Nested object literal (recursive)
          value = this.parseObjectLiteral();
        } else {
          throw new Error(
            `Unexpected token in object literal: ${this.peek().type}`
          );
        }
      } else if (this.check(TokenType.LBRACE)) {
        // Shorthand syntax: key { ... } (no colon)
        value = this.parseObjectLiteral();
      } else {
        throw new Error(
          `Expected ':' or '{' after property key '${key}' at line ${
            this.peek().location.start.line
          }`
        );
      }

      properties.push({ key, value });

      // Optional comma
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}' after object literal");

    return {
      type: "ObjectLiteral",
      properties,
      location: start.location,
    };
  }

  /**
   * Skip a block { ... } for constructs not yet fully parsed
   * Handles cases where we're already inside a block after an error
   */
  private skipBlock(): any {
    const start = this.peek();

    // If current token is not {, we're already inside a block after error
    // Find the matching closing brace by tracking depth
    let depth = 0;

    if (this.check(TokenType.LBRACE)) {
      this.advance(); // Consume opening {
      depth = 1;
    } else {
      // We're inside a block, find current depth by looking back
      // Just skip to next RBRACE at same level
      depth = 1; // Assume we're at depth 1 (inside one block)
    }

    while (!this.isAtEnd() && depth > 0) {
      if (this.check(TokenType.LBRACE)) {
        depth++;
      } else if (this.check(TokenType.RBRACE)) {
        depth--;
      }
      if (depth > 0) {
        this.advance();
      }
    }

    if (this.check(TokenType.RBRACE)) {
      this.advance(); // Consume closing }
    }

    return {
      type: "SkippedBlock",
      location: start.location,
    };
  }

  /**
   * Parse config block in task body
   * config { key: value, key2: value2 }
   */
  private parseConfigBlock(): import("../ast/nodes").ConfigBlock {
    const start = this.previous(); // 'config' keyword already consumed
    this.consume(TokenType.LBRACE, "Expected '{' after 'config'");

    const properties: import("../ast/nodes").ConfigProperty[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Parse key (identifier)
      if (!this.check(TokenType.IDENTIFIER)) {
        throw new Error(
          `Expected property key at line ${this.peek().location.start.line}`
        );
      }
      const key = this.parseIdentifier();

      // Expect colon
      this.consume(TokenType.COLON, `Expected ':' after '${key.name}'`);

      // Parse value (expression: literal, duration, identifier, etc.)
      const value = this.parsePrimaryExpression();

      properties.push({
        type: "ConfigProperty",
        key,
        value,
        location: this.makeLocationFromStartToken(key.location as any),
      });

      // Optional comma or newline
      this.match(TokenType.COMMA);
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after config block");

    return {
      type: "ConfigBlock",
      properties,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse lifecycle hook in task body
   * on_connect { statements }
   * on_disconnect { statements }
   * on_reconnect { statements }
   */
  private parseLifecycleHook(
    eventName: string
  ): import("../ast/nodes").LifecycleHook {
    const start = this.previous(); // 'on_connect' etc. already consumed

    // Validate event name
    const validEvents = [
      "on_connect",
      "on_disconnect",
      "on_reconnect",
      "on_start",
      "on_stop",
      "on_error",
    ];
    if (!validEvents.includes(eventName)) {
      throw new Error(
        `Invalid lifecycle event '${eventName}'. Valid: ${validEvents.join(
          ", "
        )}`
      );
    }

    // Parse body block
    const body = this.parseBlockStatement();

    return {
      type: "LifecycleHook",
      event: eventName as any,
      body,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse device body
   * device sensor { ip: "...", lifecycle { ... }, hardware { ... } }
   */
  private parseDeviceBody(): import("../ast/nodes").DeviceBody {
    const start = this.peek();
    // Note: LBRACE already checked by caller (parseDeviceDeclaration line 1008)
    // Do NOT consume LBRACE here to avoid double-consumption
    this.consume(TokenType.LBRACE, "Expected '{' for device body");

    let reference: import("../ast/nodes").ReferenceSection | undefined;
    const properties: import("../ast/nodes").DeviceProperty[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Skip newlines and comments
      while (
        this.check(TokenType.NEWLINE) ||
        this.check(TokenType.LINE_COMMENT) ||
        this.check(TokenType.BLOCK_COMMENT) ||
        this.check(TokenType.DOC_COMMENT)
      ) {
        this.advance();
      }

      if (this.check(TokenType.RBRACE)) break;

      // Check for 'reference' keyword
      if (this.check(TokenType.REFERENCE)) {
        if (reference) {
          throw new Error(
            `Duplicate 'reference' section at line ${
              this.peek().location.start.line
            }`
          );
        }
        reference = this.parseReferenceSection();
        continue; // Skip to next iteration
      }

      // Parse property key (identifier)
      if (!this.check(TokenType.IDENTIFIER)) {
        throw new Error(
          `Expected property key at line ${this.peek().location.start.line}`
        );
      }
      const key = this.parseIdentifier();

      // Check if it's a special block (lifecycle, hardware) or regular property
      if (this.check(TokenType.LBRACE)) {
        // Special block: lifecycle { ... } or hardware { ... }
        const block = this.parseDeviceNestedBlock(key);
        properties.push({
          type: "DeviceProperty",
          key,
          value: block,
          location: this.makeLocationFromStartToken(key.location as any),
        });
      } else {
        // Regular property: key: type : default_value?
        this.consume(TokenType.COLON, `Expected ':' after '${key.name}'`);

        // Parse type reference (e.g., str, u8, bool, [str])
        const typeRef = this.parseTypeReference();

        // Check for optional default value (: value)
        let defaultValue: Expression | undefined;
        if (this.check(TokenType.COLON)) {
          this.advance(); // Consume second ':'
          defaultValue = this.parsePrimaryExpression();
        }

        // Create property value object
        const value = defaultValue
          ? {
              type: "PropertyWithDefault" as const,
              typeRef,
              defaultValue,
              location: this.makeLocationFromStartToken(
                typeRef.location as any
              ),
            }
          : typeRef;

        properties.push({
          type: "DeviceProperty",
          key,
          value,
          location: this.makeLocationFromStartToken(key.location as any),
        });
      }

      // Optional comma or newline
      this.match(TokenType.COMMA);
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after device body");

    return {
      type: "DeviceBody",
      reference,
      properties,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Parse nested block in device (lifecycle, hardware)
   * lifecycle { track_restarts: true, ... }
   */
  private parseDeviceNestedBlock(
    blockName: import("../ast/nodes").Identifier
  ): import("../ast/nodes").DeviceNestedBlock {
    const start = this.peek();
    this.consume(TokenType.LBRACE, `Expected '{' after '${blockName.name}'`);

    const properties: import("../ast/nodes").DeviceProperty[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      // Skip newlines and comments
      while (
        this.check(TokenType.NEWLINE) ||
        this.check(TokenType.LINE_COMMENT) ||
        this.check(TokenType.BLOCK_COMMENT) ||
        this.check(TokenType.DOC_COMMENT)
      ) {
        this.advance();
      }

      if (this.check(TokenType.RBRACE)) break;

      // Parse key
      if (!this.check(TokenType.IDENTIFIER)) {
        throw new Error(
          `Expected property key at line ${this.peek().location.start.line}`
        );
      }
      const key = this.parseIdentifier();

      // Expect colon
      this.consume(TokenType.COLON, `Expected ':' after '${key.name}'`);

      // Parse type reference (e.g., str, u8, bool, [str])
      const typeRef = this.parseTypeReference();

      // Check for optional default value (: value)
      let defaultValue: Expression | undefined;
      if (this.check(TokenType.COLON)) {
        this.advance(); // Consume second ':'
        defaultValue = this.parsePrimaryExpression();
      }

      // Create property value object
      const value = defaultValue
        ? {
            type: "PropertyWithDefault" as const,
            typeRef,
            defaultValue,
            location: this.makeLocationFromStartToken(typeRef.location as any),
          }
        : typeRef;

      properties.push({
        type: "DeviceProperty",
        key,
        value,
        location: this.makeLocationFromStartToken(key.location as any),
      });

      // Optional comma or newline
      this.match(TokenType.COMMA);
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
    }

    this.consume(
      TokenType.RBRACE,
      `Expected '}' after ${blockName.name} block`
    );

    return {
      type: "DeviceNestedBlock",
      name: blockName,
      properties,
      location: this.makeLocationFromStartToken(start),
    };
  }

  /**
   * Error recovery
   */
  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === TokenType.SEMICOLON) return;

      switch (this.peek().type) {
        case TokenType.TASK:
        case TokenType.TYPE:
        case TokenType.ENUM:
        case TokenType.FN:
        case TokenType.PIPELINE:
        case TokenType.SUPERVISOR:
        case TokenType.DEPLOYMENT:
          return;
      }

      this.advance();
    }
  }

  /**
   * Location helpers
   */
  private makeLocationFromToken(token: Token): SourceLocation {
    return token.location;
  }

  /**
   * Create location from start token to current position
   * Use this for declarations to capture full span
   */
  private makeLocationFromStartToken(startToken: Token): SourceLocation {
    const startIndex = this.tokens.indexOf(startToken);
    if (startIndex === -1) {
      return startToken.location;
    }
    // Current position is already advanced past last consumed token
    const endIndex = Math.max(startIndex, this.current - 1);
    return this.makeLocation(startIndex, endIndex + 1);
  }

  private makeLocation(start: number, end: number): SourceLocation {
    return {
      start: this.tokens[start].location.start,
      end:
        this.tokens[end - 1]?.location.end || this.tokens[start].location.end,
    };
  }

  private parseReferenceSection(): import("../ast/nodes").ReferenceSection {
    const start = this.peek();
    this.advance();
    this.consume(TokenType.LBRACE, "Expected '{' after 'reference'");
    const languages: import("../ast/nodes").LanguageReference[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
      if (this.check(TokenType.RBRACE)) break;
      languages.push(this.parseLanguageReference());
      this.match(TokenType.COMMA);
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
    }
    this.consume(TokenType.RBRACE, "Expected '}' after reference section");
    return {
      type: "ReferenceSection",
      languages,
      location: this.makeLocationFromStartToken(start),
    };
  }

  private parseLanguageReference(): import("../ast/nodes").LanguageReference {
    const start = this.peek();

    // Language reference uses same @ token as platform annotations
    // Examples: @c/c++, @rust, @micropython
    // Lexer tokenizes @ + identifier as PLATFORM_ANNOTATION, so we need to parse the full language target
    if (!this.check(TokenType.PLATFORM_ANNOTATION)) {
      throw new Error(
        `Expected '@' before language target at line ${start.location.start.line}`
      );
    }

    // Read first part (e.g., "@c" from "@c/c++")
    let target = this.advance().value as string;
    target = target.substring(1); // Remove @ prefix

    // Handle multi-part languages like "c/c++", "objective-c", etc.
    while (
      this.check(TokenType.SLASH) ||
      this.check(TokenType.PLUS) ||
      this.check(TokenType.MINUS)
    ) {
      const op = this.advance();
      target += op.value;

      if (this.check(TokenType.IDENTIFIER)) {
        target += this.advance().value;
      } else if (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
        // Handle c++ case (two + tokens)
        target += this.advance().value;
      }
    }

    // Optional string name for documentation
    let name: import("../ast/nodes").Literal | undefined;
    if (this.check(TokenType.STRING)) {
      const nameToken = this.advance();
      name = {
        type: "Literal",
        value: nameToken.value as string,
        raw: nameToken.value,
        location: nameToken.location,
      };
    }

    // Parse language-specific fields
    this.consume(TokenType.LBRACE, `Expected '{' after @${target}`);
    const fields: import("../ast/nodes").ReferenceField[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
      if (this.check(TokenType.RBRACE)) break;
      fields.push(this.parseReferenceField());
      // Allow both comma and newline as separators (or just newline alone)
      this.match(TokenType.COMMA);
      this.match(TokenType.SEMICOLON);
      while (this.check(TokenType.NEWLINE)) {
        this.advance();
      }
    }
    this.consume(TokenType.RBRACE, `Expected '}' after @${target} block`);

    return {
      type: "LanguageReference",
      target,
      name,
      fields,
      location: this.makeLocationFromStartToken(start),
    };
  }

  private parseReferenceField(): import("../ast/nodes").ReferenceField {
    const start = this.peek();

    // Reference field keys can be identifiers OR certain keywords
    // (import, use are language keywords but also valid reference field names)
    let keyToken: Token;
    let key: string;

    if (this.check(TokenType.IDENTIFIER)) {
      keyToken = this.advance();
      key = keyToken.value as string;
    } else if (this.check(TokenType.IMPORT)) {
      keyToken = this.advance();
      key = "import"; // Normalize keyword to string
    } else if (this.check(TokenType.USE)) {
      keyToken = this.advance();
      key = "use"; // Will be normalized to "declare" below
    } else {
      throw new Error(
        `Expected field key at line ${start.location.start.line}`
      );
    }

    // Validate field key (per 01-device-declaration.md spec)
    // Support both old (use/init) and new (declare/setup) naming
    if (
      ![
        "include",
        "library",
        "declare",
        "setup",
        "import",
        "use",
        "init",
      ].includes(key)
    ) {
      throw new Error(
        `Unknown reference field '${key}' at line ${start.location.start.line}. Valid fields: include, library, declare (or use), setup (or init), import`
      );
    }

    // Normalize old naming to new (for consistency in AST)
    if (key === "use") key = "declare";
    if (key === "init") key = "setup";

    this.consume(TokenType.COLON, `Expected ':' after '${key}'`);
    let value:
      | import("../ast/nodes").Literal
      | import("../ast/nodes").CodeBlock;
    if (this.check(TokenType.STRING)) {
      const valueToken = this.advance();
      value = {
        type: "Literal",
        value: valueToken.value as string,
        raw: valueToken.value,
        location: valueToken.location,
      };
    } else {
      const codeTokens: Token[] = [];
      // Collect tokens until we hit a terminator OR see the start of a new field (identifier/import followed by colon)
      while (
        !this.check(TokenType.SEMICOLON) &&
        !this.check(TokenType.RBRACE) &&
        !this.isAtEnd()
      ) {
        codeTokens.push(this.advance());
      }
      const content = codeTokens.map((t) => t.value).join(" ");
      value = {
        type: "CodeBlock",
        content: content.trim(),
        location:
          codeTokens.length > 0 ? codeTokens[0].location : start.location,
      };
    }
    this.match(TokenType.SEMICOLON);
    return {
      type: "ReferenceField",
      key: key as any,
      value,
      location: this.makeLocationFromStartToken(start),
    };
  }
}
