import { SourceLocation } from "../lexer/token";

/**
 * Comment types (Phase 8.2)
 */
export type CommentType = "LineComment" | "BlockComment" | "DocComment";

/**
 * Comment interface (Phase 8.2)
 * Represents a preserved comment with its content and location
 */
export interface Comment {
  type: CommentType;
  content: string; // Comment text WITHOUT delimiters (// or /* */)
  raw: string; // Original text WITH delimiters
  location: SourceLocation; // Precise position in source code
}

/**
 * Base interface for all AST nodes
 */
export interface ASTNode {
  type: string;
  location: SourceLocation;
  leadingComments?: Comment[]; // Comments BEFORE this node (Phase 8.2)
  trailingComments?: Comment[]; // Comments AFTER this node, same line only (Phase 8.2)
}

/**
 * Top-level program node
 */
export interface Program extends ASTNode {
  type: "Program";
  body: Declaration[];
}

/**
 * All declaration types
 */
export type Declaration =
  | TaskDeclaration
  | TypeDeclaration
  | EnumDeclaration
  | StructDeclaration
  | FunctionDeclaration
  | PipelineDeclaration
  | SupervisorDeclaration
  | DeploymentDeclaration
  | NarrativeDeclaration
  | DeviceDeclaration;

/**
 * Task declaration with platform annotation
 * PHASE 8.1.5: body can be structured TaskBody or generic BlockStatement
 */
export interface TaskDeclaration extends ASTNode {
  type: "TaskDeclaration";
  name: Identifier;
  parameters: Parameter[];
  platformAnnotation?: PlatformAnnotation;
  returnType?: TypeReference;
  body: TaskBody | BlockStatement;
}

/**
 * Type declaration (type Name { ... } or type Alias = Type)
 */
export interface TypeDeclaration extends ASTNode {
  type: "TypeDeclaration";
  name: Identifier;
  typeParameters?: TypeParameter[];
  definition: TypeReference | StructType;
}

/**
 * Enum declaration
 */
export interface EnumDeclaration extends ASTNode {
  type: "EnumDeclaration";
  name: Identifier;
  variants: EnumVariant[];
}

export interface EnumVariant extends ASTNode {
  type: "EnumVariant";
  name: Identifier;
  associatedData?: TypeReference[];
}

/**
 * Struct declaration
 */
export interface StructDeclaration extends ASTNode {
  type: "StructDeclaration";
  name: Identifier;
  fields: StructField[];
}

export interface StructField extends ASTNode {
  type: "StructField";
  name: Identifier;
  fieldType: TypeReference;
}

/**
 * Function declaration (fn)
 */
export interface FunctionDeclaration extends ASTNode {
  type: "FunctionDeclaration";
  name: Identifier;
  parameters: Parameter[];
  returnType: TypeReference;
  body: BlockStatement;
}

/**
 * Pipeline declaration
 */
export interface PipelineDeclaration extends ASTNode {
  type: "PipelineDeclaration";
  name: Identifier;
  stages: PipelineStage[];
}

export interface PipelineStage extends ASTNode {
  type: "PipelineStage";
  kind: "use" | "parallel" | "branch";
  target?: Identifier;
  branches?: PipelineStage[];
}

/**
 * Supervisor declaration
 */
export interface SupervisorDeclaration extends ASTNode {
  type: "SupervisorDeclaration";
  name: Identifier;
  strategy: string; // "one_for_one", "one_for_all", etc.
  children: SupervisedTask[];
}

export interface SupervisedTask extends ASTNode {
  type: "SupervisedTask";
  name: Identifier;
  task: Identifier;
  arguments: Expression[];
  config: SupervisionConfig;
}

export interface SupervisionConfig extends ASTNode {
  type: "SupervisionConfig";
  restart: string; // "permanent", "transient", "temporary"
  healthCheck?: Expression;
  dependsOn?: Identifier[];
}

/**
 * Deployment configuration
 */
