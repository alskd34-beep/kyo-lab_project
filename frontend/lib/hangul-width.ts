/**
 * 표 컬럼 최소 폭을 "한글 한 자" 단위로 잰다.
 * 헤더 글자 수와 셀 내용 글자 수 중 더 큰 쪽에 한 자 폭을 곱한다.
 */

const FULLWIDTH_RE =
  /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/

/** 한글·한자·전각 = 1자, 그 외(숫자·영문·기호) = 0.5자 */
export function hangulUnits(text: string): number {
  let units = 0
  for (const ch of text.trim()) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) continue
    units += FULLWIDTH_RE.test(ch) ? 1 : 0.5
  }
  return units
}

let measureCanvas: HTMLCanvasElement | null = null

/** 엘리먼트에 적용된 폰트로 "가" 한 글자의 CSS px 폭 */
export function measureHangulPx(el: Element): number {
  const style = getComputedStyle(el)
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  if (!measureCanvas) measureCanvas = document.createElement("canvas")
  const ctx = measureCanvas.getContext("2d")
  if (!ctx) return parseFloat(style.fontSize) || 14
  ctx.font = font
  const width = ctx.measureText("가").width
  return width > 0 ? width : parseFloat(style.fontSize) || 14
}

/** 좌우 패딩(px-3=24) + 정렬 아이콘 여유 */
export const COL_PAD_PX = 32

export function minWidthPx(units: number, hangulPx: number, padPx = COL_PAD_PX): number {
  return Math.ceil(Math.max(units, 2) * hangulPx + padPx)
}

/** 헤더와 내용 중 더 긴 쪽 */
export function colMinPx(headerUnits: number, contentUnits: number, hangulPx: number): number {
  return minWidthPx(Math.max(headerUnits, contentUnits), hangulPx)
}

export type StackBudget = {
  mergedHeaderUnits: number
  primaryHeaderUnits: number
  secondaryHeaderUnits: number
  primaryContentUnits: number
  secondaryContentUnits: number
}

export function stackWidths(stack: StackBudget, hangulPx: number): { merged: number; split: number } {
  const primary = colMinPx(stack.primaryHeaderUnits, stack.primaryContentUnits, hangulPx)
  const secondary = colMinPx(stack.secondaryHeaderUnits, stack.secondaryContentUnits, hangulPx)
  const merged = minWidthPx(
    Math.max(stack.mergedHeaderUnits, stack.primaryContentUnits, stack.secondaryContentUnits),
    hangulPx,
  )
  return { merged, split: primary + secondary }
}

/**
 * 고정 칸 + 묶음 칸이 헤더·내용 최소 폭을 지키려면 어디까지 펼칠 수 있는지.
 * 앞에서부터 여유가 되는 묶음만 펼친다. 좁아지면 뒤에서부터 다시 합친다.
 */
export function pickSplitStacks(
  width: number,
  hangulPx: number,
  fixedMin: number,
  stacks: StackBudget[],
  prev: boolean[],
): boolean[] {
  const hysteresis = hangulPx * 2
  const sizes = stacks.map((s) => stackWidths(s, hangulPx))
  const next = stacks.map(() => false)
  let need = fixedMin + sizes.reduce((sum, s) => sum + s.merged, 0)

  for (let i = 0; i < stacks.length; i++) {
    const extra = sizes[i].split - sizes[i].merged
    const wasSplit = prev[i] === true
    const threshold = wasSplit ? extra - hysteresis : extra
    if (width >= need + threshold) {
      next[i] = true
      need += extra
    }
  }
  return next
}
