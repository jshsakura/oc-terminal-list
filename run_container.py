#!/usr/bin/env python3
"""
iTerminaLlist 개발용 컨테이너 관리 스크립트

사용법:
    python run_container.py dev     # 개발 모드 시작
    python run_container.py prod    # 프로덕션 모드 시작
    python run_container.py stop    # 모든 컨테이너 중지
    python run_container.py restart # 재시작
    python run_container.py logs    # 로그 보기
    python run_container.py status  # 상태 확인
    python run_container.py clean   # 모든 컨테이너/볼륨 삭제
    python run_container.py build   # 이미지 재빌드
"""

import subprocess
import sys
import os
import time
from pathlib import Path

# 색상 코드
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_header(msg):
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{msg:^60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")

def print_success(msg):
    print(f"{Colors.OKGREEN}✓ {msg}{Colors.ENDC}")

def print_error(msg):
    print(f"{Colors.FAIL}✗ {msg}{Colors.ENDC}")

def print_warning(msg):
    print(f"{Colors.WARNING}⚠ {msg}{Colors.ENDC}")

def print_info(msg):
    print(f"{Colors.OKCYAN}ℹ {msg}{Colors.ENDC}")

def run_command(cmd, check=True, capture_output=False):
    """명령어 실행"""
    print_info(f"실행: {' '.join(cmd)}")
    try:
        if capture_output:
            result = subprocess.run(cmd, check=check, capture_output=True, text=True)
            return result.stdout
        else:
            subprocess.run(cmd, check=check)
            return None
    except subprocess.CalledProcessError as e:
        print_error(f"명령어 실패: {e}")
        if capture_output:
            print(e.stderr)
        sys.exit(1)

def check_docker():
    """Docker 설치 확인"""
    try:
        subprocess.run(["docker", "--version"], check=True, capture_output=True)
        subprocess.run(["docker", "compose", "version"], check=True, capture_output=True)
        print_success("Docker 및 Docker Compose 확인됨")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print_error("Docker 또는 Docker Compose가 설치되지 않았습니다")
        print_info("설치 방법: https://docs.docker.com/get-docker/")
        sys.exit(1)

def start_dev():
    """개발 모드 시작"""
    print_header("개발 모드 시작")

    # Redis와 백엔드는 항상 시작
    run_command(["docker", "compose", "up", "-d", "redis", "backend"])

    # 프론트엔드는 dev 프로필로 시작
    run_command(["docker", "compose", "--profile", "dev", "up", "-d", "frontend-dev"])

    print_success("개발 모드로 시작됨")
    print_info("프론트엔드: http://localhost:23232")
    print_info("백엔드 API: http://localhost:8000")
    print_info("Redis: localhost:36379")
    print_warning("로그 확인: python run_container.py logs")

def start_prod():
    """프로덕션 모드 시작"""
    print_header("프로덕션 모드 시작")

    # 먼저 이미지 빌드
    print_info("이미지 빌드 중...")
    run_command(["docker", "compose", "--profile", "prod", "build"])

    # Redis와 백엔드, 프론트엔드 프로덕션 시작
    run_command(["docker", "compose", "up", "-d", "redis", "backend"])
    run_command(["docker", "compose", "--profile", "prod", "up", "-d", "frontend-prod"])

    print_success("프로덕션 모드로 시작됨")
    print_info("웹사이트: http://localhost:23232")
    print_info("백엔드 API: http://localhost:8000")

def stop():
    """모든 컨테이너 중지"""
    print_header("컨테이너 중지")
    run_command(["docker", "compose", "--profile", "dev", "--profile", "prod", "down"])
    print_success("모든 컨테이너가 중지되었습니다")

def restart():
    """컨테이너 재시작"""
    print_header("컨테이너 재시작")
    stop()
    time.sleep(2)

    # 현재 실행 중인 모드 확인
    result = run_command(
        ["docker", "ps", "--filter", "name=iterminal", "--format", "{{.Names}}"],
        capture_output=True
    )

    if "frontend-dev" in result:
        start_dev()
    elif "frontend-prod" in result:
        start_prod()
    else:
        print_warning("실행 중인 컨테이너 없음. 개발 모드로 시작합니다.")
        start_dev()

def logs(service=None, follow=True):
    """로그 보기"""
    print_header("로그 보기")

    cmd = ["docker", "compose"]

    if follow:
        cmd.extend(["-f", "logs", "-f"])
    else:
        cmd.extend(["logs", "--tail=100"])

    if service:
        cmd.append(service)

    print_info("로그를 보려면 Ctrl+C로 종료하세요")
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n")
        print_info("로그 종료")

def status():
    """컨테이너 상태 확인"""
    print_header("컨테이너 상태")

    result = run_command(
        ["docker", "ps", "-a", "--filter", "name=iterminal", "--format",
         "table {{.Names}}\t{{.Status}}\t{{.Ports}}"],
        capture_output=True
    )

    print(result)

    # 디스크 사용량
    print("\n" + Colors.BOLD + "볼륨 사용량:" + Colors.ENDC)
    run_command(["docker", "volume", "ls", "--filter", "name=iterminallist"])

def clean():
    """모든 컨테이너 및 볼륨 삭제"""
    print_header("정리")
    print_warning("모든 컨테이너, 이미지, 볼륨이 삭제됩니다!")

    confirm = input("계속하시겠습니까? (yes/no): ")
    if confirm.lower() != 'yes':
        print_info("취소되었습니다")
        return

    # 컨테이너 중지 및 삭제
    run_command(
        ["docker", "compose", "--profile", "dev", "--profile", "prod", "down", "-v"],
        check=False
    )

    # 이미지 삭제
    print_info("이미지 삭제 중...")
    run_command(
        ["docker", "images", "--filter", "reference=iterminallist*", "-q"],
        capture_output=True
    )

    run_command(
        ["sh", "-c", "docker images --filter reference=iterminallist* -q | xargs -r docker rmi -f"],
        check=False
    )

    print_success("정리 완료")

def build():
    """이미지 재빌드"""
    print_header("이미지 빌드")

    print_info("백엔드 빌드...")
    run_command(["docker", "compose", "build", "backend"])

    print_info("프론트엔드 빌드...")
    run_command(["docker", "compose", "--profile", "prod", "build", "frontend-prod"])

    print_success("빌드 완료")

def shell(service="backend"):
    """컨테이너 쉘 접속"""
    print_header(f"{service} 쉘 접속")

    container_name = f"iterminal-{service}"

    # 컨테이너 실행 중인지 확인
    result = run_command(
        ["docker", "ps", "--filter", f"name={container_name}", "--format", "{{.Names}}"],
        capture_output=True
    )

    if container_name not in result:
        print_error(f"{service} 컨테이너가 실행 중이지 않습니다")
        return

    print_info("쉘에 접속합니다. 종료하려면 'exit'를 입력하세요.")

    shell_cmd = "sh" if service == "frontend-dev" else "bash"
    subprocess.run(["docker", "exec", "-it", container_name, shell_cmd])

def help_menu():
    """도움말 출력"""
    print_header("iTerminaLlist 컨테이너 관리")
    print("""
명령어:
    dev         개발 모드 시작 (핫 리로드)
    prod        프로덕션 모드 시작 (최적화된 빌드)
    stop        모든 컨테이너 중지
    restart     컨테이너 재시작
    logs        로그 보기 (Ctrl+C로 종료)
    status      컨테이너 상태 확인
    build       이미지 재빌드
    clean       모든 컨테이너/볼륨 삭제
    shell       백엔드 컨테이너 쉘 접속

예제:
    python run_container.py dev              # 개발 모드 시작
    python run_container.py logs backend     # 백엔드 로그만 보기
    python run_container.py shell            # 백엔드 쉘 접속

포트:
    23232   프론트엔드 (웹 UI)
    8000    백엔드 (API)
    36379   Redis (로컬호스트만)
""")

def main():
    # 현재 디렉토리 확인
    if not Path("compose.yml").exists():
        print_error("compose.yml 파일을 찾을 수 없습니다")
        print_info("프로젝트 루트 디렉토리에서 실행하세요")
        sys.exit(1)

    # Docker 확인
    check_docker()

    # 명령어 파싱
    if len(sys.argv) < 2:
        help_menu()
        sys.exit(0)

    command = sys.argv[1].lower()

    commands = {
        'dev': start_dev,
        'prod': start_prod,
        'stop': stop,
        'restart': restart,
        'logs': lambda: logs(sys.argv[2] if len(sys.argv) > 2 else None),
        'status': status,
        'build': build,
        'clean': clean,
        'shell': lambda: shell(sys.argv[2] if len(sys.argv) > 2 else "backend"),
        'help': help_menu,
        '-h': help_menu,
        '--help': help_menu,
    }

    if command in commands:
        try:
            commands[command]()
        except KeyboardInterrupt:
            print("\n")
            print_warning("중단되었습니다")
            sys.exit(0)
    else:
        print_error(f"알 수 없는 명령어: {command}")
        help_menu()
        sys.exit(1)

if __name__ == "__main__":
    main()
