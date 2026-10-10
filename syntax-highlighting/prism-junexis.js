// Prism.js Language Definition for junexislang
// Usage: Include this file after prism.js in your HTML/documentation
// Example: <script src="prism-junexis.js"></script>
//
// Then use: ```junexis in Markdown or <code class="language-junexis"> in HTML

(function (Prism) {
    Prism.languages.jnx = {
        'comment': [
            {
                pattern: /\/\/.*/,
                greedy: true
            },
            {
                pattern: /\/\*[\s\S]*?\*\//,
                greedy: true
            }
        ],

        'narrative-attribute': {
            pattern: /\b(intent|stakeholders|value_proposition|compliance|story_flow|degraded_semantics|observability|trace|applies_to|clock_policy)\b/,
            alias: 'property'
        },

        'platform-annotation': {
            pattern: /@(embedded|server|report|platform)\b/,
            alias: 'decorator'
        },

        'communication-type': {
            pattern: /\b(chan|queue|stream|SecureChannel|BroadcastChannel|EventStream)<[^>]+>/,
            inside: {
                'keyword': /\b(chan|queue|stream|SecureChannel|BroadcastChannel|EventStream)\b/,
                'type-parameter': {
                    pattern: /<[^>]+>/,
                    inside: {
                        'punctuation': /[<>]/,
                        'type': /\w+/
                    }
                }
            }
        },

        'declaration': {
            pattern: /\b(task|type|enum|fn|pipeline|supervisor|device|narrative|deployment|project)\s+([a-zA-Z_]\w*)/,
            inside: {
                'keyword': /\b(task|type|enum|fn|pipeline|supervisor|device|narrative|deployment|project)\b/,
                'class-name': /[a-zA-Z_]\w*/
            }
        },

        'keyword': [
            /\b(if|else|match|loop|while|for|break|continue|return)\b/,
            /\b(retry|circuit_breaker|rate_limiter|timeout|fallback|bulkhead)\b/,
            /\b(send|recv|select|spawn|every|delay)\b/,
            /\b(on_start|on_stop|on_error|on_message)\b/,
            /\b(use|parallel|branch|merge)\b/,
            /\b(let|mut|const|import|export|as|from|in)\b/,
            /\b(memory|cores|power|realtime)\b/
        ],

        'builtin': /\b(str|bool|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|duration|Time|Map|Vec|Option|Result)\b/,

        'operator': /[+\-*/%=<>!&|^~?:]+|\.{2,3}|->/,

        'string': [
            {
                pattern: /"""[\s\S]*?"""/,
                greedy: true,
                alias: 'multiline'
            },
            {
                pattern: /"(?:\\.|[^\\"\r\n])*"/,
                greedy: true
            }
        ],

        'number': /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:ms|s|m|h|KB|MB|GB)?)\b/,

        'boolean': /\b(?:true|false)\b/,

        'punctuation': /[{}[\]();,.:]/,

        'property': /\b(?:device|config)\.[a-zA-Z_][\w.]*/,

        'function': /\b[a-zA-Z_]\w*(?=\s*\()/,

        'class-name': {
            pattern: /\b[A-Z]\w*\b/,
            alias: 'type'
        }
    };

    Prism.languages.nxs = Prism.languages.jnx;

}(Prism));