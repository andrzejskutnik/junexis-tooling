import { format, isFormatted } from '../formatter';

describe('Formatter', () => {
    it('formats simple task declaration', () => {
        const input = `task Foo(){}`;
        const expected = `task Foo() {}\n`;
        expect(format(input)).toBe(expected);
    });

    it('returns true for already formatted code', () => {
        const code = `task Foo() {}\n`;
        expect(isFormatted(code)).toBe(true);
    });

    it('returns false for unformatted code', () => {
        const code = `task Foo(){}`;
        expect(isFormatted(code)).toBe(false);
    });

    it('normalizes symbolic logical operators to words', () => {
        const input = `task Logic(){a||b&&!c;}`;
        const expected = `task Logic() {
  a or b and not c;
}\n`;
        expect(format(input)).toBe(expected);
    });
});
