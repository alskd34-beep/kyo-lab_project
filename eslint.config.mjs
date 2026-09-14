import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // return 뒤에 남은 선언은 영원히 초기화되지 않는다. 그래서 그 변수를 쓰는 이벤트 핸들러가
      // 클릭하는 순간 ReferenceError 로 죽는데, 화면에는 "아무 반응 없음" 으로만 보인다.
      // 실제로 my-tasks 그룹 카드의 [시작]·[완료] 가 이 이유로 죽어 있었다(2026-09-14).
      // next 기본 설정에는 이 규칙이 없어 직접 켠다.
      "no-unreachable": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
