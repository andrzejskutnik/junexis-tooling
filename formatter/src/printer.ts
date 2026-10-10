import {
    Program,
    Declaration,
    TaskDeclaration,
    TypeDeclaration,
    EnumDeclaration,
    FunctionDeclaration,
    PipelineDeclaration,
    SupervisorDeclaration,
    DeploymentDeclaration,
    NarrativeDeclaration,
    DeviceDeclaration,
    TypeReference,
    Parameter,
    PlatformAnnotation,
    BlockStatement,
    TaskBody,
    ConfigBlock,
    LifecycleHook,
    Comment,
} from '@junexislang/parser';
import { FormatConfig } from './config';

export class Printer {
    private config: FormatConfig;
    private indentLevel = 0;

    constructor(config: FormatConfig) {
        this.config = config;
    }

    private fitsInline(text: string): boolean {
        const margin = 2 * this.indentLevel * this.config.indentSize;
        return text.length + margin <= this.config.lineWidth;
    }

    private printComments(
        comments: Comment[] | undefined,
        position: 'leading' | 'trailing',
        indentStr: string = ''
    ): string {
        if (!comments || comments.length === 0) {
            return '';
        }

        if (position === 'leading') {
            return comments
                .map(comment => {
                    if (comment.type === 'LineComment') {
                        return `${indentStr}//${comment.content}`;
                    }
                    if (comment.type === 'BlockComment' || comment.type === 'DocComment') {
                        const lines = comment.raw.split('\n');
                        return lines.map((line: string) => `${indentStr}${line}`).join('\n');
                    }
                    return '';
                })
                .join('\n') + '\n';
        }

        const comment = comments[0];
        if (comment.type === 'LineComment') {
            return `  //${comment.content}`;
        }
        if (comment.type === 'BlockComment') {
            return `  ${comment.raw}`;
        }
        return '';
    }

    print(program: Program): string {
        const lines: string[] = [];
        const fileHeader = this.printComments(program.leadingComments, 'leading', '');
        if (fileHeader) {
            lines.push(fileHeader.trimEnd());
            lines.push('');
        }

        for (const declaration of program.body) {
            const formatted = this.printDeclaration(declaration);
            if (formatted) {
                lines.push(formatted);
                lines.push('');
            }
        }

        return lines.join('\n').trimEnd() + '\n';
    }

    private printDeclaration(declaration: Declaration): string {
        switch (declaration.type) {
            case 'TaskDeclaration':
                return this.printTask(declaration);
            case 'TypeDeclaration':
                return this.printType(declaration);
            case 'EnumDeclaration':
                return this.printEnum(declaration);
            case 'FunctionDeclaration':
                return this.printFunction(declaration);
            case 'PipelineDeclaration':
                return this.printPipeline(declaration);
            case 'SupervisorDeclaration':
                return this.printSupervisor(declaration);
            case 'DeploymentDeclaration':
                return this.printDeployment(declaration);
            case 'NarrativeDeclaration':
                return this.printNarrative(declaration);
            case 'DeviceDeclaration':
                return this.printDevice(declaration);
            default:
                return '';
        }
    }

    private printTask(task: TaskDeclaration): string {
        const leadingComments = this.printComments(task.leadingComments, 'leading', '');
        const name = task.name.name;
        const params = this.printParameters(task.parameters);
        const platform = task.platformAnnotation ? ' ' + this.printPlatformAnnotation(task.platformAnnotation) : '';
        const returnType = task.returnType ? ' -> ' + this.printTypeReference(task.returnType) : '';

        let body: string;
        if (task.body) {
            if (task.body.type === 'TaskBody') {
                body = ' ' + this.printTaskBody(task.body as TaskBody);
            } else {
                body = ' ' + this.printBlockStatement(task.body as BlockStatement);
            }
        } else {
            body = ' {}';
        }

        const trailingComments = this.printComments(task.trailingComments, 'trailing');

        if (this.shouldBreakParams(task.parameters)) {
            const paramsMultiLine = this.printParametersMultiLine(task.parameters);
            const taskDecl = `task ${name}(\n${paramsMultiLine}\n)${platform}${returnType}${body}${trailingComments}`;
            return leadingComments ? leadingComments + taskDecl : taskDecl;
        }

        const taskDecl = `task ${name}(${params})${platform}${returnType}${body}${trailingComments}`;
        return leadingComments ? leadingComments + taskDecl : taskDecl;
    }

