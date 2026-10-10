# @junexislang/formatter

**Opinionated code formatter for junexislang** - Like Prettier, but for distributed systems.

## Status

Formatter został przeniesiony do `junexis-tooling` jako owner repo dla tooling.

Aktualny stan:

- zależność na `@junexislang/parser` działa lokalnie przez `file:../parser`,
- pakiet buduje się w nowym repo,
- testy formattera przechodzą.

## Philosophy

- **Zero config** - Beautiful defaults out of the box
- **Idempotent** - `format(format(code)) === format(code)`
- **Semantic preservation** - AST-equivalent before and after formatting
- **Fast** - TypeScript native, leverages `@junexislang/parser`

## Features

- Automatic indentation (2 spaces default)
- Consistent spacing around operators (`->`, `:`, `=`)
- Line breaking for long parameter lists
- Vertical alignment for struct fields
- Normalize whitespace in blocks

## Installation

Po odzyskaniu parsera jako sąsiedniego pakietu tooling:

```bash
npm install @junexislang/formatter
```

## Usage

### Programmatic API

```typescript
import { format } from '@junexislang/formatter';

const code = `task Foo(a:i32,b:i32)@server->Result{}`;
const formatted = format(code);
```

## Configuration (optional)

Create `.junexisformat.json`:

```json
{
  "indentSize": 2,
  "lineWidth": 80,
  "trailingComma": true
}
```

## Development

```bash
# Build
npm run build

# Test
npm test
```

## Architecture

```
Source Code -> Parser (AST) -> Formatter (Print Rules) -> Formatted Code
```

## Roadmap

- formatter source migrated to `junexis-tooling`
- parser dependency recovery pending
- CLI packaging pending
- VS Code formatting integration pending

## Related Files

- `../TOOLING_MIGRATION_PLAN.md`
- `../vscode-extension/`
- future sibling package: `../parser/`