"""터미널 붙여넣기 파일이 어디로 가야 하는가.

두 가지를 정한다.

**어느 머신인가.** pane 이 원격 호스트면 파일은 **그 호스트에** 있어야 한다.
로컬 워크스페이스에 올리고 로컬 경로를 삽입하면, 원격 셸에서는 존재하지 않는
파일을 가리키게 된다 — 붙여넣기는 성공한 것처럼 보이는데 상대는 열지 못한다.

**어느 폴더인가.** 워크스페이스가 아니라 temp 성격의 폴더다. 붙여넣은 이미지는
대개 한 번 쓰고 버리는 것이라, 프로젝트 트리를 오염시키지 않아야 한다.
`/tmp` 는 재부팅 때 비워지므로 정리 걱정도 없다.
"""
from __future__ import annotations

import os
import re
import time
from secrets import token_hex
from pathlib import Path

# 로컬/원격 공통 폴더명. 어느 머신에서 보든 같은 자리라 찾기 쉽다.
PASTE_DIR_NAME = "iterminallist-paste"

# 로컬 temp 루트 — 컨테이너/특수 배포에서 옮길 수 있게 env 로 열어둔다.
DEFAULT_LOCAL_TMP = os.getenv("TMPDIR") or "/tmp"
# 원격은 항상 /tmp. 원격 셸의 TMPDIR 을 물어보려면 SSH 왕복이 하나 더 붙는데,
# 붙여넣기 지연을 늘릴 만큼의 가치는 없다(POSIX 에서 /tmp 는 사실상 보장된다).
REMOTE_TMP = "/tmp"


def local_paste_dir() -> Path:
    return Path(os.getenv("PASTE_DIR") or Path(DEFAULT_LOCAL_TMP) / PASTE_DIR_NAME)


def remote_paste_dir() -> str:
    return f"{REMOTE_TMP}/{PASTE_DIR_NAME}"


def safe_basename(raw: str | None, fallback: str = "file") -> str:
    """파일명을 basename + 화이트리스트로 정규화 — 경로 traversal 을 원천 차단."""
    name = os.path.basename((raw or "").strip()) or fallback
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:80].lstrip(".")
    return cleaned or fallback


def stamped_name(base: str) -> str:
    """시간순으로 읽히면서 충돌하지 않는 파일명.

    ⚠️ 타임스탬프만으로는 부족하다 — 파일 여러 개를 한꺼번에 드롭하면 같은
    밀리초에 들어와 이름이 겹치고, 앞에 올라간 파일이 조용히 덮인다.
    끝에 짧은 무작위를 붙여 그걸 막는다(초 단위 정렬은 그대로 유지).
    """
    stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
    return f"{stamp}-{token_hex(4)}-{base}"