export interface DeploymentDeclaration extends ASTNode {
  type: "DeploymentDeclaration";
  config: Record<string, any>; // Flexible for now
}

/**
 * Narrative declaration - metaplan layer for semantic context
 */
export interface NarrativeDeclaration extends ASTNode {
  type: "NarrativeDeclaration";
  name: Literal; // string literal with narrative name
  intent?: Literal[]; // array of string literals (each line is one item)
  scope?: Literal; // string literal with scope description
  compliance?: Literal[] | ObjectLiteral; // array of strings OR object { key: "value" }
  appliesTo?: NarrativeAppliesTo; // structured applies_to block
  trace?: TracePolicy;
  priority?: Priority;
  retention?: Literal; // string literal (e.g., "7 years")
  stakeholders?: ObjectLiteral; // { homeowner: "...", family: "..." }
  value_proposition?: Literal[]; // array of string literals
  story_flow?: Literal[]; // array of string literals (story steps)
  degraded_semantics?: BlockStatement; // conditional logic block
}

/**
 * Narrative applies_to block - specifies scope
 */
export interface NarrativeAppliesTo extends ASTNode {
  type: "NarrativeAppliesTo";
  tasks?: Identifier[]; // array of task names
  events?: Literal; // string literal describing events
  metrics?: Literal; // string literal describing metrics
}

/**
 * Object literal for key-value pairs in narrative blocks
 */
export interface ObjectLiteral extends ASTNode {
  type: "ObjectLiteral";
  properties: Array<{ key: string; value: Literal }>;
}

/**
 * Device declaration - hardware deployment target
 * Example:
 * device "sensor_kitchen" @embedded(esp32_c3) {
 *     ip: "192.168.1.22",
 *     sensors: ["temperature", "humidity"]
 * }
 */
export interface DeviceDeclaration extends ASTNode {
  type: "DeviceDeclaration";
  name: Identifier; // device name as identifier (like type/task/enum)
  platformAnnotation?: PlatformAnnotation; // e.g., @embedded(esp32_c3)
  body?: DeviceBody; // Device body with reference section and properties (Phase 8.1.6)
}

export type TracePolicy = "minimal" | "standard" | "full" | AdaptiveTrace;

export interface AdaptiveTrace extends ASTNode {
  type: "AdaptiveTrace";
  sampleRate: number;
  escalateOnError?: boolean;
}

export type Priority = "low" | "normal" | "high" | "critical";

/**
 * Platform annotation (@embedded, @server, @report)
 */
export interface PlatformAnnotation extends ASTNode {
  type: "PlatformAnnotation";
  platform: string; // "embedded", "server", "report", etc.
  config?: Record<string, Expression> | string; // string for device name: @embedded("device_name")
}

/**
 * Function/Task parameter
 */
export interface Parameter extends ASTNode {
  type: "Parameter";
  name: Identifier;
  paramType: TypeReference;
  defaultValue?: Expression;
}

/**
 * Type parameter (generics)
 */
export interface TypeParameter extends ASTNode {
  type: "TypeParameter";
  name: Identifier;
  constraint?: TypeReference;
}

/**
 * Type references
 */
export type TypeReference =
  | SimpleType
  | GenericType
  | ArrayType
  | ChannelType
  | QueueType
  | StructType
  | FunctionType;

export interface SimpleType extends ASTNode {
  type: "SimpleType";
  name: Identifier;
}

export interface ArrayType extends ASTNode {
  type: "ArrayType";
  elementType: TypeReference;
}

export interface GenericType extends ASTNode {
  type: "GenericType";
  base: Identifier;
  typeArguments: TypeReference[];
}

export interface ChannelType extends ASTNode {
  type: "ChannelType";
  elementType: TypeReference;
}

export interface QueueType extends ASTNode {
  type: "QueueType";
  elementType: TypeReference;
}

export interface StructType extends ASTNode {
  type: "StructType";
  fields: StructField[];
}

