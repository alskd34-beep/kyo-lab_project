"use client"

import { useEffect, useRef, useState } from "react"

import { colMinPx, hangulUnits, measureHangulPx } from "@frontend/lib/hangul-width"

/** 한 칸이 답답하지 않게 쓰려면 필요한 최소 폭. 화면마다 px 브레이크포인트를 두지 않는다. */
export const DEFAULT_MIN_COL_WIDTH = 100

/** 경계에서 펼침/접힘이 떨리지 않도록 두는 여유 폭(px) */
const HYSTERESIS = 24

function readContainerWidth(el: HTMLElement): number {
  return el.offsetWidth
}

/**
 * 단계별 칸 수와 컨테이너 폭만으로 펼침 단계를 고른다.
 * `colCounts[i]` 칸 레이아웃은 폭이 `칸수 × minColWidth` 이상일 때 쓴다.
 */
export function computeAdaptiveLevel(
  width: number,
  colCounts: readonly number[],
  prev: number,
  minColWidth: number = DEFAULT_MIN_COL_WIDTH,
): number {
  if (colCounts.length === 0) return 0
  let next = 0
  for (let i = 1; i < colCounts.length; i++) {
    const need = colCounts[i] * minColWidth
    const threshold = prev >= i ? need - HYSTERESIS : need
    if (width < threshold) break
    next = i
  }
  return next
}

/**
 * 창 크기·브라우저 확대(Ctrl +/-)·visualViewport 변화에 맞춰 onChange 를 호출한다.
 * 핀치 줌은 레이아웃을 바꾸지 않으므로 offsetWidth 가 같으면 단계는 그대로다.
 */
function subscribeViewportSignals(onChange: () => void): () => void {
  window.addEventListener("resize", onChange)

  const visualViewport = window.visualViewport
  visualViewport?.addEventListener("resize", onChange)

  let dprQuery: MediaQueryList | null = null
  const onDprChange = () => {
    listenDpr()
    onChange()
  }
  const listenDpr = () => {
    dprQuery?.removeEventListener("change", onDprChange)
    const dpr = window.devicePixelRatio
    dprQuery = window.matchMedia(`(resolution: ${dpr}dppx), (-webkit-device-pixel-ratio: ${dpr})`)
    dprQuery.addEventListener("change", onDprChange)
  }
  listenDpr()

  return () => {
    window.removeEventListener("resize", onChange)
    visualViewport?.removeEventListener("resize", onChange)
    dprQuery?.removeEventListener("change", onDprChange)
  }
}

/**
 * 표 컨테이너 폭을 보고 "묶인 컬럼"을 몇 단계까지 펼칠지 계산한다.
 *
 * 화면마다 1080·1300 같은 px 를 정하지 않는다. 각 단계의 **칸 수**만 넘기면
 * (`[7, 11, 12]`) 폭이 `칸수 × 100px` 를 넘는 순간 다음 단계로 올라간다.
 * 사이드바 접힘·분할 화면·브라우저 확대/축소에도 같은 기준으로 다시 잰다.
 *
 * ```tsx
 * const level = useAdaptiveColumnLevel(isMobile ? null : el, [5, 8])
 * const split = level >= 1
 * ```
 */
export function useAdaptiveColumnLevel(
  el: HTMLElement | null,
  colCounts: readonly number[],
  minColWidth: number = DEFAULT_MIN_COL_WIDTH,
): number {
  const [observedLevel, setObservedLevel] = useState(0)
  const colCountsRef = useRef(colCounts)
  const minColRef = useRef(minColWidth)
  useEffect(() => {
    colCountsRef.current = colCounts
    minColRef.current = minColWidth
  }, [colCounts, minColWidth])

  useEffect(() => {
    if (!el) return

    const apply = () => {
      const width = readContainerWidth(el)
      setObservedLevel((prev) => {
        const next = computeAdaptiveLevel(width, colCountsRef.current, prev, minColRef.current)
        return next === prev ? prev : next
      })
    }

    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        apply()
      })
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(el, { box: "border-box" })
    const stopViewport = subscribeViewportSignals(schedule)
    apply()

    return () => {
      observer.disconnect()
      stopViewport()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el, colCounts, minColWidth])

  return el ? observedLevel : 0
}

/** @deprecated `useAdaptiveColumnLevel` 을 쓰세요. 두 번째 인자는 칸 수 배열입니다. */
export const useColumnExpandLevel = useAdaptiveColumnLevel

export type HangulFitLevel = {
  headers: readonly string[]
  /** 각 칸에서 가장 긴 내용. 없으면 헤더만 본다. */
  contents?: readonly string[]
}

/**
 * 헤더·내용 한글 자수 × 한 자 폭의 합이 표 너비에 들어가는 가장 높은 단계를 고른다.
 */
export function useHangulFitLevel(el: HTMLElement | null, levels: readonly HangulFitLevel[]): number {
  const [level, setLevel] = useState(0)
  const levelsRef = useRef(levels)
  useEffect(() => {
    levelsRef.current = levels
  }, [levels])

  useEffect(() => {
    if (!el) return

    const apply = () => {
      const width = readContainerWidth(el)
      const table = el.querySelector("[data-slot=table]") ?? el
      const hangulPx = measureHangulPx(table)
      const hysteresis = hangulPx * 2

      setLevel((prev) => {
        let next = 0
        for (let i = 1; i < levelsRef.current.length; i++) {
          const spec = levelsRef.current[i]
          let need = 0
          for (let c = 0; c < spec.headers.length; c++) {
            // 가장 긴 한두 건 때문에 펼침이 영구히 막히지 않게 내용 최소 폭은 12자로 본다.
            const contentUnits = Math.min(hangulUnits(spec.contents?.[c] ?? ""), 12)
            need += colMinPx(hangulUnits(spec.headers[c] ?? ""), contentUnits, hangulPx)
          }
          const threshold = prev >= i ? need - hysteresis : need
          if (width < threshold) break
          next = i
        }
        return next === prev ? prev : next
      })
    }

    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        apply()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el, { box: "border-box" })
    const stopViewport = subscribeViewportSignals(schedule)
    apply()
    return () => {
      observer.disconnect()
      stopViewport()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el, levels])

  return el ? level : 0
}
