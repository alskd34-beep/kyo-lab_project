export interface StabilityCompositeKeyInput {
  productCode: string
  batchNo: string
  testType: string
  period: string
}

/** 안정성 시험계획을 같은 품목·제조번호·시험·기간으로 식별하는 공통 키를 만든다. */
export function stabilityCompositeKey(
  input: StabilityCompositeKeyInput
): string {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ")
  return `composite:${[
    input.productCode,
    input.batchNo,
    input.testType,
    input.period,
  ]
    .map(clean)
    .join("|")}`
}
