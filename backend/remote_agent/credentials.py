"""리모트의 신원 — 호스트 전용 자격증명.

**왜 새 토큰 종류인가.** 지금 원격 tmux 에 실려 나가는 `ITL_TOKEN` 은 scope 가 `itl`
일 뿐 **사용자 전체 범위**다. 그 호스트에 셸이 있는 사람은 `tmux show-environment` 로
그걸 읽어 **다른 호스트의 pane 까지** 입력할 수 있다(배달이 백엔드의 자격증명으로
일어나므로). 리모트 자격증명은 `host` 청구를 달고 그 호스트 몫만 연다 — 한 대가
털려도 반경이 그 한 대에서 끝난다.

**망은 우리가 정하지 않는다.** 로컬망 안이라는 전제로 간다. 리모트가 LAN 으로 붙든
테일넷으로 붙든 그건 사용자가 고르는 것이고, 여기서 출처 대역을 검사하지 않는다 —
그런 게이트는 LAN 에서 붙일 때마다 걸리적거리기만 한다.

**페어링 절차는 없다.** 설치는 우리가 **이미 그 호스트에 SSH 로 들어가서** 하는 일이고,
그 접속 자체가 권한 증명이다. 그래서 자격증명은 그 SSH 통로로 곧장 넣는다 — 일회용
코드를 발급하고 교환하는 왕복은 아무것도 더 증명하지 못한다.

⚠️ 다만 **stdin 으로만** 넣는다. 명령 문자열은 원격 셸의 argv 가 되어 그 기계의 `ps`
에 그대로 보인다(환경변수 대입 `K=값 cmd` 도 argv 의 일부라 소용없다). 같은 규칙이
`itl_remote_setup` 의 ITL_TOKEN 주입과 VNC 비밀번호에 이미 적용돼 있다.

🔐 **설치는 언제나 사람이 누르는 것이다.** 자동 설치·자동 시작은 없다. 호스트를
등록했다는 이유로 리모트가 깔리면 그건 모르는 사이에 도는 프로그램이 된다. 이 저장소가
`BOOTSTRAP_HOST_ENABLE` 과 사용량 요약에서 이미 정한 규칙(옵트인, 기본 꺼짐)과 같다.
"""
from __future__ import annotations

REMOTE_TOKEN_SCOPE = "remote"

# 자격증명 수명. 리모트는 만료 전에 자기 자신으로 인증해 갱신한다.
CREDENTIAL_TTL_HOURS = 24 * 90


async def issue_credential(auth_manager, username: str, host_id: str, epoch: int = 1) -> str:
    """호스트 전용 장기 자격증명. **stdin 으로만** 원격에 전달할 것.

    `epoch` 는 그 호스트의 자격증명 세대다. 호스트를 폐기하면 세대가 올라 이 토큰은
    서명이 멀쩡해도 통과하지 못한다 — JWT 에 폐기 장치가 없으므로 이것이 그 역할이다.
    """
    return await auth_manager.create_scoped_token(
        username, REMOTE_TOKEN_SCOPE, hours=CREDENTIAL_TTL_HOURS,
        extra={"host": host_id, "epoch": int(epoch)},
    )


async def verify_credential(auth_manager, token: str | None) -> tuple[str, str, int] | None:
    """(username, host_id, epoch) 또는 None.

    ⚠️ **host 청구가 없으면 거절한다.** 있으나 마나 한 검사로 두면 scope 만 맞는 토큰이
    아무 호스트로나 붙을 수 있고, 그러면 "호스트 전용" 이라는 말이 거짓이 된다.

    세대 대조는 여기서 하지 않는다 — DB 를 아는 호출자(라우트)가 한다. 이 모듈이
    저장소를 알면 순수 함수가 아니게 되고 테스트가 DB 를 끌고 온다.
    """
    if not token:
        return None
    claims = await auth_manager.verify_scoped_claims(token, REMOTE_TOKEN_SCOPE)
    if not claims:
        return None
    username, host_id = claims.get("sub"), claims.get("host")
    if not username or not host_id:
        return None
    try:
        epoch = int(claims.get("epoch", 0))
    except (TypeError, ValueError):
        return None
    if epoch <= 0:          # 세대 없는 옛 토큰은 통과시키지 않는다
        return None
    return username, host_id, epoch
