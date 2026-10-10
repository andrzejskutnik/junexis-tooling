# Junexis Language — VS Code Extension

Rozszerzenie VS Code z obsługą języka [JunexisLang](https://junexis.dev) (pliki `.jnx`) — języka deklaratywnego do budowania systemów rozproszonych z komunikacją jako obywatelem pierwszej klasy.

## Funkcje

| Funkcja | Opis |
|---|---|
| **Podświetlanie składni** | Pełna gramatyka TextMate — słowa kluczowe, typy, adnotacje platformy, literały |
| **Snippety** | 30+ szablonów: `task`, `pipeline`, `struct`, `fn`, `device`, `supervisor`, `circuit_breaker`, `narrative` i in. |
| **Diagnostyki** | Błędy i ostrzeżenia z kompilatora JunexisLang — wyświetlane bezpośrednio w edytorze |
| **Sprawdzanie przy zapisie** | Automatyczne `junexis check` przy każdym zapisie pliku |
| **Sprawdzanie przy wpisywaniu** | Weryfikacja w locie (debounce 600 ms) |
| **Podświetlanie w Markdown** | Bloki kodu ` ```jnx ` i ` ```junexis ` w plikach Markdown |
| **Komenda Check** | `Junexis: Check file` — ręczna weryfikacja (`Ctrl+Shift+P`) |
| **Komenda Compile** | `Junexis: Compile file` — kompilacja do katalogu `output/` obok pliku |
| **Wersjonowany Build** | Build pliku i projektu weryfikuje atomowy receipt `latest-build` 1.0 oraz wspólny `buildId` tak samo jak Junexis Studio |
| **Artifact Explorer** | Widok Explorer grupuje zweryfikowane artefakty bieżącego buildu według targetu i bezpiecznie otwiera wygenerowane pliki |
| **LSP Host** | Extension potrafi wykryć `JunexisLang.Compiler.LspHost`; ścieżka runtime nadal jest hybrydowa |
| **Project context diagnostics** | `Junexis: Diagnose Setup` pokazuje aktywny plik, `junexis.project.toml`, project root albo świadomy file-mode |
| **Doctor Project** | `Junexis: Doctor Project` uruchamia `junexis doctor` dla wykrytego projektu albo aktywnego pliku `.jnx` |
| **Extern Scaffold** | `Junexis: Scaffold Externs` tworzy brakujące pliki `extern.file` w developer-owned `user/` |
| **Junexis Decorations** | Małe badge/kolory dla `.jnx`, `junexis.project.toml` oraz folderów projektu bez zmiany Twojego icon theme |
| **Junexis Icons** | Opcjonalny pełny file icon theme dla `.jnx`, manifestu i folderów Junexis |
| **Debug UI** | Klient TraceCollectora: taski, trace, stan, wersjonowany Diagnostic Story i demo CNC z manifestem debug |
| **Mentor** | Analiza snapshotu bieżącego buildu, diagnostyki w Problems i bezpieczne wzbogacenie Diagnostic Story po stabilnych symbolach |
| **Breakpoints** | `.jnx` wspiera natywne breakpointy VS Code, synchronizowane z TraceCollector jako source/task breakpoints |

## Wymagania

- VS Code **≥ 1.85**
- Backend z `junexis-lang` — extension preferuje `LspHost`, a `CLI` pozostaje wymagane dla komendy compile i jako fallback dla diagnostyk

## Instalacja kompilatora

### Opcja A — z repozytorium

```bash
cd junexis-lang
dotnet build compiler/JunexisLang.Compiler.slnx -c Release
# Ustaw junexis.cliPath na:
# junexis-lang/compiler/JunexisLang.Compiler.CLI/bin/Release/net10.0/JunexisLang.Compiler.CLI.dll
# Opcjonalnie ustaw junexis.lspPath na:
# junexis-lang/compiler/JunexisLang.Compiler.LspHost/bin/Release/net10.0/JunexisLang.Compiler.LspHost.exe
# Opcjonalnie ustaw junexis.mentorPath na:
# junexis-mentor/JunexisLang.Mentor.CLI/bin/Release/net10.0/JunexisLang.Mentor.CLI.dll
```

### Opcja B — globalny CLI

```bash
dotnet tool install --global JunexisLang.Compiler.CLI
# Po instalacji: junexis --version
```

## Konfiguracja

Ustawienia dostępne w VS Code (`Ctrl+Shift+P` → `Preferences: Open Settings`):

| Klucz | Domyślnie | Opis |
|---|---|---|
| `junexis.cliPath` | `""` | Ścieżka do `junexis.exe` lub `.dll`. Puste = szuka `junexis` w PATH |
| `junexis.lspPath` | `""` | Ścieżka do programu serwera LSP. Puste pole oznacza automatyczne wykrywanie wariantu dla systemu |
| `junexis.mentorPath` | `""` | Ścieżka do Mentor CLI lub `.dll`. Puste = workspace, `JUNEXIS_MENTOR_CLI`, potem PATH |
| `junexis.checkOnSave` | `true` | Sprawdź przy zapisie |
| `junexis.checkOnChange` | `true` | Sprawdź podczas pisania (debounce 600 ms) |
| `junexis.debug.traceCollectorUrl` | `"http://127.0.0.1:8080"` | URL TraceCollector używany przez widoki debugera |
| `junexis.debug.traceCollectorPath` | `""` | Opcjonalna ścieżka do zweryfikowanej dystrybucji TraceCollector; puste = backend z platformowego VSIX |
| `junexis.debug.narrativeRoot` | `""` | Opcjonalna ścieżka do repo `junexis-narrative`; puste = autodetekcja z workspace |
| `junexis.debug.openMappedSource` | `true` | Po wyborze natywnej ramki stosu otwórz odpowiadającą lokalizację `.jnx` |

Przykład `.vscode/settings.json`:

```json
{
  "junexis.cliPath": "C:/repo/junexis-lang/compiler/JunexisLang.Compiler.CLI/bin/Release/net10.0/JunexisLang.Compiler.CLI.dll",
  "junexis.lspPath": "C:/repo/junexis-lang/compiler/JunexisLang.Compiler.LspHost/bin/Release/net10.0/JunexisLang.Compiler.LspHost.exe",
  "junexis.mentorPath": "C:/repo/junexis-mentor/JunexisLang.Mentor.CLI/bin/Release/net10.0/JunexisLang.Mentor.CLI.dll",
  "junexis.checkOnSave": true,
  "junexis.checkOnChange": true,
  "junexis.debug.traceCollectorUrl": "http://127.0.0.1:8080",
  "junexis.debug.traceCollectorPath": "",
  "junexis.debug.narrativeRoot": "",
  "junexis.debug.openMappedSource": true
}
```

## Artifact Explorer

Po `Junexis: Build Project` widok `Junexis Artifacts` w Explorerze czyta
wyłącznie ścieżkę `artifactManifest` ze zweryfikowanego receiptu
`latest-build` 1.0. Manifest schema 1.x musi mieć ten sam `buildId` co aktywny
build. Ścieżki względne i ścieżki wychodzące poza katalog output są odrzucane.

### Trwały stan ostatniego builda

Udany compiler build atomowo publikuje:

```text
<project>/.junexis/state/latest-build.json
```

Dla świadomego file-mode lokalizacja ma postać
`.junexis/state/<nazwa-pliku>/latest-build.json`. Rozszerzenie nie skanuje
`out/` ani nie wybiera najnowszego pliku po dacie. Receipt jest akceptowany
tylko wtedy, gdy:

- ma schema `1.0`, poprawny 64-znakowy `buildId`, tryb i targety;
- leży w deterministycznej lokalizacji właściwej dla projektu lub pliku;
- entrypoint pozostaje w project root, a wszystkie ścieżki artefaktów w output;
- bundle, inventory i Analysis Snapshot istnieją i mają dokładnie ten sam
  `buildId`;
- manifest debuggera istnieje, figuruje w inventory jako `debug-manifest`
  i ma dokładnie opublikowany hash SHA-256.

Po ponownym otwarciu workspace rozszerzenie odtwarza taki build bez ponownej
kompilacji. Dzięki temu Artifact Explorer, Mentor i most natywnego debuggera
widzą jeden spójny zestaw dowodów. Nieudany kolejny build nie usuwa ostatniego
poprawnego receiptu. Uszkodzony albo niepełny receipt nie jest zgadywany:
szczegóły trafiają do `Junexis Setup`, a użytkownik dostaje polecenie ponownego
`Junexis: Build Project`.

W workspace zawierającym wiele projektów rozszerzenie nie wybiera arbitralnie
jednego receiptu przed otwarciem pliku `.jnx`. Stan jest odtwarzany dopiero dla
aktywnego kontekstu projektowego. Automatyczne odtworzenie bez aktywnego
dokumentu jest wykonywane tylko wtedy, gdy workspace zawiera dokładnie jeden
projekt Junexis.

Artefakty są grupowane według targetu (`embedded`, `server`, `report` lub
innego targetu opublikowanego przez kompilator). Każdy wpis pokazuje kind,
ownership oraz hash SHA-256 i otwiera wskazany plik w edytorze. Ikona odświeżenia
w nagłówku widoku ponownie czyta manifest z dysku.

Wiersz targetu udostępnia akcje Build, Run i Debug:

- `server`: `go build -mod=mod ./...`, `go run -mod=mod .` oraz natywny adapter
  `golang.go`; tryb `mod` uzupełnia `go.sum` wewnątrz wygenerowanego outputu;
- `report`: `npm run build`, Node z `--experimental-strip-types` oraz wbudowany
  adapter `pwa-node` (uruchamianie wymaga Node.js 22.6 lub nowszego);
- `embedded`: `pio run` oraz — dopiero po potwierdzeniu — PlatformIO upload.
  Debug sprzętowy pozostaje w PlatformIO, ponieważ wymaga konkretnego probe'a,
  firmware ELF i ścieżki toolchaina zależnych od płytki.

Rozszerzenie nie wykonuje automatycznie `npm install`, nie instaluje adapterów
i nie wysyła firmware na urządzenie bez jawnej akcji użytkownika. Dla Go
wymagane jest oficjalne rozszerzenie `golang.go`; JavaScript/TypeScript używa
wbudowanego debuggera VS Code.

### Most `.jnx` ↔ natywny debugger

Przed startem debugowania `server` albo `report` rozszerzenie ładuje
`debug/junexis.source-map.json` schema 1.0 z inventory bieżącego buildu.
Breakpointy ustawione w `.jnx` są tymczasowo odwzorowywane na wygenerowane
źródła wybranego targetu. Mapowanie zachowuje condition, hit condition i log
message oraz obsługuje lowering 1:N — jedna instrukcja Junexis może utworzyć
kilka breakpointów runtime.

Po wybraniu ramki natywnego stosu rozszerzenie odnajduje najwęższy zakres
source-map i otwiera odpowiadający plik `.jnx`, linię i kolumnę. Call Stack
pozostaje własnością natywnego adaptera, a Junexis dostarcza nawigację do
źródła i stabilny `symbolId`. Tymczasowe breakpointy wygenerowanego kodu są
usuwane po zakończeniu sesji.

Widok `Junexis Native Debug` w panelu Run and Debug pokazuje stan mostu:
aktywny target i `buildId`, liczbę wpisów source-map, relację breakpointów
`.jnx → runtime`, nazwę natywnej sesji oraz ostatnią zmapowaną ramkę. Kliknięcie
ostatniej ramki ponownie otwiera dokładną lokalizację `.jnx`. Stan `error`
zawiera przyczynę braku mapowania zamiast pozostawienia niezweryfikowanego
breakpointa bez wyjaśnienia.

Source-map jest akceptowany tylko wtedy, gdy figuruje w bezpiecznie
zweryfikowanym `junexis.artifacts.json` aktywnego `buildId`. Ścieżki
wygenerowane wychodzące poza katalog output są odrzucane.

## Debug UI

Rozszerzenie ma pierwszy, ostrożny UI dla debuggera narracyjnego Junexis. Nie
jest to jeszcze klasyczny DAP debugger; to klient TraceCollector, który pokazuje
system w języku Junexis.

Komendy:

- `Junexis: Start Debugging Current Build` — uruchamia lokalny TraceCollector
  z `debugManifest` zweryfikowanego receiptu aktywnego builda, rozpoczyna sesję,
  synchronizuje breakpointy `.jnx` i otwiera kokpit Run and Debug. Komenda nie
  używa ścieżki demonstracyjnej CNC. Lokalny backend wiąże się wyłącznie z
  hostem `127.0.0.1` lub `localhost` wynikającym z
  `junexis.debug.traceCollectorUrl`, więc nie otwiera debug API w sieci.
  Preferuje jawne
  `junexis.debug.traceCollectorPath`, potem wersjonowany backend dołączony
  do platformowego VSIX, a
  projekt źródłowy `junexis-narrative` traktuje wyłącznie jako fallback
  deweloperski. Jeżeli pod skonfigurowanym adresem działa
  już inny TraceCollector, rozszerzenie odmawia podmiany manifestu i wymaga
  jawnego zatrzymania poprzedniej sesji.
- `Junexis: Analyze Current Build with Mentor` — analizuje
  `analysisSnapshot` z ostatniego zweryfikowanego buildu (także odtworzonego
  po ponownym otwarciu workspace),
  sprawdza zgodność `buildId`, publikuje lokalizowane findings w Problems
  i otwiera raport Markdown. Dla Mentor 1.1 raport zawiera również summary,
  deterministyczne wyjaśnienia i następne akcje, insights oraz rozpoznane
  wzorce architektoniczne. Raport pokazuje również świeżość `Current`, deltę
  findings i projektową politykę `.junexis/mentor.yml`: decyzje, wszystkie
  wyciszenia oraz dowód findingów wyciszonych w bieżącym buildzie. Najpierw
  uruchom `Junexis: Build Project`.
- `Junexis: Run CNC Debug Demo` — uruchamia demo z `junexis-narrative`,
  TraceCollector, manifestem `33-cnc`, seed eventami i CLI. Komenda zostawia
  TraceCollector uruchomiony (`-KeepServer`) na porcie z
  `junexis.debug.traceCollectorUrl`, aby widoki VS Code mogły się odświeżyć.
  Demo czeka chwilę przed seedem eventów, żeby extension zdążyło zsynchronizować
  aktywne breakpointy `.jnx`. Jeśli VS Code nie ma żadnego aktywnego
  breakpointa `.jnx`, demo jawnie używa fallback breakpointa na linii 117, aby
  pokazać pełny przepływ: hit → snapshot → otwarcie źródła.
- `Junexis: Run CNC Live Debug Demo` — uruchamia TraceCollector oraz realny
  wygenerowany artefakt `examples/projects/33-cnc/out/server/server.exe`.
  Następnie wysyła prawdziwy `ToolpathSegment` przez TCP do server targetu.
  Breakpoint na `main.jnx:117` pochodzi wtedy z działania wygenerowanego kodu Go,
  a nie z seedowanego trace eventu. Komenda VS Code uruchamia skrypt z
  `-KeepProcesses`, żeby TraceCollector i wygenerowany serwer pozostały dostępne
  dla widoków debuggera, snapshotów i komendy `Continue`.
- `Junexis: Refresh Debug Views` — odświeża stan TraceCollector.
- `Junexis: Show Debug Tasks` — pokazuje aktywne taski z nazwami z manifestu.
- `Junexis: Show Debug Trace` — pokazuje ostatnie eventy trace.
- `Junexis: Show Debug State` — pokazuje bieżącą sesję, taski, kanały,
  backlogi i wartości stanu raportowane przez runtime.
- `Junexis: Sync Debug Breakpoints` — wysyła aktywne breakpointy z plików
  `.jnx` do TraceCollector jako pierwszy typ semantycznych breakpointów
  `source/task`.
- `Junexis: Show Debug Breakpoints` — pokazuje zsynchronizowane breakpointy
  oraz breakpoint hits z eventem, snapshotem i atrybutami runtime.
- `Junexis: Show Latest Breakpoint Hit` — otwiera źródło ostatniego trafionego
  breakpointa, ustawia kursor na linii hitu i pokazuje powiązany event/snapshot.
- `Junexis: Show Latest Debug Snapshot` — otwiera źródło ostatniego hitu oraz
  dokument Markdown z kontekstem: event, task, Lamport, atrybuty runtime,
  aktualny stan sesji, tasków i kanałów.
- `Junexis: Explain Latest Debug Hit` — bierze ostatni breakpoint hit i pokazuje
  Diagnostic Story 1.x: timeline, łańcuch przyczynowy, współbieżność potwierdzoną
  vector clocks, komunikacje Junexis oraz evidence.
- `Junexis: Continue Debug Session` — wywołuje `POST /debug/session/resume` w
  TraceCollectorze i przełącza semantyczny status sesji z `paused` na `running`.
  Dla wygenerowanego Go/server targetu z aktywnym `JUNEXIS_TRACE_URL` odblokowuje
  też pierwszy runtime wait gate po breakpoint hit. Dla pozostałych targetów
  jest to na razie semantyczne wznowienie sesji TraceCollector.
- `Junexis: Explain Debug Event` — wywołuje `/events/{id}/story` i pokazuje
  pełny, wersjonowany Diagnostic Story. Jeśli bieżący build ma snapshot
  analizy, story jest wzbogacane wyłącznie findings Mentora pasującymi do
  stabilnych symboli tasków i komunikacji; findings pozostają kontekstem
  statycznym, a nie przyczyną runtime.
- `Junexis: Stop Debug Session` — po potwierdzeniu zatrzymuje lokalny proces
  TraceCollector nasłuchujący na porcie z `junexis.debug.traceCollectorUrl`.

### Polityka projektu Mentora

Rozszerzenie czyta `<project>/.junexis/mentor.yml` schema `1.0`. Wyciszenie
wymaga dokładnego kodu `Mxxxx`, stabilnego `symbolId` i uzasadnienia; może mieć
datę `expiresOn` w formacie `yyyy-MM-dd`. Nieznane pole albo dowolny błąd
walidacji unieważnia cały plik, więc żaden finding nie zostanie ukryty
częściowo. Poprawna polityka jest stosowana przed deltą, Problems i
wzbogaceniem Diagnostic Story.

Format jest wspólny z Junexis Studio. Przykład znajduje się w
`junexis-mentor/docs/mentor-policy.example.yml`.

### Bezpieczna refaktoryzacja Mentora

Aktywny, niewyciszony problem `M1002` udostępnia Code Action
`Junexis Mentor: Preview safe Narrative refactoring`. Jednoznaczny `M1012`
udostępnia `Junexis Mentor: Connect Narrative to the sole pipeline`, ale tylko
gdy aktualny snapshot zawiera dokładnie jeden pipeline. Akcja:

1. ponownie sprawdza aktualny build, finding i stabilny symbol pipeline'u,
2. otwiera natywny diff z minimalnym szkieletem Narrative (`M1002`) albo
   pojedynczą linią `applies_to` w istniejącej Narrative (`M1012`),
3. po potwierdzeniu zapisuje dokładnie pokazany patch,
4. uruchamia rzeczywisty `junexis check`,
5. wymaga jawnego `Keep`; `Revert`, błąd check lub zamknięcie decyzji
   przywraca oryginalny plik.

Zmiana jest odrzucana, jeśli dokument był niezapisany albo zmienił się po
preview. Późniejsze edycje blokują automatyczne cofnięcie, aby Mentor ich nie
nadpisał. `Keep` nie wykonuje stage, commit ani push. Dokładny patch jest
sprawdzany tymi samymi fixtures kontraktowymi co implementacja Junexis Studio.
`M1012` nie jest oferowane przy wielu pipeline'ach, ponieważ Mentor nie
wyprowadza granicy odpowiedzialności z przypuszczenia.

Widoki w panelu Run and Debug:

- `Junexis Debug Session`,
- `Junexis Debug Tasks`,
- `Junexis Debug Trace`,
- `Junexis Debug State`,
- `Junexis Debug Breakpoints`.

Po uruchomieniu `Junexis: Run CNC Debug Demo` albo `Junexis: Run CNC Live Debug
Demo` extension przełącza VS Code do panelu Run and Debug i skupia widok
`Junexis Debug Session`, bo to jest kokpit debuggera: pokazuje, czy
TraceCollector jest dostępny, czy sesja działa/stoi, jaki był ostatni breakpoint
hit, ostatni event trace, liczba tasków/kanałów oraz akcje `Refresh`,
`Continue`, `Open latest snapshot` i `Stop local session`. Explorer zostaje dla
plików projektu.

Pozostałe widoki są szczegółami kokpitu: taski pokazują mapowanie runtime na
źródło Junexis, trace pokazuje linię czasu zdarzeń, state pokazuje stan systemu,
a breakpoints pokazuje zsynchronizowane breakpointy i historię hitów.

Kliknięcie taska otwiera źródło `.jnx`, jeśli TraceCollector ma załadowany
`out/debug/junexis.debug.toml`. Kliknięcie eventu otwiera Diagnostic Story.
Kliknięcie breakpoint hit w `Junexis Debug Breakpoints` otwiera plik `.jnx`
i ustawia kursor na trafionej linii.
Widok stanu pokazuje to, czego klasyczny trace nie mówi wprost: aktualny status
sesji, ostatni znany stan tasków, backlog kanałów i wartości pomocnicze
potrzebne do analizy „co teraz dzieje się w systemie”.
Po trafieniu breakpointa extension otwiera również tymczasowy dokument
`Junexis Debug Snapshot`, który jest pierwszą używalną formą inspekcji stanu
systemu po hicie. To jeszcze nie jest pełne `continue/step`, ale już pokazuje
miejsce w kodzie, zdarzenie runtime i obserwowalny stan TraceCollector w jednym
miejscu.
Snapshot zawiera też sekcję `Why / causality`. Dzięki temu breakpoint przestaje
być tylko czerwoną kropką w pliku: zaczyna odpowiadać na pytanie, jaki ciąg
zdarzeń doprowadził system do tego miejsca.
Status bar extension pokazuje teraz stan sesji debuggera:
`created`, `running`, `paused`, `stopped` albo `disconnected`. Po trafieniu
breakpointa status przechodzi na `paused on #hit`, a `Junexis: Continue Debug
Session` przywraca stan `running`.

Breakpointy `.jnx` są synchronizowane z TraceCollector jako kontrakt debuggera,
ale pełny debugger krokowy jest następnym etapem. TraceCollector potrafi już
zarejestrować breakpoint hit, spauzować sesję debuggera, powiązać hit ze
snapshotem stanu systemu i — dla Go/server — zatrzymać wygenerowany runtime na
runtime wait gate do czasu `Continue`. Przy `Junexis: Run CNC Debug Demo`
extension przez krótki czas nasłuchuje hitów; gdy hit nadejdzie, VS Code
przełącza edytor na trafioną linię. Jeśli w terminalu widać
`Registered debug breakpoints before seed: 0`, oznacza to, że demo zostało
uruchomione bez synchronizacji breakpointów z extension albo ze starszej wersji
extension. W poprawnym przebiegu powinno być co najmniej `1`.
Docelowo Junexis breakpointy będą semantyczne i wizualnie rozróżnialne:
source/task, communication, channel, state, narrative i causality.

## Tryby działania

- rozszerzenie nie aktywuje się globalnie przy każdym starcie VS Code; aktywację
  wyzwala otwarcie pliku `.jnx`, workspace zawierający
  `junexis.project.toml` albo użycie komendy lub widoku Junexis
- aktywne rozszerzenie rejestruje UI i komendy bez uruchamiania procesu LSP;
  usługi językowe startują jednokrotnie dopiero po otwarciu dokumentu `.jnx`
- `Junexis: Show Activation Profile` pokazuje czas lekkiej aktywacji oraz
  osobno koszt pierwszego uruchomienia usług językowych
- Mentor tworzy własny kanał Output i kolekcję diagnostyk dopiero przy pierwszej
  analizie; klient debuggera zaczyna synchronizować breakpointy dopiero po
  otwarciu widoku lub użyciu komendy Junexis Debug
- tryb preferowany: aktywny `LspHost` wykryty lokalnie albo wskazany przez `junexis.lspPath`
- tryb hybrydowy: LSP dla feature'ów językowych, CLI dla compile
- tryb fallback: jeśli LSP nie wystartuje, extension przechodzi na lokalne providers + `junexis check`

### Baseline aktywacji 0.1.61

Pomiar wykonany 2026-07-26 w izolowanej instancji VS Code na Windows:

| Faza | Czas |
|---|---:|
| Aktywacja lekkiej powłoki extension | 8,5 ms |
| Core services | 0,7 ms |
| Rejestracja UI i komend | 7,4 ms |
| Gotowość powłoki | 0,4 ms |
| Pierwszy start usług językowych | 1814,1 ms |

Pierwszy wynik pochodzi z uruchomienia komendy
`Junexis: Show Activation Profile` w oknie bez otwartego dokumentu `.jnx`.
Drugi został dopisany po otwarciu
`examples/projects/01-temperature-monitor/src/main.jnx` i osiągnięciu stanu
`Junexis LSP · project`. Status Junexis Debug pozostał ukryty do czasu użycia.

To lokalny baseline regresji, nie gwarantowany limit dla każdego komputera.
Koszt usług językowych obejmuje wykrycie backendu, przygotowanie procesu,
uruchomienie LSP i handshake klienta.

Od wersji 0.1.62 profil rozbija ten łączny koszt na zagnieżdżone fazy:

- `LSP · backend discovery` — odnalezienie właściwego LspHost,
- `LSP · shadow preparation` — przygotowanie kopii uruchomieniowej dla buildu
  z workspace,
- `LSP · client construction` — utworzenie klienta i obserwatora plików,
- `LSP · process and handshake` — start procesu i inicjalizacja protokołu LSP.

Suma tych faz mieści się w pozycji `language services`; nie należy dodawać jej
ponownie do czasu całkowitego profilu.

Pomiar 0.1.62 wskazał, że przy lokalnym opublikowanym LspHost discovery trwało
4,9 ms, konstrukcja klienta 9,9 ms, a start procesu i handshake 1803,3 ms.
Całe `language services` zajęło 1819,3 ms. Oznacza to, że koszt jest związany
z zimnym startem procesu .NET/OmniSharp, a nie z logiką aktywacji extension.

Od wersji 0.1.63 folder z `junexis.project.toml` rozgrzewa LSP w tle 250 ms po
zakończeniu lekkiej aktywacji powłoki. Dzięki temu serwer zwykle jest gotowy,
zanim użytkownik otworzy pierwszy plik `.jnx`. Zachowanie można zmienić:

```json
"junexis.languageServicesStartup": "document"
```

Tryb `document` zachowuje ścisłe uruchamianie na żądanie. Prewarm nie jest
wykonywany dla zwykłych folderów bez manifestu Junexis.

Od wersji 0.1.64 wykrywanie obejmuje także manifesty zagnieżdżone w większym
workspace. Zmiana listy folderów ponawia skan, przełączenie ustawienia na
`document` anuluje oczekujący start, a nakładające się skany nie mogą uruchomić
więcej niż jednego prewarm. Faktyczny start nadal przechodzi przez wspólny
`LazyService`, więc równoczesne otwarcie `.jnx` nie tworzy drugiego procesu.

Discovery backendu przeszukuje również przodków otwartego folderu. Jeśli
`junexis-lang` zawiera wynik `publish-<RID>-r2r`, extension wybiera go przed
zwykłym buildem framework-dependent. Dzięki temu otwarcie samego projektu z
`examples/projects/**` nadal korzysta z szybszego hosta ReadyToRun.

### Lekki VSIX wydania platformy

M16.5 rozdziela klienta edytora od współdzielonego LSP. Gotowy artefakt wydania
powstaje bez katalogu `runtime`:

```powershell
./scripts/package-release.ps1 `
  -Version 0.1.0-preview.5 `
  -OutputPath ./junexislang-0.1.0-preview.5.vsix
```

Instalator platformy sprawdza paczkę i poleceniem `junexis install --extension`
instaluje najpierw LSP, a potem klienta VS Code. Studio i rozszerzenie korzystają
wtedy z jednego LSP w `%LOCALAPPDATA%\Junexis\lsp`.

### Platformowa dystrybucja LspHost w przenośnym VSIX

Szczególny wariant całkowicie przenośny może zawierać zgodny LspHost bez
oddzielnej instalacji. Nie jest to lekki artefakt M16.5:

```powershell
# W repo junexis-lang — rekomendowane wydanie użytkowe
./scripts/publish-lsp.ps1 `
  -RuntimeIdentifier win-x64 `
  -SelfContained `
  -OutputPath ./compiler/JunexisLang.Compiler.LspHost/bin/Release/publish-win-x64-r2r-self-contained

# W repo junexis-tooling/vscode-extension
./scripts/package-with-lsp.ps1 `
  -LspPublishPath ../../junexis-lang/compiler/JunexisLang.Compiler.LspHost/bin/Release/publish-win-x64-r2r-self-contained `
  -RuntimeIdentifier win-x64 `
  -VsceTarget win32-x64
```

Skrypt wymaga `junexis-lsp.json`, sprawdza schemat, tożsamość, protokół i RID,
a potem tworzy platformowy VSIX. Środowisko wykonawcze jest przygotowywane tylko
na czas pakowania i nie pozostaje w repozytorium. Jawne `junexis.lspPath` ma
pierwszeństwo; następnie używana jest paczka dołączona do VSIX, build z
repozytorium oraz standardowa instalacja `%LOCALAPPDATA%\Junexis\lsp` utworzona
przez `junexis install --lsp`.

Self-contained VSIX `win32-x64` ma w obecnym baseline około 46,3 MB i nie
wymaga osobnej instalacji .NET. Wariant framework-dependent ma około 6,83 MB,
ale wymaga zgodnego runtime .NET 10 na komputerze użytkownika.

### Platformowa dystrybucja TraceCollector

Debugger aktywnego buildu nie musi korzystać ze źródeł `junexis-narrative`.
TraceCollector ma własny manifest `junexis-trace-collector.json`, który
identyfikuje serwer, wersję protokołu debug API, RID, entrypoint oraz sposób
publikacji. Produkcyjny platformowy VSIX wymaga dystrybucji self-contained:

```powershell
# W repo junexis-narrative
./scripts/publish-trace-collector.ps1 `
  -RuntimeIdentifier win-x64 `
  -SelfContained `
  -OutputPath ./publish/trace-collector/win-x64

# W repo junexis-lang
./scripts/publish-cli.ps1 `
  -RuntimeIdentifier win-x64 `
  -SelfContained `
  -OutputPath ./publish/cli/win-x64

# W repo junexis-mentor
./scripts/publish-mentor.ps1 `
  -RuntimeIdentifier win-x64 `
  -SelfContained `
  -OutputPath ./publish/mentor/win-x64

# W repo junexis-tooling/vscode-extension — pełny pakiet platformowy
./scripts/package-with-lsp.ps1 `
  -LspPublishPath ../../junexis-lang/compiler/JunexisLang.Compiler.LspHost/bin/Release/publish-win-x64-r2r-self-contained `
  -CliPublishPath ../../junexis-lang/publish/cli/win-x64 `
  -MentorPublishPath ../../junexis-mentor/publish/mentor/win-x64 `
  -TraceCollectorPublishPath ../../junexis-narrative/publish/trace-collector/win-x64 `
  -RuntimeIdentifier win-x64 `
  -VsceTarget win32-x64
```

Skrypt pakujący weryfikuje manifesty i bezpieczne entrypointy wszystkich
backendów, w tym protokół Mentor 1 oraz debug API 1. Dystrybucje są tymczasowo
umieszczane w `runtime/<backend>/<RID>` i usuwane po utworzeniu VSIX. Zwykły,
uniwersalny VSIX pozostaje lekki i nie zawiera backendu platformowego.
Pełne wydanie zawiera zgodne LspHost, CLI build protocol 2, Mentor oraz
TraceCollector, dzięki czemu praca nie zależy od przypadkowych lokalnych buildów.
Pomocniczy `package-with-trace-collector.ps1` tworzy wariant tylko z
TraceCollectorem do testów integracyjnych; wydanie dla użytkownika powinno
korzystać z `package-with-lsp.ps1` i zawierać wszystkie cztery backendy.

Obsługiwana macierz wydania:

| LspHost RID | VS Code target | System |
|---|---|---|
| `win-x64` | `win32-x64` | Windows x64 |
| `linux-x64` | `linux-x64` | Linux x64 |
| `osx-arm64` | `darwin-arm64` | macOS Apple Silicon |

Jest to zamknięta macierz M19. Rozszerzenie odrzuca inne połączenia systemu i
architektury zamiast po cichu szukać nieistniejącej paczki.

Całą macierz można spakować jednym poleceniem, wskazując katalog zawierający
podkatalogi nazwane RID-ami:

```powershell
npm run vscode:prepublish
node ./scripts/package-lsp-matrix.mjs `
  --root ../../junexis-lang/.artifacts/m19-4-2/0.19.0-preview.1
```

Skrypt rozpoznaje układ paczki M19.4.2 (`<rid>/lsp`) i umieszcza w każdym
VSIX wyłącznie serwer LSP zgodny z docelowym systemem.

Skrypt macierzy wymaga samodzielnej dystrybucji, sprawdza zgodność każdego
manifestu i zawsze usuwa roboczy katalog `runtime/`. Do budowania wariantów
z dołączonym serwerem LSP potrzebne są katalogi `publish/lsp/<rid>` oraz
archiwa `.tar.gz` przygotowane przez repozytorium `junexis-lang`.

`Junexis: Diagnose Setup` pokazuje wersję hosta, wersję protokołu oraz wynik
zgodności. Host bez manifestu pozostaje obsługiwany jako legacy/unverified,
natomiast host z jawnym niezgodnym protokołem nie jest uruchamiany.

Przy automatycznie wykrytym `workspace-build` extension uruchamia LSP z kopii
shadow w storage rozszerzenia. Dzięki temu działający VS Code nie powinien
blokować przebudowy `junexis-lang/compiler/**/bin/Release`.

## Ikony i dekoracje plików/folderów

Domyślnie rozszerzenie dodaje dekoracje do istniejącego motywu ikon VS Code.
To oznacza, że możesz nadal używać np. Seti/Material/VS Code Icons i nie
stracisz ikon C++, Go, Markdown itd.

Dekoracje obejmują:

- pliki `.jnx`,
- `junexis.project.toml`,
- foldery `src/`, `user/`, `out/`, `.junexis/`,
- foldery targetów `embedded/`, `server/`, `report/`,
- foldery narzędziowe `cache/`, `build/`, `diagnostics/`.

Rozszerzenie dostarcza też pełny file icon theme:

```text
Junexis Icons
```

Ten tryb jest opcjonalny. VS Code pozwala mieć aktywny tylko jeden file icon
theme naraz, więc wybranie `Junexis Icons` zastąpi ikonki C++/Go/Markdown z
obecnego motywu.

Jeśli mimo tego chcesz użyć pełnego motywu Junexis:

```text
Preferences: File Icon Theme → Junexis Icons
```

## Snippety (wybrane)

| Prefix | Opis |
|---|---|
| `task` | Minimalny task |
| `task-emb` | Task `@embedded` z kanałem |
| `task-srv` | Task `@server` z pętlą |
| `task-state` | Task ze zmienną `state` |
| `pipeline` | Deklaracja pipeline |
| `struct` | Typ strukturalny |
| `enum` | Wyliczenie |
| `fn` | Czysta funkcja |
| `chan` / `queue` / `stream` | Typy komunikacyjne |
| `supervisor` | Drzewo nadzoru |
| `circuit_breaker` | Wzorzec odporności |
| `narrative` | Blok semantyczny |
| `device` | Urządzenie embedded |
| `every` | Pętla czasowa |
| `match` | Pattern matching |

## Budowanie rozszerzenia

```bash
cd junexis-tooling/vscode-extension
npm install
npm run compile
npm run bundle  # tworzy produkcyjny dist/extension.js
npm test     # build/artifacts/launch/Mentor/Narrative + zgodność gramatyki
npm run test:e2e:latest-build  # realny compiler → receipt → restart/restore extension
npm run test:e2e:mentor-refactoring  # realny compiler + Mentor, M1002/M1012 → resolved
npm run test:e2e:go-debug
npm run package  # tworzy .vsix
```

`npm run package` uruchamia kompilację oraz bundling automatycznie. VSIX zawiera
pojedynczy produkcyjny bundle rozszerzenia zamiast katalogów `out/`,
`node_modules/` i źródeł testów. `out/` pozostaje lokalnym wynikiem TypeScript
używanym przez testy kontraktowe.

`test:e2e:go-debug` jest opcjonalną bramą integracyjną Windows. Wymaga `go`,
`dlv` i wcześniej zbudowanego compiler CLI. Buduje projekt
`01-temperature-monitor` do izolowanego `.e2e-vscode-debug`, wybiera prawdziwe
mapowanie statement z source-map, kompiluje Go z symbolami debug, uruchamia
Delve i wymaga trafienia breakpointa na wygenerowanej linii. Katalog testowy
jest usuwany w `finally`; parametr `-KeepOutput` pozostawia go do inspekcji.

`test:e2e:latest-build` buduje kopię rzeczywistego projektu
`01-temperature-monitor` prawdziwym compiler CLI, ładuje i weryfikuje
opublikowany receipt kodem rozszerzenia, symuluje świeży extension host oraz
celowo wywołuje nieudany kolejny build. Brama wymaga, aby restart przed i po
błędzie odtworzył ten sam ostatni kompletny `buildId`. Całość działa w katalogu
tymczasowym i nie zmienia przykładu źródłowego.

Instalacja z pliku:

```bash
code --install-extension junexislang-*.vsix
```

## Struktura projektu

```
vscode-extension/
├── src/
│   ├── extension.ts     # Punkt wejścia — aktywacja, komendy, zdarzenia
│   └── checker.ts       # Integracja z CLI — uruchamia `junexis check/compile`
├── syntaxes/
│   ├── junexis.tmLanguage.json                   # Gramatyka TextMate (.jnx)
│   └── junexis-markdown-injection.tmLanguage.json # Bloki kodu w Markdown
├── snippets/
│   └── junexis.code-snippets    # 30+ szablonów kodu
├── package.json
├── tsconfig.json
└── language-configuration.json
```

## Architektura diagnostyk

Rozszerzenie uruchamia diagnostyki przez CLI, a ścieżka LSP jest gotowa do wykrycia hosta stdio. Obecnie `CLI lsp` deleguje już do `JunexisLang.Compiler.LspHost`. Fallback diagnostyk obsługuje zarówno historyczną tablicę diagnostyk, jak i envelope CLI 0.2 z polem `diagnostics`.

Przykładowy format diagnostyk z CLI:

```json
[
  {
    "code": "E0001",
    "level": "error",
    "category": "Syntax",
    "message": "Oczekiwano '}'",
    "file": "/path/to/file.jnx",
    "line": 12,
    "column": 5
  }
]
```

Każdy wpis `code` linkuje do dokumentacji pod `https://junexis.dev/docs/diagnostics/<code>`.

## Project-first workflow

W projektach z `junexis.project.toml` zalecany przepływ pracy jest świadomy i
jawny:

1. `Junexis: Doctor Project` — sprawdza manifest, entrypoint, targety,
   overlaye i kontrakty `extern`.
2. `Junexis: Scaffold Externs` — tworzy tylko brakujące pliki wskazane przez
   `extern.file`, np. `user/server/storage.go`.
3. `Junexis: Build Project` — generuje artefakty do `out/`.
4. `Junexis: Clean Project` — usuwa wygenerowane artefakty po potwierdzeniu.

`Scaffold Externs` nie nadpisuje istniejących plików i nie pisze do `out/`.
To jest granica własności: `user/` należy do dewelopera, `out/` do generatora.

## Lokalna sesja całej aplikacji

Otwórz zapisany plik projektu z `junexis.project.toml`, następnie wybierz
`Junexis: Uruchom aplikację`. Rozszerzenie zapisuje pliki, uruchamia publiczne
CLI (`run --duration 300 --no-open`) i otwiera panel po potwierdzeniu gotowości.
`Junexis: Otwórz panel aplikacji` ponawia otwarcie, a `Junexis: Zatrzymaj aplikację`
kończy własną sesję. Logi i błędy są w kanale `Junexis Application`.
Komendy artefaktów nadal służą oddzielnemu uruchamianiu targetu, debugowaniu
lub uploadowi embedded.

Ta integracja publikuje ustandaryzowany sygnał gotowości panelu aplikacji.

Próbę adaptera z rzeczywistym CLI uruchamia `npm run test:application-integration`.
Wymaga jawnych `JUNEXIS_TEST_CLI`, `JUNEXIS_TEST_PROJECT` (Laboratorium) oraz
osobnego `JUNEXIS_LAB_STATE_DIR`. Bez wejść test jest pomijany. To próba adaptera
z zastąpionym otwieraniem przeglądarki, nie interaktywny test Extension Host.
