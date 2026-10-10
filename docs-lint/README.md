# Junexis Docs Lint

Zestaw lekkich skryptów PowerShell do walidacji podstawowych zasad dokumentacyjnych w repozytoriach Junexis.

## Cel

`docs-lint` jest narzędziem repo `junexis-tooling`, ale waliduje **inne repozytoria** lub wybrany katalog docs.

W szczególności pomaga wykryć:

- niedziałające linki w sekcjach `Available Languages`,
- nieprawidłowe umieszczanie sekcji statusu poza dozwolonym miejscem.

## Skrypty

- `check-available-languages.ps1`
- `check-status-location.ps1`

## Użycie

Walidacja repozytorium wskazanego jawnie:

```powershell
pwsh .\docs-lint\check-available-languages.ps1 -TargetRoot ..\junexis-documentation
pwsh .\docs-lint\check-status-location.ps1 -TargetRoot ..\junexis-documentation
```

Walidacja bieżącego katalogu roboczego:

```powershell
pwsh .\docs-lint\check-available-languages.ps1 -TargetRoot .
pwsh .\docs-lint\check-status-location.ps1 -TargetRoot .
```

## Założenia

- `check-status-location.ps1` sprawdza, czy status projektu znajduje się w oczekiwanym miejscu.
- Jeśli repo ma inną politykę ownership/statusów, skrypt należy dostosować albo uruchamiać tylko na odpowiednim zakresie dokumentów.