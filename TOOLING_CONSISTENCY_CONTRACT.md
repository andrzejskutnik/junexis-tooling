# Junexis Tooling Consistency Contract

Status: baseline P0
Zakres: VS Code Junexis extension i Junexis Studio
Powiązane zadania: JSPI-001, JSPI-009, JSPI-014

## Cel

VS Code i Junexis Studio są dwoma interfejsami tej samej platformy. Nie muszą
implementować identycznego UI ani zastępować możliwości swoich hostów, ale dla
tego samego projektu muszą rozumieć ten sam język, uruchamiać te same
wersjonowane kontrakty i identyfikować ten sam build.

## Źródła prawdy

| Kontrakt | Kanoniczne źródło | Konsumenci |
|---|---|---|
| składnia Junexis | `junexis-lang/grammar/JunexisLang.g4` | parser, LSP, TextMate, Studio XSHD |
| projekt | `junexis.project.toml` i compiler project loader | VS Code, Studio |
| diagnostyki | CLI/LSP oraz `junexis-lang/spec/diagnostics.csv` | Problems/Diagnostics |
| build | CLI output schema `2.0` | VS Code, Studio, Mentor, Narrative |
| artefakty | `junexis.bundle.json` i `junexis.artifacts.json` | Studio, VS Code |
| semantyka edytora | `JunexisLang.Compiler.LspHost` | VS Code, Studio |
| runtime i przyczynowość | wersjonowane API TraceCollector | VS Code, Studio |
| analiza | `junexis.analysis.json` i Mentor CLI | Studio, VS Code |
| polityka Mentora | `.junexis/mentor.yml` schema `1.0` | Studio, VS Code |

Statyczne definicje TextMate i XSHD są artefaktami prezentacji. Nie mogą
wprowadzać słów kluczowych sprzecznych z gramatyką ANTLR. LSP pozostaje
autorytatywny dla diagnostyk i semantycznego kolorowania.

## Wspólny przebieg użytkownika

```text
Open Folder
  -> discover junexis.project.toml
  -> Doctor / tool discovery
  -> Check
  -> Build (CLI schema 2.0)
  -> buildId + bundle + artifacts + debug + analysis
  -> Run/Debug target
  -> Narrative Diagnostic Story
  -> Mentor findings
```

Tryb pojedynczego pliku jest ścieżką compatibility/playground. Nowe funkcje
powinny być projektowane project-first.

## Build

Oba interfejsy wywołują:

```text
junexis build <project-or-file> --json --output-schema 2.0
```

Konsument:

1. odrzuca nieznaną wersję schema zamiast zgadywać layout `out/`,
2. publikuje diagnostyki według ich ścieżek źródłowych,
3. zachowuje `buildId`,
4. korzysta ze ścieżek manifestów zwróconych przez CLI,
5. nie rekonstruuje ścieżek bundle, artifacts, debug ani analysis.

Studio i VS Code czytają `junexis.artifacts.json` schema `1.x` z lokalizacji
zwróconej przez build. Oba hosty sprawdzają zgodność `buildId`, odrzucają
ścieżki bezwzględne oraz traversal poza katalog output i pokazują target, kind,
ownership oraz SHA-256 bez ponownego zgadywania wyniku codegen.

Profile uruchomieniowe zachowują te same granice targetów:

- server używa toolchaina i adaptera Go,
- report używa Node.js / TypeScript i adaptera JavaScript,
- embedded używa PlatformIO; upload jest operacją jawną, a debug wymaga
  konfiguracji sprzętowej.

VS Code deleguje proces i DAP do swojego ekosystemu, a Studio do własnego
rejestru profili. Oba hosty wyznaczają katalog roboczy z artefaktu bieżącego
builda, nie z przypadkowego katalogu procesu.

## Debug i Narrative

Wspólny model ma dwie uzupełniające się warstwy:

```text
Junexis Semantic Debug
  - TraceCollector session
  - tasks, communications, state, trace
  - semantic breakpoints and snapshots
  - causality / Diagnostic Story

Target DAP
  - generated C++ / Go / TypeScript process
  - stack, variables, watches, stepping
  - source-map back to stable Junexis symbols
```

`buildId`, stabilny `symbolId` i source map łączą obie warstwy. DAP odpowiada
„gdzie i z jaką wartością?”, a Narrative „dlaczego do tego doszło?”.

