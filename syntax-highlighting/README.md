# junexislang Syntax Highlighting Tools

This directory contains syntax highlighting definitions for junexislang in various documentation and web contexts.

## Available Tools

### 1. Prism.js Language Definition (`prism-junexis.js`)

**Purpose:** Enable syntax highlighting for junexislang code blocks in web documentation, static sites, and lightweight documentation stacks.

**Features:**
- All junexislang keywords (task, type, enum, pipeline, narrative, device, etc.)
- Platform annotations (`@embedded`, `@server`, `@report`)
- Communication types (`chan<T>`, `queue<T>`, `stream<T>`)
- Resilience patterns (`retry`, `circuit_breaker`, `rate_limiter`)
- Device/config references (`device.hardware.pin`, `config.threshold`)
- Narrative attributes (`intent`, `stakeholders`, `compliance`, etc.)
- Strings (including triple-quoted multiline)
- Numbers with units (`10ms`, `32KB`, `5s`)
- Comments (`//` and `/* */`)

## Usage

### In HTML Documentation

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="path/to/prism-junexis.js"></script>
</head>
<body>
  <pre><code class="language-junexis">
task SensorRead() @embedded(esp32) -> chan<SensorData> {
  let pin = device.hardware.dht22_pin;
  every 5s {
    send read_sensor(pin);
  }
}
  </code></pre>
</body>
</html>
```

### In Markdown (with Prism.js)

Use the `junexis` language identifier:

````markdown
```junexis
task Example() @server -> chan<Data> {
  retry { max_attempts: 3 } {
    send process_data();
  }
}
```
````

### With MkDocs

1. Copy `prism-junexis.js` to `docs/javascripts/`
2. Add the script to `mkdocs.yml`

```yaml
extra_javascript:
  - javascripts/prism-junexis.js
```

## Future Directions

### Shiki Integration

Planned path: reuse `junexis.tmLanguage.json` from `vscode-extension/syntaxes/`.

### GitHub Linguist

Planned path: upstream registration for `.jnx` files.

## Supported Syntax Categories

### Keywords
- Control flow: `if`, `else`, `match`, `loop`, `while`, `for`, `break`, `continue`, `return`
- Resilience patterns: `retry`, `circuit_breaker`, `rate_limiter`, `timeout`, `fallback`, `bulkhead`
- Communication: `send`, `recv`, `select`, `spawn`, `every`, `delay`
- Lifecycle hooks: `on_start`, `on_stop`, `on_error`, `on_message`
- Pipeline: `use`, `parallel`, `branch`, `merge`
- Variables: `let`, `mut`, `const`
- Modules: `import`, `export`, `as`, `from`, `in`
- Platform: `memory`, `cores`, `power`, `realtime`

### Declarations
- `task`, `type`, `enum`, `fn`, `pipeline`, `supervisor`, `device`, `narrative`, `deployment`, `project`

### Platform Annotations
- `@embedded`, `@server`, `@report`, `@platform`

### Communication Types
- `chan<T>`, `queue<T>`, `stream<T>`
- `SecureChannel<A,T>`, `BroadcastChannel<T>`, `EventStream<T>`

## Testing

See `test-syntax-highlighting.md` for broad syntax coverage.

### Visual Testing

1. Open `demo.html` in a browser.
2. Verify rendering using `test-syntax-highlighting.md`.

## Related Files

- `../vscode-extension/syntaxes/` — TextMate grammar used by the VS Code extension

---

**Last Updated:** 2026-06-19
**Status:** Prism.js available | Shiki planned | Linguist planned