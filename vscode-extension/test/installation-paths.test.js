const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { installedLspDirectory } = require('../out/installation-paths.js');

test('installed LSP path follows the Junexis platform contract', () => {
    assert.equal(
        installedLspDirectory('win32', 'C:\\Users\\tester', 'C:\\Users\\tester\\AppData\\Local'),
        path.join('C:\\Users\\tester\\AppData\\Local', 'Junexis', 'lsp'));
    assert.equal(
        installedLspDirectory('darwin', '/Users/tester'),
        path.join('/Users/tester', 'Library', 'Application Support', 'Junexis', 'lsp'));
    assert.equal(
        installedLspDirectory('linux', '/home/tester'),
        path.join('/home/tester', '.local', 'share', 'junexis', 'lsp'));
});
