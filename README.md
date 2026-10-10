# Junexis Tooling

Publiczne repozytorium narzędzi deweloperskich dla języka Junexis.

> **Status:** wczesny etap rozwoju. Rozszerzenie VS Code jest głównym,
> najbardziej kompletnym elementem; pozostałe narzędzia są eksperymentalne.

## Cel

`junexis-tooling` jest miejscem, w którym Junexis spotyka się z codzienną pracą
dewelopera. To tutaj znajdują się narzędzia edytorowe, pomocnicze i
developerskie, które mają sprawić, że język, compiler i platforma będą
dostępne w praktyce, a nie tylko jako kontrakt architektoniczny.

## Co działa dziś

Najbardziej kompletnym elementem repozytorium jest `vscode-extension/`.
Formatter, parser, docs-lint i definicje podświetlania składni są rozwijane
niezależnie i mają charakter eksperymentalny.

Nowy czytelnik powinien zrozumieć to tak:

- VS Code extension jest dzisiejszym front door tego repo,
- formatter, parser, docs-lint i syntax-highlighting są eksperymentalnymi
	narzędziami pomocniczymi,
- semantyka języka nadal canonicalnie należy do `junexis-lang`,
- tooling buduje workflow wokół tej semantyki, a nie przejmuje ownership nad
	samą definicją języka.

## Szybki start

Jeśli chcesz zobaczyć najbardziej namacalny fragment repo, wejdź najpierw do:

- [vscode-extension/README.md](vscode-extension/README.md)

Lokalne budowanie rozszerzenia:

```bash
cd junexis-tooling/vscode-extension
npm install
npm run compile
```

Jeśli potrzebujesz backendów compiler/LSP, najpierw zbuduj `junexis-lang`.

## Jak czytać to README

Pierwsza część ma odpowiedzieć na pytanie, jaka jest rola tooling w platformie
i co faktycznie działa dziś. Dalsza część schodzi poziom niżej: do zawartości
repo, kontraktu z `junexis-lang`, modelu działania extension i stanu migracji.

> Rozszerzenie VS Code korzysta z lokalnych funkcji uzupełniających oraz
> backendów CLI z `junexis-lang`. Szczegóły integracji i ograniczenia opisuje
> [dokumentacja rozszerzenia](vscode-extension/README.md).

## Docelowa rola repo

`junexis-tooling` ma być ownerem narzędzi deweloperskich platformy Junexis, w szczególności:

- VS Code extension,
- formattera języka,
- parser tooling używanego przez narzędzia pomocnicze,
- docs-lint i walidacji doc hygiene,
- syntax-highlighting dla editorów i dokumentacji.

Kanonowym źródłem semantyki języka i gramatyki pozostaje
[`junexis-lang`](https://github.com/andrzejskutnik/junexis-lang).

Kontrakt wspólny dla rozszerzenia VS Code i Junexis Studio:
[TOOLING_CONSISTENCY_CONTRACT.md](TOOLING_CONSISTENCY_CONTRACT.md).

## Zawartość

### `vscode-extension/`

Rozszerzenie VS Code z obsługą języka JunexisLang (`.jnx`):

- podświetlanie składni (TextMate grammar)
- snippety
- diagnostyki z kompilatora JunexisLang
- sprawdzanie przy wpisywaniu i zapisie
- komenda `Compile file`
- fallback language features działające lokalnie w extension

Szczegóły: [vscode-extension/README.md](vscode-extension/README.md)

### Narzędzia eksperymentalne

- `formatter/` — formatter kodu Junexis,
- `parser/` — parser pomocniczy używany między innymi przez formatter,
- `docs-lint/` — skrypty do sprawdzania wybranych reguł dokumentacji,
- `syntax-highlighting/` — definicje podświetlania składni.

### `docs-lint/`

Zestaw lekkich skryptów PowerShell do walidacji dokumentacji między repozytoriami.

Aktualnie zawiera:

- walidację linków `Available Languages`,
- walidację położenia sekcji statusu.

Szczegóły: [docs-lint/README.md](docs-lint/README.md)

### `syntax-highlighting/`

Zestaw definicji highlightingu dla dokumentacji i lekkich integracji webowych.

Aktualnie zawiera:

- Prism.js language definition,
- demo HTML,
- przykładowy plik testowy.

Szczegóły: [syntax-highlighting/README.md](syntax-highlighting/README.md)

### `formatter/`

Formatter i jego testy są dostępne jako eksperymentalny pakiet TypeScript.
Zależność na `@junexislang/parser` jest lokalna (`../parser`).

Szczegóły: [formatter/README.md](formatter/README.md)

### `parser/`

Parser pomocniczy udostępnia AST Junexis i jest zależnością formattera.

Szczegóły: [parser/package.json](parser/package.json)

## Aktualny kontrakt z `junexis-lang`

Rozszerzenie jest dziś zależne od backendów budowanych lub uruchamianych z repo `junexis-lang`:

- `JunexisLang.Compiler.CLI` — używany do `check` i `compile`
- `JunexisLang.Compiler.LspHost` — wykrywany przez extension, ale nie jest jeszcze podstawowym kanałem runtime

Do diagnostyki i kompilacji plików `.jnx` rozszerzenie wymaga CLI z
`junexis-lang`; nie jest samodzielnym kompilatorem.

## Wymagania

- VS Code `>= 1.85`
- działający backend z `junexis-lang` albo kompatybilny `junexis` CLI dla diagnostyk i kompilacji

## Preferowana ścieżka developerska

```bash
cd junexis-lang
dotnet build compiler/JunexisLang.Compiler.slnx -c Release
```

Następnie extension może wykryć backend automatycznie z lokalnego workspace albo można jawnie wskazać ścieżkę do CLI/LSP.

## Model działania extension

Obecny runtime wygląda tak:

1. aktywacja lokalnych fallback language features,
2. wykrycie backendów `CLI` i `LspHost`,
3. użycie `CLI` do diagnostyk oraz komendy compile,
4. opcjonalne wykorzystanie `LspHost` po dopięciu pełnego kontraktu runtime.

W praktyce oznacza to, że extension już teraz ma kod gotowy na `LspHost`, ale operacyjnie opiera się głównie na fallback + CLI.

## Budowanie rozszerzenia

```bash
cd junexis-tooling/vscode-extension
npm install
npm run compile
```

## Dokumenty repo

- [TOOLING_CONSISTENCY_CONTRACT.md](TOOLING_CONSISTENCY_CONTRACT.md) — wspólne źródła prawdy, Build, debug i bramy zgodności
- [vscode-extension/README.md](vscode-extension/README.md) — szczegóły extension
