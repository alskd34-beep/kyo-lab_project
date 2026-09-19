export type MetricKey =
  | "adherence" | "dueCompliance" | "avgDays" | "overrun" | "delayRate"
  | "avgDelay" | "delayReasons" | "externalDelay" | "recovery" | "holidayWork"
  | "sideRatio" | "sideToTest" | "sideFragmentation" | "plannedUtilization"
  | "actualUtilization" | "availableUtilization" | "reassignment" | "reopen"
  | "concurrent" | "weightedThroughput" | "testWork" | "sideWork" | "completedJobs"
  | "testItemCount" | "totalTestMinutes" | "avgTestMinutes" | "overrunDaysTotal"

export const METRIC_HELP: Record<MetricKey, { title: string; body: string }> = {
  adherence: { title: "공수 준수율", body: "시작일부터 종료일까지 실제로 걸린 근무일이 품목마스터 공수 이하면 준수로 셉니다. 공수가 없는 품목은 빠지며, 납기 준수율과는 다른 기준입니다." },
  dueCompliance: { title: "납기 준수율", body: "완료일이 오더의 납기 이내인 작업의 비율입니다. 납기가 비어 있는 오더는 계산에서 빠져 약속한 날짜를 지켰는지만 보여줍니다." },
  avgDays: { title: "평균 소요일", body: "완료 작업의 실제 소요 근무일 평균입니다. 주말과 공휴일은 빼며, 품목별 공수가 달라 이 값만으로 빠르고 느림을 판단하지 않습니다." },
  overrun: { title: "기준 초과일 버킷", body: "완료 작업을 품목 지정 공수와 실제 소요 근무일의 차이로 분류한 건수입니다. 공수가 등록되지 않은 품목은 '미등록'으로 따로 표시합니다." },
  overrunDaysTotal: { title: "기준 초과 누적일", body: "완료 작업별 기준 초과일(max(0, 실제 소요 근무일−품목 공수)을 합산한 값입니다. 기준 초과일 버킷의 건수와는 다른 누적값입니다." },
  delayRate: { title: "지연 발생률", body: "조회 기간에 승인완료된 작업 중 지연 구간이 하나 이상 종료된 작업의 비율입니다. 진행 중인 지연 구간은 완료 표본과 섞지 않고 별도로 봅니다." },
  avgDelay: { title: "평균 지연일", body: "지연 진입부터 다음 상태 전환까지의 근무일을 모든 지연 구간에 대해 합산해 지연 작업 수로 나눈 값입니다. 아직 지연 중인 구간은 조회 종료일까지 계산하며, 별도 건수로 표시합니다." },
  delayReasons: { title: "지연 사유 구성", body: "지연을 선언할 때 선택한 분류의 건수와 비중입니다. 기능 도입 전 기록은 사유 미기록으로 묶으며, 분포는 공정 맥락과 함께 읽어야 합니다." },
  externalDelay: { title: "통제 밖 지연 비율", body: "장비·검체·동시분석 대기처럼 시험자가 조절하기 어려운 사유의 비율입니다. 이 값이 높으면 지연을 개인의 일정 관리로 해석하지 않아야 합니다." },
  recovery: { title: "리커버리(지연 후 만회)", body: "승인완료된 지연 작업 중 최종 납기 안에 끝낸 작업의 비율입니다. 지연 후 따라잡은 결과를 보여주며, 내부 공수 기준 만회와는 별도로 봅니다. 완료 표본 3건 미만은 숨깁니다." },
  holidayWork: { title: "휴일에 완료한 시험항목", body: "완료 시각이 주말이나 공휴일인 시험항목과 부업무 기록입니다. 실제 출근 여부는 알 수 없으므로 근무 실적이 아닌 참고 흔적으로 봅니다." },
  sideRatio: { title: "부업무 비중", body: "기록된 전체 시간 중 시험 외 업무가 차지하는 비율입니다. 시험항목 구간과 직접 입력한 부업무 분을 같은 시간 단위로 비교합니다." },
  sideToTest: { title: "주업무 대비 부업무 배율", body: "부업무 시간을 시험업무 시간으로 나눈 값입니다. 1.0을 넘으면 시험보다 시험 외 일에 더 많은 시간이 기록된 것입니다." },
  sideFragmentation: { title: "부업무 단편화", body: "부업무를 기록한 날 하루당 평균 기록 건수입니다. 총 시간이 같아도 잘게 쪼개지면 시험에 이어 쓸 시간이 줄어들 수 있어 추세로 봅니다." },
  plannedUtilization: { title: "계획 가동률", body: "기간에 배정된 공수 일수의 합을 기간 근무일로 나눈 값입니다. 실제 근무시간이 아니라 얼마나 배정받았는지를 보여줍니다." },
  actualUtilization: { title: "실적 가동률", body: "시험업무와 부업무 기록 시간을 기간 가용 근무시간(근무일×8시간)으로 나눈 값입니다. 기록하지 않은 일은 포함되지 않습니다." },
  availableUtilization: { title: "가용일 보정 가동률", body: "시험자별 기간 근무일에서 등록된 휴가·출장의 근무일(반일은 0.5일)을 뺀 가용일을 분모로 계산한 기록시간 가동률입니다. 기록이 없거나 가용일이 0이면 표시하지 않습니다." },
  reassignment: { title: "재배정 노출", body: "기간에 다른 사람에게서 넘겨받거나 다른 사람에게 넘긴 건수입니다. 일정이 흔들린 맥락을 설명하는 참고값이며 잘잘못을 뜻하지 않습니다." },
  reopen: { title: "재실시", body: "조회 기간에 관리자가 재실시로 되돌린 시험 작업 건수입니다. 완료 작업 표본 3건 미만이면 숨겨 참고값으로만 봅니다." },
  concurrent: { title: "동시분석 기여", body: "동시분석으로 절감된 공수 중 이 시험자가 참여한 몫입니다. 실제로 실현된 그룹만 포함합니다." },
  weightedThroughput: { title: "난이도 가중 처리량", body: "완료 작업을 품목 난이도(High 3·Medium 2·Low 1)로 가중해 합산합니다. 미등록 난이도는 1로 계산합니다." },
  testWork: { title: "시험업무", body: "조회 기간에 완료된 시험항목의 기록 시간과 항목 수입니다. 입력된 시험업무 기록만 집계하며 기록하지 않은 업무는 포함되지 않습니다." },
  sideWork: { title: "부업무", body: "조회 기간에 직접 기록한 시험 외 업무의 시간과 기록 건수입니다. 입력된 부업무 기록만 집계합니다." },
  completedJobs: { title: "완료 작업", body: "조회 기간에 승인완료 상태가 된 작업 건수입니다. 진행 중인 작업은 포함하지 않습니다." },
  testItemCount: { title: "시험 진행 건수", body: "조회 기간에 완료된 시험항목 기록의 건수입니다. 시험항목별로 몇 건을 처리했는지 나타냅니다." },
  totalTestMinutes: { title: "시험 총 소요", body: "조회 기간에 완료된 시험항목의 기록 시간을 합산한 값입니다. 동시분석으로 겹치는 시간은 중복하지 않습니다." },
  avgTestMinutes: { title: "시험 평균 소요", body: "시험항목별 총 소요 시간을 진행 건수로 나눈 평균입니다. 항목별 처리시간 차이를 비교하는 참고값입니다." },
}
