# Compact Codex Status Line

짧은 Codex TUI 상태줄 설정입니다.

목표 형태:

```text
gpt-5.5 high project main [████░░░░░░] 40% in:224,014 out:176 5h weekly
```

포함:

- model + reasoning
- project
- git branch
- context progress bar + percent
- input tokens
- output tokens
- 5h limit
- weekly limit

제외:

- `used-tokens`
- 추정 금액 / cost
- 기타 긴 설명성 항목

## macOS / Linux

```sh
sh install.sh
```

## Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Manual

`~/.codex/config.toml` 또는 Windows의 `%USERPROFILE%\.codex\config.toml`에 아래를 적용하세요.

```toml
[tui]
status_line = [
  "model-with-reasoning",
  "project",
  "git-branch",
  "context-used",
  "total-input-tokens",
  "total-output-tokens",
  "five-hour-limit",
  "weekly-limit",
]
status_line_use_colors = true
```

이미 `[tui]`가 있으면 같은 섹션 안의 `status_line`과 `status_line_use_colors`만 교체하면 됩니다.
