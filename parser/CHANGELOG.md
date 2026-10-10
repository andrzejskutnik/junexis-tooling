# Changelog - @junexislang/parser

All notable changes to the junexislang parser will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2025-10-31

### Added - Phase 8.2: Comment Trivia System

- **Comment tokenization**: Added 3 new token types to lexer
  - `LINE_COMMENT` - Single-line comments (`//`)
  - `BLOCK_COMMENT` - Multi-line block comments (`/* */`)
  - `DOC_COMMENT` - Documentation comments (`/** */`)
- **AST comment trivia**: Added `Comment` interface and optional fields to `ASTNode`
  - `leadingComments?: Comment[]` - Comments before node
  - `trailingComments?: Comment[]` - Comments after node (same line)
- **Comment attachment logic**: Implemented in parser with boundary tracking
  - `collectLeadingComments()` - Collects comments before current position
  - `collectTrailingComments()` - Collects same-line comments after node
  - `tokenToComment()` - Converts Token to Comment AST node
  - Boundary tracking with `lastConsumedTokenIndex` to prevent over-collection
  - Duplication prevention with `consumedTrailingCommentIndices` Set
- **File header comments**: `Program.leadingComments` for file-level comments

### Changed

- **Lexer**: Replaced `skipWhitespaceAndComments()` with `skipWhitespace()`
  - Comments are now tokenized instead of being skipped
  - `readLineComment()` - Tokenizes line comments (content without `//`)
  - `readBlockComment()` - Tokenizes block/doc comments (preserves formatting)

### Known Limitations

- **Program.leadingComments** includes ALL comments before first keyword token
  - Cannot distinguish file header from first declaration's leading comments
  - Requires NEWLINE token emission for blank line detection (Phase 8.3 improvement)
  - Formatter can use heuristics on raw source for proper separation

## [0.8.2] - 2025-10-26

### Added

- Device body parsing with nested blocks (config, sensors, network, etc.)
- Lifecycle hooks parsing (on_start, on_message, on_error, etc.)
- Task body parsing with config blocks

### Fixed

- Triple-quoted string newline tracking in lexer

## [0.1.0] - Initial Release

- Basic parser implementation with recursive descent
- Support for all junexislang declarations (task, type, enum, fn, pipeline, etc.)
- Platform annotations (@embedded, @server, @report)
- Communication types (chan, queue, stream)
