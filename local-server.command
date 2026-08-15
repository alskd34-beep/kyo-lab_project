#!/bin/bash
cd "$(dirname "$0")"

GREEN='\033[1;32m'
RESET='\033[0m'

PORT=3300

print_banner() {
  printf '%b' "$GREEN"
  cat <<'EOF'


    ########################################################
    #                                                      #
    #            QC 스케줄 로컬 서버를 시작합니다          #
    #                                                      #
    #     접속 주소 : http://localhost:3300                #
    #     서버 종료 : 이 창을 닫으세요                     #
    #                                                      #
    ########################################################


EOF
  printf '%b' "$RESET"
}

print_stopped() {
  printf '%b' "$GREEN"
  cat <<'EOF'


    ########################################################
    #                                                      #
    #              서버가 멈췄습니다                       #
    #                                                      #
    #     이 창을 닫고                                     #
    #     local-server.command 을 다시 실행하세요          #
    #                                                      #
    ########################################################


EOF
  printf '%b' "$RESET"
}

# 3300 포트를 듣고 있는 프로세스 ID 목록
listening_pids() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null
}

print_banner

# ── 이미 3300 포트를 쓰고 있는 기존 서버가 있으면 먼저 종료한다 ──
if command -v lsof >/dev/null 2>&1; then
  pids=$(listening_pids)
  if [ -n "$pids" ]; then
    echo "    [i]  ${PORT} 포트를 쓰고 있는 기존 서버를 종료합니다."
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    sleep 2
    pids=$(listening_pids)
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null
      sleep 1
    fi
    echo "    [i]  기존 서버를 종료했습니다."
    echo
  fi

  if [ -n "$(listening_pids)" ]; then
    echo "    [!]  ${PORT} 포트를 비우지 못했습니다."
    echo "    [!]  기존 서버 창을 직접 닫은 뒤 다시 실행하세요."
    echo
    read -r -p "종료하려면 Enter..."
    exit 1
  fi
fi

if [ ! -d node_modules ]; then
  echo "    [i]  의존성을 설치합니다. 잠시만 기다려 주세요."
  npm install || {
    echo "    [!]  npm install 에 실패했습니다."
    read -r -p "종료하려면 Enter..."
    exit 1
  }
fi

npm run dev

print_stopped
read -r -p "종료하려면 Enter..."
