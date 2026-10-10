# Syntax Highlighting Test Cases

```junexis
task Example() @server -> chan<Data> {
  retry { max_attempts: 3 } {
    send process_data();
  }
}
```

```junexis
narrative "Telemetry" {
  intent ["observe system"]
  stakeholders { team: "ops" }
  trace full
}
```

```junexis
device sensor @embedded(esp32_c3) {
  hardware {
    pin: 4
  }
}
```