Studio i VS Code konsumują `debug/junexis.source-map.json` schema `1.0`.
Breakpoint `.jnx` jest mapowany najpierw na wszystkie dokładne wpisy
`statement`, następnie na poprzedzający statement, a na końcu na zakres taska.
Condition, hit condition i log message są przenoszone do breakpointów runtime.
Lowering 1:N pozostaje widoczny jako kilka punktów wygenerowanych. Ramka stosu
jest mapowana przez najwęższy zakres wygenerowany, z preferencją statement.
Oba hosty ujawniają stan mapowania: target, build, liczbę breakpointów
źródłowych i runtime oraz ostatni stabilny symbol. Brak source-map lub
niezgodny build jest jawnym stanem błędu, nie cichym fallbackiem.

Rozszerzenie VS Code i Studio konsumują Diagnostic Story schema `1.x`. Widok
może być inny, ale oba pokazują timeline, causal chain, vector-clock-proven
concurrency, stabilne komunikacje i evidence. Finding Mentora jest kontekstem
statycznym i nigdy nie jest przedstawiany jako przyczyna runtime.

Oba hosty uruchamiają Mentor CLI dla `analysisSnapshot` zwróconego przez build,
odrzucają wynik z innym `buildId` i korelują story tylko przez stabilne
`symbolId` tasków, pipeline'ów oraz komunikacji. Ustalenia globalne pozostają
w raporcie Mentora, ale nie są przypisywane do konkretnej historii runtime.

Oba hosty stosują `.junexis/mentor.yml` dopiero po sprawdzeniu bieżącego
`buildId`, ale przed obliczeniem delty i publikacją Problems. Kontrakt 1.0 jest
atomowy: nieznane pole, brak uzasadnienia, niepoprawna data, duplikat lub
wyciszenie bez dokładnego `ruleCode + symbolId` unieważnia cały plik i nie
ukrywa żadnego findingu. Wygasłe wyciszenie pozostaje skonfigurowane, lecz nie
jest stosowane. Oba UI pokazują decyzje, wszystkie wyciszenia i dowód każdego
wyciszenia zastosowanego w bieżącym buildzie.

Decyzja jest wersjonowanym kontekstem projektu i sama nie zmienia werdyktu.
Widoczność findingu zmienia wyłącznie dokładne, uzasadnione i niewygasłe
wyciszenie. Projektowe `presence` nadpisuje ustawienie prezentacji hosta.

## Konfiguracja

Logiczna kolejność rozwiązywania ścieżek narzędzi:

```text
explicit host setting
  -> JUNEXIS_* environment variable
  -> development workspace detection
  -> PATH
```

Host może przechowywać ustawienia natywnie, ale nazwy logiczne, domyślne
wartości i raport diagnostyczny powinny być równoważne.

## Różnice dozwolone

- VS Code może delegować Git, C++, Go, TypeScript i DAP do swojego ekosystemu.
- Studio może dostarczać własne panele, lifecycle procesów i integrację Git.
- Skróty i rozmieszczenie paneli mogą odpowiadać konwencjom hosta.

Różnice nie mogą zmieniać semantyki projektu, argumentów CLI, wersji schema,
`buildId`, identyfikatorów symboli ani interpretacji zdarzeń Narrative.

## Bramy zgodności

W `vscode-extension`:

```powershell
npm test
npm run test:e2e:go-debug
```

Testy sprawdzają parser Build schema 2.0, bezpieczny Artifact Inventory schema
1.x, profile launch dla Go, TypeScript i PlatformIO, debug source-map schema
1.0 i mapowanie breakpointów/ramek, Diagnostic Story schema 1.x, Mentor schema
1.x, Mentor project policy 1.0, atomowe odrzucanie błędnej polityki, expiry,
deltę po zastosowaniu polityki, korelację findings po stabilnych symbolach oraz pokrycie
kanonicznych słów gramatyki ANTLR przez statyczne definicje VS Code i Studio.
Zmiana kontraktu albo gramatyki, która nie zostanie odzwierciedlona w obu
interfejsach, ma przerwać tę bramę.

Druga komenda jest opcjonalną bramą środowiskową Windows. Wymaga Go i Delve,
buduje rzeczywisty server target, wybiera statement z source-map i potwierdza,
że natywny breakpoint zostaje trafiony na wskazanej linii wygenerowanej.