export interface FunctionType extends ASTNode {
  type: "FunctionType";
  parameters: TypeReference[];
  returnType: TypeReference;
}

/**
 * Statements
 */
export type Statement =
  | LetStatement
  | IfStatement
  | LoopStatement
  | WhileStatement
  | ForStatement
  | MatchStatement
  | ReceiveStatement
  | ReturnStatement
  | ExpressionStatement
  | BlockStatement;

export interface LetStatement extends ASTNode {
  type: "LetStatement";
  name: Identifier;
  valueType?: TypeReference;
  initializer: Expression;
  mutable: boolean; // let vs let mut
}

export interface IfStatement extends ASTNode {
  type: "IfStatement";
  condition: Expression;
  consequent: Statement;
  alternate?: Statement;
}

export interface LoopStatement extends ASTNode {
  type: "LoopStatement";
  body: BlockStatement;
}

export interface WhileStatement extends ASTNode {
  type: "WhileStatement";
  condition: Expression;
  body: BlockStatement;
}

export interface ForStatement extends ASTNode {
  type: "ForStatement";
  variable: Identifier;
  iterable: Expression;
  body: BlockStatement;
}

export interface MatchStatement extends ASTNode {
  type: "MatchStatement";
  expression: Expression;
  arms: MatchArm[];
}

export interface MatchArm extends ASTNode {
  type: "MatchArm";
  pattern: Pattern;
  guard?: Expression;
  body: Expression;
}

export interface ReceiveStatement extends ASTNode {
  type: "ReceiveStatement";
  handlers: ReceiveHandler[];
}

export interface ReceiveHandler extends ASTNode {
  type: "ReceiveHandler";
  pattern: Pattern;
  channel: Expression;
  body: BlockStatement;
}

export interface ReturnStatement extends ASTNode {
  type: "ReturnStatement";
  value?: Expression;
}

