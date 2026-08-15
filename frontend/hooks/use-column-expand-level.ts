"use client"

import { useEffect, useRef, useState } from "react"

/** 경계에서 펼침/접힘이 떨리지 않도록 두는 여유 폭(px) */
const HYSTERESIS = 24

/**
 * 표 컨테이너의 실제 너비를 관찰해 "묶인 컬럼"을 몇 단계까지 펼칠지 계산한다.
 *
 * - `el`: 관찰할 스크롤 컨테이너. `null` 이면 항상 0단계(전부 묶음)를 반환한다.
 * - `breakpoints`: 오름차순 px 목록. 컨테이너가 넓어지면 앞 단계부터 차례로 펼쳐진다.
 * - 반환값: 만족한 단계 수(`0` ~ `breakpoints.length`). 원시값이라 `memo` 된 행에 그대로 넘겨도 안전하다.
 *
 * 화면(window)이 아니라 표 컨테이너 기준이라 사이드바 접힘·분할 화면·확대에도 그대로 반응한다.
 * 좁아질 때는 `HYSTERESIS` 만큼 더 좁아져야 다시 합쳐지므로 경계에서 깜빡이지 않는다.
 *
 * ```tsx
 * const level = useColumnExpandLevel(isMobile ? null : containerEl, [860, 1020, 1180])
 * const columns = COLUMN_LEVELS[level]
 * ```
 */
export function useColumnExpandLevel(el: HTMLElement | null, breakpoints: number[]): number {
  const [observedLevel, setObservedLevel] = useState(0)
  // 호출부가 배열을 인라인으로 넘겨도 옵저버가 재구독되지 않도록 ref 로 들고 있는다
  const breakpointsRef = useRef(breakpoints)
  useEffect(() => {
    breakpointsRef.current = breakpoints
  }, [breakpoints])

  useEffect(() => {
    if (!el) return   // el 이 없으면 구독할 대상이 없다 — 아래 return 문에서 0으로 처리

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      // border-box 기준 — 세로 스크롤바가 생겨도 값이 흔들리지 않는다
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width

      setObservedLevel((prev) => {
        const bps = breakpointsRef.current
        let next = 0
        while (next < bps.length) {
          // 이미 펼쳐진 단계는 HYSTERESIS 만큼 더 좁아져야 접힌다
          const threshold = prev > next ? bps[next] - HYSTERESIS : bps[next]
          if (width < threshold) break
          next++
        }
        return next === prev ? prev : next
      })
    })

    observer.observe(el, { box: "border-box" })
    return () => observer.disconnect()
  }, [el])

  // el 이 없는 동안(모바일 카드뷰 등)은 관찰 대상이 없으므로 항상 0단계.
  return el ? observedLevel : 0
}
