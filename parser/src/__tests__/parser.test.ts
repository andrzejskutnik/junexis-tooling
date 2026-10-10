/**
 * Basic smoke tests for junexislang parser
 * Tests declaration parsing and AST generation
 */

import { parse, Lexer } from '../index';

describe('junexislang Parser', () => {
    describe('Type Declarations', () => {
        test('should parse simple type declaration', () => {
            const source = `
type SensorData {
    temperature: f32,
    humidity: f32
}`;
            const ast = parse(source);

            expect(ast.type).toBe('Program');
            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('TypeDeclaration');

            const typeDecl = ast.body[0] as any;
            expect(typeDecl.name.name).toBe('SensorData');
            expect(typeDecl.definition.type).toBe('StructType');
            expect(typeDecl.definition.fields).toHaveLength(2);
            expect(typeDecl.definition.fields[0].name.name).toBe('temperature');
            expect(typeDecl.definition.fields[1].name.name).toBe('humidity');
        });
    });

    describe('Enum Declarations', () => {
        test('should parse enum with variants', () => {
            const source = `
enum AlertLevel {
    Normal,
    Warning,
    Critical
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('EnumDeclaration');

            const enumDecl = ast.body[0] as any;
            expect(enumDecl.name.name).toBe('AlertLevel');
            expect(enumDecl.variants).toHaveLength(3);
            expect(enumDecl.variants[0].name.name).toBe('Normal');
            expect(enumDecl.variants[1].name.name).toBe('Warning');
            expect(enumDecl.variants[2].name.name).toBe('Critical');
        });
    });

    describe('Function Declarations', () => {
        test('should parse function with parameters and return type', () => {
            const source = `
fn process_data(input: SensorData) -> AlertLevel {
    return Normal;
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('FunctionDeclaration');

            const fnDecl = ast.body[0] as any;
            expect(fnDecl.name.name).toBe('process_data');
            expect(fnDecl.parameters).toHaveLength(1);
            expect(fnDecl.parameters[0].name.name).toBe('input');
            expect(fnDecl.returnType.name.name).toBe('AlertLevel');
        });
    });

    describe('Task Declarations', () => {
        test('should parse task with platform annotation', () => {
            const source = `
task TemperatureSensor(sensor_id: str) @embedded(
    cores = 1,
    memory = "64KB"
) -> chan<SensorData> {
    let data = chan<SensorData>::new();
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('TaskDeclaration');

            const taskDecl = ast.body[0] as any;
            expect(taskDecl.name.name).toBe('TemperatureSensor');
            expect(taskDecl.parameters).toHaveLength(1);
            expect(taskDecl.platformAnnotation).toBeDefined();
            expect(taskDecl.platformAnnotation.platform).toBe('embedded');
            expect(taskDecl.platformAnnotation.config.cores.value).toBe(1);
            expect(taskDecl.platformAnnotation.config.memory.value).toBe('64KB');
            expect(taskDecl.returnType.type).toBe('ChannelType');
            expect(taskDecl.returnType.elementType.name.name).toBe('SensorData');
        });
    });

    describe('Multiple Declarations', () => {
        test('should parse multiple declarations', () => {
            const source = `
type SensorData {
    temperature: f32
}

enum AlertLevel {
    Normal,
    Critical
}

fn process(data: SensorData) -> AlertLevel {
    return Normal;
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(3);
            expect(ast.body[0].type).toBe('TypeDeclaration');
            expect(ast.body[1].type).toBe('EnumDeclaration');
            expect(ast.body[2].type).toBe('FunctionDeclaration');
        });
    });

    describe('Lexer', () => {
        test('should tokenize keywords correctly', () => {
            const lexer = new Lexer('task type enum fn');
            const tokens = lexer.tokenize();

            expect(tokens).toHaveLength(5); // 4 keywords + EOF
            expect(tokens[0].type).toBe('TASK');
            expect(tokens[1].type).toBe('TYPE');
            expect(tokens[2].type).toBe('ENUM');
            expect(tokens[3].type).toBe('FN');
            expect(tokens[4].type).toBe('EOF');
        });

        test('should tokenize identifiers and operators', () => {
            const lexer = new Lexer('data: chan<Message> -> Result');
            const tokens = lexer.tokenize();

            expect(tokens[0].type).toBe('IDENTIFIER');
            expect(tokens[0].value).toBe('data');
            expect(tokens[1].type).toBe('COLON');
            expect(tokens[2].type).toBe('CHAN');
            expect(tokens[3].type).toBe('LESS');
            expect(tokens[4].type).toBe('IDENTIFIER');
            expect(tokens[4].value).toBe('Message');
            expect(tokens[5].type).toBe('GREATER');
            expect(tokens[6].type).toBe('ARROW');
        });

        test.each([
            ['or', 'DOUBLE_PIPE'],
            ['||', 'DOUBLE_PIPE'],
            ['and', 'DOUBLE_AMPERSAND'],
            ['&&', 'DOUBLE_AMPERSAND'],
            ['not', 'NOT'],
            ['!', 'NOT'],
        ])('should tokenize logical alias %s as %s', (source, expectedType) => {
            const tokens = new Lexer(source).tokenize();
            expect(tokens[0].type).toBe(expectedType);
        });

        test('should normalize logical aliases in AST', () => {
            const ast = parse(`
task Logic(a: Bool, b: Bool, c: Bool) {
    a || b && !c;
}`);
            const task = ast.body[0] as any;
            const expression = task.body.statements[0].expression;

            expect(expression.operator).toBe('or');
            expect(expression.right.operator).toBe('and');
            expect(expression.right.right.operator).toBe('not');
        });
    });

    describe('Error Handling', () => {
        test('should handle empty source', () => {
            const ast = parse('');
            expect(ast.type).toBe('Program');
            expect(ast.body).toHaveLength(0);
        });

        test('should handle comments', () => {
            const source = `
// This is a comment
type Data {
    value: i32
}
/* Multi-line
   comment */
enum State { Active }`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(2);
            expect(ast.body[0].type).toBe('TypeDeclaration');
            expect(ast.body[1].type).toBe('EnumDeclaration');
        });
    });

    describe('Body Content Parsing (Phase 8.1.5c)', () => {
        test('should parse task with config block', () => {
            const source = `
task ProcessData() @server {
    config {
        port: 8080,
        timeout: 30
    }
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('TaskDeclaration');

            const task = ast.body[0] as any;
            expect(task.name.name).toBe('ProcessData');
            expect(task.body.type).toBe('TaskBody');
            expect(task.body.config).toBeDefined();
            expect(task.body.config.type).toBe('ConfigBlock');
            expect(task.body.config.properties).toHaveLength(2);
            expect(task.body.config.properties[0].key.name).toBe('port');
            expect(task.body.config.properties[0].value.value).toBe(8080);
            expect(task.body.config.properties[1].key.name).toBe('timeout');
            expect(task.body.config.properties[1].value.value).toBe(30);
            expect(task.body.statements).toHaveLength(0);
        });

        test('should parse device with config block', () => {
            const source = `
device sensor_kitchen {
    config {
        ip: str : "192.168.1.22"
    }
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('DeviceDeclaration');

            const device = ast.body[0] as any;
            expect(device.name.name).toBe('sensor_kitchen');

            expect(device.body).toBeDefined();
            expect(device.body.type).toBe('DeviceBody');
            expect(device.body.properties).toHaveLength(1);

            const configProp = device.body.properties[0];
            expect(configProp.key.name).toBe('config');
            expect(configProp.value.type).toBe('DeviceNestedBlock');
            expect(configProp.value.name.name).toBe('config');
            expect(configProp.value.properties).toHaveLength(1);
            expect(configProp.value.properties[0].key.name).toBe('ip');
            expect(configProp.value.properties[0].value.type).toBe('PropertyWithDefault');
            expect(configProp.value.properties[0].value.defaultValue.value).toBe('192.168.1.22');
        });

        test('should parse task with multiple statements', () => {
            const source = `
task Calculate() -> i32 {
    let x = 10;
    let y = 20;
    return x + y;
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            const task = ast.body[0] as any;
            expect(task.body.statements).toHaveLength(3);

            // First statement: let x = 10
            expect(task.body.statements[0].type).toBe('LetStatement');
            expect(task.body.statements[0].name.name).toBe('x');
            expect(task.body.statements[0].initializer.type).toBe('Literal');
            expect(task.body.statements[0].initializer.value).toBe(10);

            // Second statement: let y = 20
            expect(task.body.statements[1].type).toBe('LetStatement');
            expect(task.body.statements[1].name.name).toBe('y');
            expect(task.body.statements[1].initializer.value).toBe(20);

            // Third statement: return x + y
            expect(task.body.statements[2].type).toBe('ReturnStatement');
            expect(task.body.statements[2].value.type).toBe('BinaryExpression');
            expect(task.body.statements[2].value.operator).toBe('+');
        });

        test('should parse nested object literals', () => {
            const source = `
task Configure() {
    config {
        server: {
            host: "localhost",
            port: 8080
        },
        timeout: 30
    }
}`;
            const ast = parse(source);

            const task = ast.body[0] as any;

            expect(task.body.type).toBe('TaskBody');
            expect(task.body.config).toBeDefined();
            expect(task.body.config.properties).toHaveLength(2);

            const serverProp = task.body.config.properties[0];
            expect(serverProp.key.name).toBe('server');
            expect(serverProp.value.type).toBe('ObjectExpression');
            expect(serverProp.value.properties).toHaveLength(2);
            expect(serverProp.value.properties[0].key.name).toBe('host');
            expect(serverProp.value.properties[1].key.name).toBe('port');
        });
    });

    describe('Device Reference Section', () => {
        test('should parse device with basic reference section', () => {
            const source = `
device sensor_kitchen @embedded(esp32c3) {
    reference {
        @c/c++ {
            include: <DHT.h>;
        }
    }
}`;
            const ast = parse(source);

            expect(ast.body).toHaveLength(1);
            expect(ast.body[0].type).toBe('DeviceDeclaration');

            const device = ast.body[0] as any;
            expect(device.name.name).toBe('sensor_kitchen');
            expect(device.platformAnnotation).toBeDefined();
            expect(device.platformAnnotation.platform).toBe('embedded');
            expect(device.platformAnnotation.config).toBe('esp32c3');

            // Check reference section
            expect(device.body.reference).toBeDefined();
            expect(device.body.reference.type).toBe('ReferenceSection');
            expect(device.body.reference.languages).toHaveLength(1);

            // Check language reference (@c/c++)
            const langRef = device.body.reference.languages[0];
            expect(langRef.type).toBe('LanguageReference');
            expect(langRef.target).toBe('c/c++');
            expect(langRef.fields).toHaveLength(1);

            // Check reference field (include)
            const includeField = langRef.fields[0];
            expect(includeField.type).toBe('ReferenceField');
            expect(includeField.key).toBe('include');
            expect(includeField.value.type).toBe('CodeBlock');
            expect(includeField.value.content).toContain('DHT');
        });

        test('should parse reference section with multiple fields', () => {
            const source = `
device sensor @embedded(esp32c3) {
    reference {
        @c/c++ "DHT22 Sensor" {
            include: <DHT.h>;
            library: adafruit/DHT-sensor-library;
            declare: DHT dht;
            import: "dht22_adafruit";
        }
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            const langRef = device.body.reference.languages[0];

            expect(langRef.target).toBe('c/c++');
            expect(langRef.name).toBeDefined();
            expect(langRef.name.type).toBe('Literal');
            expect(langRef.name.value).toBe('DHT22 Sensor');
            expect(langRef.fields).toHaveLength(4);

            // Verify all fields (CodeBlock values without quotes)
            expect(langRef.fields[0].key).toBe('include');
            expect(langRef.fields[0].value.type).toBe('CodeBlock');
            expect(langRef.fields[0].value.content).toContain('DHT');

            expect(langRef.fields[1].key).toBe('library');
            expect(langRef.fields[1].value.type).toBe('CodeBlock');
            expect(langRef.fields[1].value.content).toContain('adafruit');

            expect(langRef.fields[2].key).toBe('declare');
            expect(langRef.fields[2].value.type).toBe('CodeBlock');
            expect(langRef.fields[2].value.content).toContain('DHT');

            expect(langRef.fields[3].key).toBe('import');
            expect(langRef.fields[3].value.type).toBe('Literal');
            expect(langRef.fields[3].value.value).toBe('dht22_adafruit');
        });

        test('should parse reference section with multiple languages', () => {
            const source = `
device sensor @embedded(esp32c3) {
    reference {
        @c/c++ {
            include: <DHT.h>;
            declare: DHT dht;
        }
        @rust {
            declare: use dht_sensor::DHT22;
        }
        @micropython {
            import: from machine import Pin;
        }
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            const refSection = device.body.reference;

            expect(refSection.languages).toHaveLength(3);

            // C/C++
            expect(refSection.languages[0].target).toBe('c/c++');
            expect(refSection.languages[0].fields).toHaveLength(2);

            // Rust
            expect(refSection.languages[1].target).toBe('rust');
            expect(refSection.languages[1].fields).toHaveLength(1);
            expect(refSection.languages[1].fields[0].key).toBe('declare');

            // MicroPython
            expect(refSection.languages[2].target).toBe('micropython');
            expect(refSection.languages[2].fields).toHaveLength(1);
            expect(refSection.languages[2].fields[0].key).toBe('import');
        });

        test('should parse reference section with import directive', () => {
            const source = `
device sensor_kitchen @embedded(esp32c3) {
    reference {
        @c/c++ {
            import: "dht22_adafruit";
        }
    }
    hardware {
        dht22_pin: u8 : 4
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            const langRef = device.body.reference.languages[0];

            expect(langRef.fields).toHaveLength(1);
            expect(langRef.fields[0].key).toBe('import');
            expect(langRef.fields[0].value.type).toBe('Literal');
            expect(langRef.fields[0].value.value).toBe('dht22_adafruit');

            // Verify hardware section still works
            expect(device.body.properties).toBeDefined();
            expect(device.body.properties.length).toBeGreaterThan(0);
        });

        test('should handle reference section without name', () => {
            const source = `
device sensor @embedded(esp32c3) {
    reference {
        @c/c++ {
            include: <Arduino.h>;
        }
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            const langRef = device.body.reference.languages[0];

            expect(langRef.name).toBeUndefined();
            expect(langRef.target).toBe('c/c++');
        });

        test('should parse device with reference AND hardware sections', () => {
            const source = `
device esp32_probe @embedded(esp32c3) {
    reference {
        @c/c++ "ILI9341 TFT Display" {
            include: <ILI9341_t3.h>;
            library: bodmer/TFT_eSPI;
            use: ILI9341_t3 display = ILI9341_t3(5, 16, 17);
            init: display.begin();
        }
    }
    hardware {
        tft_cs: u8 : 5
        tft_dc: u8 : 16
        tft_rst: u8 : 17
    }
    network {
        ip: str : "192.168.1.100"
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            expect(device.body).toBeDefined();

            // Reference section
            expect(device.body.reference).toBeDefined();
            expect(device.body.reference.languages).toHaveLength(1);
            expect(device.body.reference.languages[0].target).toBe('c/c++');
            expect(device.body.reference.languages[0].fields).toHaveLength(4);

            // Hardware and network sections
            expect(device.body.properties).toBeDefined();
            expect(device.body.properties.length).toBeGreaterThan(0);

            // Verify both sections coexist
            const hasHardware = device.body.properties.some((p: any) => p.key?.name === 'hardware');
            const hasNetwork = device.body.properties.some((p: any) => p.key?.name === 'network');
            expect(hasHardware || hasNetwork).toBeTruthy();
        });

        test('should handle empty reference section', () => {
            const source = `
device sensor @embedded(esp32c3) {
    reference {
    }
    hardware {
        pin: u8 : 4
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            expect(device.body.reference).toBeDefined();
            expect(device.body.reference.type).toBe('ReferenceSection');
            expect(device.body.reference.languages).toHaveLength(0);
        });

        test('should parse reference field with special characters in value', () => {
            const source = `
device sensor @embedded(esp32c3) {
    reference {
        @c/c++ {
            library: adafruit/DHT-sensor-library@^1.4.6;
            init: dht.begin(hardware.dht22_pin, DHT22);
        }
    }
    hardware {
        dht22_pin: u8 : 4
    }
}`;
            const ast = parse(source);

            const device = ast.body[0] as any;
            expect(device.body).toBeDefined();
            const fields = device.body.reference.languages[0].fields;

            expect(fields[0].value.type).toBe('CodeBlock');
            expect(fields[0].value.content).toContain('adafruit');
            expect(fields[0].value.content).toContain('DHT');
            expect(fields[1].value.type).toBe('CodeBlock');
            expect(fields[1].value.content).toContain('hardware');
            expect(fields[1].value.content).toContain('dht22_pin');
        });
    });
});