    private printType(type: TypeDeclaration): string {
        const leadingComments = this.printComments(type.leadingComments, 'leading', '');
        const name = type.name.name;
        const trailingComments = this.printComments(type.trailingComments, 'trailing');

        if (type.definition.type === 'StructType') {
            this.indentLevel++;
            const fields = type.definition.fields
                .map((field: any) => `${this.indent()}${field.name.name}: ${this.printTypeReference(field.fieldType)}`)
                .join(',\n');
            this.indentLevel--;

            const typeDecl = `type ${name} {\n${fields}\n}${trailingComments}`;
            return leadingComments ? leadingComments + typeDecl : typeDecl;
        }

        const definition = this.printTypeReference(type.definition);
        const typeDecl = `type ${name} = ${definition}${trailingComments}`;
        return leadingComments ? leadingComments + typeDecl : typeDecl;
    }

    private printEnum(enumDecl: EnumDeclaration): string {
        const leadingComments = this.printComments(enumDecl.leadingComments, 'leading', '');
        const name = enumDecl.name.name;
        this.indentLevel++;
        const variants = enumDecl.variants.map((v: any) => `${this.indent()}${v.name.name}`).join(',\n');
        this.indentLevel--;
        const trailingComments = this.printComments(enumDecl.trailingComments, 'trailing');
        const enumDeclaration = `enum ${name} {\n${variants}\n}${trailingComments}`;
        return leadingComments ? leadingComments + enumDeclaration : enumDeclaration;
    }

    private printFunction(fn: FunctionDeclaration): string {
        const leadingComments = this.printComments(fn.leadingComments, 'leading', '');
        const name = fn.name.name;
        const params = this.printParameters(fn.parameters);
        const returnType = this.printTypeReference(fn.returnType);
        const trailingComments = this.printComments(fn.trailingComments, 'trailing');

        if (this.shouldBreakParams(fn.parameters)) {
            const paramsMultiLine = this.printParametersMultiLine(fn.parameters);
            const fnDecl = `fn ${name}(\n${paramsMultiLine}\n) -> ${returnType} {}${trailingComments}`;
            return leadingComments ? leadingComments + fnDecl : fnDecl;
        }

        const fnDecl = `fn ${name}(${params}) -> ${returnType} {}${trailingComments}`;
        return leadingComments ? leadingComments + fnDecl : fnDecl;
    }

    private printPipeline(pipeline: PipelineDeclaration): string {
        const leadingComments = this.printComments(pipeline.leadingComments, 'leading', '');
        const name = pipeline.name.name;
        const trailingComments = this.printComments(pipeline.trailingComments, 'trailing');

        if (pipeline.stages && pipeline.stages.length > 0) {
            const bodyLines: string[] = ['{'];
            this.indentLevel++;

            for (const stage of pipeline.stages) {
                if (stage.kind === 'use' && stage.target) {
                    bodyLines.push(`${this.indent()}use ${stage.target.name};`);
                }
            }

            this.indentLevel--;
            bodyLines.push(`${this.indent()}}`);
            const pipelineDecl = `pipeline ${name} ${bodyLines.join('\n')}${trailingComments}`;
            return leadingComments ? leadingComments + pipelineDecl : pipelineDecl;
        }

        const pipelineDecl = `pipeline ${name} {}${trailingComments}`;
        return leadingComments ? leadingComments + pipelineDecl : pipelineDecl;
    }

    private printSupervisor(supervisor: SupervisorDeclaration): string {
        const leadingComments = this.printComments(supervisor.leadingComments, 'leading', '');
        const name = supervisor.name.name;
        const trailingComments = this.printComments(supervisor.trailingComments, 'trailing');
        const supervisorDecl = `supervisor ${name} {}${trailingComments}`;
        return leadingComments ? leadingComments + supervisorDecl : supervisorDecl;
    }

    private printDeployment(deployment: DeploymentDeclaration): string {
        const leadingComments = this.printComments(deployment.leadingComments, 'leading', '');
        const cfg = deployment.config || {};
        const keys = Object.keys(cfg);
        const trailingComments = this.printComments(deployment.trailingComments, 'trailing');

        if (keys.length === 0) {
            const deploymentDecl = `deployment {}${trailingComments}`;
            return leadingComments ? leadingComments + deploymentDecl : deploymentDecl;
        }

        const inner: string[] = [];
        for (const key of keys) {
            const value = (cfg as any)[key];
            inner.push(`${this.indent()}${key}: ${this.printPlainValue(value, this.indentLevel + 1)}${this.config.trailingComma ? ',' : ''}`);
        }

        const deploymentDecl = `deployment {\n${inner.join('\n')}\n${this.indent()}}${trailingComments}`;
        return leadingComments ? leadingComments + deploymentDecl : deploymentDecl;
    }

