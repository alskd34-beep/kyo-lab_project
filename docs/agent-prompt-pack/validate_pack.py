# -*- coding: utf-8 -*-
"""프롬프트 팩 자가검증 — replace(프로젝트 토큰) → format(런타임 값) 순서로 안전히 렌더되는지 확인.

사용: python validate_pack.py
새 프로젝트로 팩을 옮긴 뒤 PROJECT_TOKENS 를 채우고 실행하면
미치환 토큰·미정의 런타임 필드·중괄호 이스케이프 실수를 한 번에 잡는다.
(Windows 콘솔에서 깨지면: PYTHONIOENCODING=utf-8 python validate_pack.py)
"""
import re
from pathlib import Path
from string import Formatter

PACK = Path(__file__).parent

# 1) 프로젝트별 — 여기를 자기 프로젝트 값으로 바꾼다
PROJECT_TOKENS = {
    "AGENT_NAME": "Aria",
    "DOMAIN": "고객 지원",
    "DATA_SOURCE": "PostgreSQL",
    "QUERY_LANG": "SQL",
    "TENANT_KEY": "tenant_id",
    "LANG": "한국어",
}

# 2) 런타임 — 실제로 주입할 수 있는 값의 이름 목록 (값은 더미여도 됨)
RUNTIME = {
    "today_str": "2026-07-17", "today_year": "2026", "today_month": "7",
    "schema": "-", "catalog": "-", "few_shot": "-", "learned_rules": "-",
    "memo_block": "-", "plan": "-", "question": "-", "columns": "-",
    "row_count": "0", "data_sample": "-", "mode": "-", "user_context": "-",
    "answer": "-",
}


def render(path: Path) -> str:
    """실제 서비스 코드가 써야 할 렌더 순서 — 이 함수를 그대로 가져다 쓰면 된다."""
    tpl = path.read_text(encoding="utf-8")
    for k, v in PROJECT_TOKENS.items():          # 1) 프로젝트 토큰 먼저
        tpl = tpl.replace("{{" + k + "}}", v)
    return tpl.format(**RUNTIME)                 # 2) 런타임 값 나중


def main() -> int:
    fail = 0
    for f in sorted(PACK.glob("*.txt")):
        tpl = f.read_text(encoding="utf-8")
        for k, v in PROJECT_TOKENS.items():
            tpl = tpl.replace("{{" + k + "}}", v)

        still = sorted(set(re.findall(r"\{\{[A-Z_]+\}\}", tpl)))
        fields = {fn for _, fn, _, _ in Formatter().parse(tpl) if fn}
        unknown = sorted(fields - set(RUNTIME))

        try:
            tpl.format(**RUNTIME)
            status = "OK"
        except Exception as e:
            status = f"FAIL {type(e).__name__}: {e}"
            fail += 1

        print(f"{f.name}: format() {status}")
        print(f"   런타임 필드: {sorted(fields)}")
        if still:
            print(f"   [!] 미치환 프로젝트 토큰: {still}")
            fail += 1
        if unknown:
            print(f"   [!] 미정의 런타임 필드: {unknown}  <- RUNTIME 에 추가하거나 프롬프트에서 {{{{ }}}} 로 이스케이프")
            fail += 1
        print()

    print(f"=== FAIL: {fail} ===")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