export interface ExpressionStatement extends ASTNode {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface BlockStatement extends ASTNode {
  type: "BlockStatement";
  statements: Statement[];
}

/**
 * Expressions
 */
export type Expression =
  | Identifier
  | Literal
  | DurationLiteral
  | BinaryExpression
  | UnaryExpression
  | CallExpression
  | MemberExpression
  | ChannelExpression
  | ArrayExpression
  | ObjectExpression
  | LambdaExpression;

export interface Identifier extends ASTNode {
  type: "Identifier";
  name: string;
}

export interface Literal extends ASTNode {
  type: "Literal";
  value: string | number | boolean;
  raw: string;
}

export interface DurationLiteral extends ASTNode {
  type: "DurationLiteral";
  value: string; // e.g., "5s", "10m", "1h"
  raw: string;
}

export interface BinaryExpression extends ASTNode {
  type: "BinaryExpression";
  operator: string; // +, -, *, /, ==, !=, <, >, etc.
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends ASTNode {
  type: "UnaryExpression";
  operator: string; // -, !, etc.
  operand: Expression;
}

export interface CallExpression extends ASTNode {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface MemberExpression extends ASTNode {
  type: "MemberExpression";
  object: Expression;
  property: Identifier;
  computed: boolean; // obj.prop vs obj[prop]
}

export interface ChannelExpression extends ASTNode {
  type: "ChannelExpression";
  operation: "send" | "receive";
  channel: Expression;
  value?: Expression;
}

export interface ArrayExpression extends ASTNode {
  type: "ArrayExpression";
  elements: Expression[];
}

export interface ObjectExpression extends ASTNode {
  type: "ObjectExpression";
  properties: ObjectProperty[];
}

export interface ObjectProperty extends ASTNode {
  type: "ObjectProperty";
  key: Identifier;
  value: Expression;
}

export interface LambdaExpression extends ASTNode {
  type: "LambdaExpression";
  parameters: Parameter[];
  body: Expression | BlockStatement;
}

/**
 * Patterns (for match and receive)
 */
export type Pattern =
  | IdentifierPattern
  | LiteralPattern
  | StructPattern
  | EnumPattern
  | WildcardPattern;

export interface IdentifierPattern extends ASTNode {
  type: "IdentifierPattern";
  name: Identifier;
}

export interface LiteralPattern extends ASTNode {
  type: "LiteralPattern";
  value: Literal;
}

export interface StructPattern extends ASTNode {
  type: "StructPattern";
  typeName: Identifier;
  fields: PatternField[];
}

export interface PatternField extends ASTNode {
  type: "PatternField";
  name: Identifier;
  pattern: Pattern;
}

export interface EnumPattern extends ASTNode {
  type: "EnumPattern";
  variant: Identifier;
  data?: Pattern[];
}

export interface WildcardPattern extends ASTNode {
  type: "WildcardPattern"; // _
}

// ===== PHASE 8.1.5 - Body Content Types =====

/**
 * Config block in task body
 * Example: config { interval: 5s, port: 8080 }
 */
export interface ConfigBlock extends ASTNode {
  type: "ConfigBlock";
  properties: ConfigProperty[];
}

export interface ConfigProperty extends ASTNode {
  type: "ConfigProperty";
  key: Identifier;
  value: Expression | Literal;
}

/**
 * Lifecycle hook in task body
 * Example: on_connect { log "Connected" }
 */
export interface LifecycleHook extends ASTNode {
  type: "LifecycleHook";
  event:
    | "on_connect"
    | "on_disconnect"
    | "on_reconnect"
    | "on_start"
    | "on_stop"
    | "on_error";
  body: BlockStatement;
}

/**
 * Device body properties
 * Example: device sensor { ip: "...", sensors: [...], lifecycle: {...} }
 */
export interface DeviceBody extends ASTNode {
  type: "DeviceBody";
  reference?: ReferenceSection; // Code generation metadata (NEW - Phase device reference)
  properties: DeviceProperty[];
}

/**
 * Reference section for code generation (@embedded targets)
 * Example: reference { @c/c++ { include: <DHT.h>, library: "...", use: ..., init: ... } }
 */
export interface ReferenceSection extends ASTNode {
  type: "ReferenceSection";
  languages: LanguageReference[];
}

export interface LanguageReference extends ASTNode {
  type: "LanguageReference";
  target: string; // 'c/c++' | 'rust' | 'micropython'
  name?: Literal; // Optional name for snippet reference (string literal)
  fields: ReferenceField[];
}

export interface ReferenceField extends ASTNode {
  type: "ReferenceField";
  key: "include" | "library" | "use" | "init" | "import";
  value: Literal | CodeBlock;
}

/**
 * Code block for use/init fields
 * Can be simple identifier, expression, or multi-line block
 */
export interface CodeBlock extends ASTNode {
  type: "CodeBlock";
  content: string; // Raw code content (e.g., "DHT dht;" or "dht.begin(4, DHT22);")
}

/**
 * Device property with type and optional default value
 * Example: location: str : "kitchen"
 */
export interface PropertyWithDefault extends ASTNode {
  type: "PropertyWithDefault";
  typeRef: TypeReference;
  defaultValue: Expression;
}

export interface DeviceProperty extends ASTNode {
  type: "DeviceProperty";
  key: Identifier;
  value: Expression | DeviceNestedBlock | TypeReference | PropertyWithDefault;
}

/**
 * Nested block in device (lifecycle, hardware)
 * Example: lifecycle { track_restarts: true }
 */
export interface DeviceNestedBlock extends ASTNode {
  type: "DeviceNestedBlock";
  name: Identifier; // 'lifecycle' | 'hardware'
  properties: DeviceProperty[];
}

/**
 * Task body with structured content
 * Replaces generic BlockStatement for task declarations
 */
export interface TaskBody extends ASTNode {
  type: "TaskBody";
  config?: ConfigBlock;
  lifecycle: LifecycleHook[];
  statements: Statement[];
}