    private printPlainValue(value: any, nextIndentLevel: number): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (Array.isArray(value)) {
            return `[${value.map(v => this.printPlainValue(v, nextIndentLevel)).join(', ')}]`;
        }
        if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, any>);
            if (entries.length === 0) return '{}';
            const saveIndent = this.indentLevel;
            this.indentLevel = nextIndentLevel;
            const lines = entries.map(([k, v]) => `${this.indent()}${k}: ${this.printPlainValue(v, nextIndentLevel + 1)}${this.config.trailingComma ? ',' : ''}`);
            const result = `{\n${lines.join('\n')}\n${this.indent()}}`;
            this.indentLevel = saveIndent;
            return result;
        }
        if (typeof value === 'number') return String(value);

        const str = String(value);
        if (/^[-+]?\d+(?:\.\d+)?$/.test(str)) return str;
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(str)) return str;
        return `"${str.replace(/"/g, '\\"')}"`;
    }

    private printNarrative(narrative: NarrativeDeclaration): string {
        const leadingComments = this.printComments(narrative.leadingComments, 'leading', '');
        const title = narrative.name.value;
        const trailingComments = this.printComments(narrative.trailingComments, 'trailing');
        const narrativeDecl = `narrative "${title}" {}${trailingComments}`;
        return leadingComments ? leadingComments + narrativeDecl : narrativeDecl;
    }

    private printDevice(device: DeviceDeclaration): string {
        const leadingComments = this.printComments(device.leadingComments, 'leading', '');
        const name = device.name.name;
        const platform = device.platformAnnotation ? ' ' + this.printPlatformAnnotation(device.platformAnnotation) : '';
        const trailingComments = this.printComments(device.trailingComments, 'trailing');

        if (device.body) {
            if (device.body.type === 'DeviceBody') {
                const body = this.printDeviceBody(device.body);
                const deviceDecl = `device ${name}${platform} ${body}${trailingComments}`;
                return leadingComments ? leadingComments + deviceDecl : deviceDecl;
            }
        }

        const deviceDecl = `device ${name}${platform} {}${trailingComments}`;
        return leadingComments ? leadingComments + deviceDecl : deviceDecl;
    }

    private printParameters(parameters: Parameter[]): string {
        return parameters.map(param => `${param.name.name}: ${this.printTypeReference(param.paramType)}`).join(', ');
    }

    private printParametersMultiLine(parameters: Parameter[]): string {
        this.indentLevel++;
        const result = parameters.map((param, i) => {
            const comma = i < parameters.length - 1 || this.config.trailingComma ? ',' : '';
            return `${this.indent()}${param.name.name}: ${this.printTypeReference(param.paramType)}${comma}`;
        }).join('\n');
        this.indentLevel--;
        return result;
    }

    private shouldBreakParams(parameters: Parameter[]): boolean {
        if (parameters.length === 0) return false;
        if (parameters.length > 3) return true;
        return this.printParameters(parameters).length > 50;
    }

    private printTypeReference(typeRef: TypeReference): string {
        switch (typeRef.type) {
            case 'SimpleType':
                return typeRef.name.name;
            case 'ChannelType':
                return `chan<${this.printTypeReference(typeRef.elementType)}>`;
            case 'QueueType':
                return `queue<${this.printTypeReference(typeRef.elementType)}>`;
            case 'GenericType':
                return `${typeRef.base.name}<${typeRef.typeArguments.map((arg: TypeReference) => this.printTypeReference(arg)).join(', ')}>`;
            case 'StructType':
                return '{ ... }';
            default:
                return 'unknown';
        }
    }

    private printPlatformAnnotation(annotation: PlatformAnnotation): string {
        const platform = `@${annotation.platform}`;
        if (!annotation.config) {
            return platform;
        }
        if (typeof annotation.config === 'string') {
            return `${platform}(${annotation.config})`;
        }

        const entries = Object.entries(annotation.config);
        const kv = entries.map(([key, expr]) => `${key} = ${this.printExpression(expr as any)}`);
        const inline = `${platform}(${kv.join(', ')})`;
        if (!entries.length || this.fitsInline(inline)) {
            return inline;
        }

        const lines: string[] = [`${platform}(`];
        this.indentLevel++;
        entries.forEach(([key, expr], i) => {
            const comma = i < entries.length - 1 || this.config.trailingComma ? ',' : '';
            lines.push(`${this.indent()}${key} = ${this.printExpression(expr as any)}${comma}`);
        });
        this.indentLevel--;
        lines.push(`${this.indent()})`);
        return lines.join('\n');
    }

    private printTaskBody(taskBody: TaskBody): string {
        const lines: string[] = ['{'];
        this.indentLevel++;

        if (taskBody.config) {
            lines.push(this.indent() + this.printConfigBlock(taskBody.config));
            if (taskBody.lifecycle.length > 0 || taskBody.statements.length > 0) {
                lines.push('');
            }
        }

        if (taskBody.lifecycle && taskBody.lifecycle.length > 0) {
            for (const hook of taskBody.lifecycle) {
                lines.push(this.indent() + this.printLifecycleHook(hook));
            }
            if (taskBody.statements.length > 0) {
                lines.push('');
            }
        }

        for (const stmt of taskBody.statements) {
            const stmtStr = this.printStatement(stmt);
            if (stmtStr) {
                lines.push(this.indent() + stmtStr);
            }
        }

        this.indentLevel--;
        lines.push('}');
        return lines.join('\n');
    }

    private printConfigBlock(config: ConfigBlock): string {
        if (!config.properties || config.properties.length === 0) {
            return 'config {}';
        }

        const lines: string[] = ['config {'];
        this.indentLevel++;
        for (const prop of config.properties) {
            lines.push(`${this.indent()}${prop.key.name}: ${this.printExpression(prop.value as any)}`);
        }
        this.indentLevel--;
        lines.push(this.indent() + '}');
        return lines.join('\n');
    }

    private printLifecycleHook(hook: LifecycleHook): string {
        return `${hook.event} ${this.printBlockStatement(hook.body)}`;
    }

    private printDeviceBody(deviceBody: any): string {
        if (!deviceBody.properties || deviceBody.properties.length === 0) {
            return '{}';
        }

        const lines: string[] = ['{'];
        this.indentLevel++;
        for (const prop of deviceBody.properties) {
            const key = prop.key.name;
            if (prop.value.type === 'DeviceNestedBlock') {
                lines.push(`${this.indent()}${this.printDeviceNestedBlock(prop.value)}`);
            } else {
                lines.push(`${this.indent()}${key}: ${this.printExpression(prop.value as any)}`);
            }
        }
        this.indentLevel--;
        lines.push(this.indent() + '}');
        return lines.join('\n');
    }

    private printDeviceNestedBlock(block: any): string {
        const blockName = block.name.name;
        if (!block.properties || block.properties.length === 0) {
            return `${blockName} {}`;
        }

        const lines: string[] = [`${blockName} {`];
        this.indentLevel++;
        for (const prop of block.properties) {
            lines.push(`${this.indent()}${prop.key.name}: ${this.printExpression(prop.value as any)}`);
        }
        this.indentLevel--;
        lines.push(this.indent() + '}');
        return lines.join('\n');
    }

    private printBlockStatement(block: BlockStatement): string {
        if (!block.statements || block.statements.length === 0) {
            return '{}';
        }

        const lines: string[] = ['{'];
        this.indentLevel++;
        for (const stmt of block.statements) {
            const stmtStr = this.printStatement(stmt);
            if (stmtStr) {
                lines.push(`${this.indent()}${stmtStr}`);
            }
        }
        this.indentLevel--;
        lines.push(`${this.indent()}}`);
        return lines.join('\n');
    }

    private printStatement(statement: any): string {
        switch (statement.type) {
            case 'LetStatement':
                return `let ${statement.name.name} = ${this.printExpression(statement.value)};`;
            case 'ReturnStatement':
                return statement.value ? `return ${this.printExpression(statement.value)};` : 'return;';
            case 'ExpressionStatement':
                return `${this.printExpression(statement.expression)};`;
            default:
                return '';
        }
    }

    private printExpression(expression: any): string {
        if (!expression) return '';
        switch (expression.type) {
            case 'Identifier':
                return expression.name;
            case 'Literal':
                return this.printLiteral(expression);
            case 'BinaryExpression':
                return `${this.printExpression(expression.left)} ${this.normalizeLogicalOperator(expression.operator)} ${this.printExpression(expression.right)}`;
            case 'UnaryExpression': {
                const operator = this.normalizeLogicalOperator(expression.operator);
                const operand = this.printExpression(expression.operand);
                return operator === 'not' ? `not ${operand}` : `${operator}${operand}`;
            }
            case 'ObjectExpression':
                return this.printObjectLiteral(expression);
            case 'ArrayExpression':
                return `[${expression.elements.map((e: any) => this.printExpression(e)).join(', ')}]`;
            default:
                return expression.raw ?? expression.name ?? '...';
        }
    }

    private printObjectLiteral(obj: any): string {
        if (!obj.properties || obj.properties.length === 0) {
            return '{}';
        }
        const parts = obj.properties.map((prop: any) => `${prop.key.name}: ${this.printExpression(prop.value)}`);
        return `{ ${parts.join(', ')} }`;
    }

    private printLiteral(literal: any): string {
        if (typeof literal.value === 'string') {
            return `"${literal.value}"`;
        }
        return String(literal.value);
    }

    private normalizeLogicalOperator(operator: string): string {
        switch (operator) {
            case '||': return 'or';
            case '&&': return 'and';
            case '!': return 'not';
            default: return operator;
        }
    }

    private indent(): string {
        return ' '.repeat(this.indentLevel * this.config.indentSize);
    }
}
