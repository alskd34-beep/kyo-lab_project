"use client"

import { useEffect, useRef, useState } from "react"

/** 경계에서 펼침/접힘이 떨리지 않도록 두는 여유 폭(px) */
const HYSTERESIS = 24

/**
 * 표 컨테이너의 실제 레이아웃 너비(CSS px, border-box).
 * ResizeObserver 엔트리 대신 살아 있는 레이아웃 값을 쓴다.
 * Ctrl +/- 브라우저 확대는 CSS 픽셀 폭을 바꾸는데, 일부 브라우저에선
 * ResizeObserver 콜백이 오지 않거나 borderBoxSize 가 구 값을 유지한다.
 */
function readContainerWidth(el: HTMLElement): number {
  return el.offsetWidth
}

function computeExpandLevel(width: number, prev: number, breakpoints: number[]): number {
  let next = 0
  while (next < breakpoints.length) {
    // 이미 펼쳐진 단계는 HYSTERESIS 만큼 더 좁아져야 접힌다
    const threshold = prev > next ? breakpoints[next] - HYSTERESIS : breakpoints[next]
    if (width < threshold) break
    next++
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
 * 표 컨테이너의 실제 너비를 관찰해 "묶인 컬럼"을 몇 단계까지 펼칠지 계산한다.
 *
 * - `el`: 관찰할 스크롤 컨테이너. `null` 이면 항상 0단계(전부 묶음)를 반환한다.
 * - `breakpoints`: 오름차순 px 목록. 컨테이너가 넓어지면 앞 단계부터 차례로 펼쳐진다.
 * - 반환값: 만족한 단계 수(`0` ~ `breakpoints.length`). 원시값이라 `memo` 된 행에 그대로 넘겨도 안전하다.
 *
 * 화면(window)이 아니라 표 컨테이너 기준이라 사이드바 접힘·분할 화면·창 크기 변경에 반응한다.
 * 브라우저 확대/축소(Ctrl +/-)는 CSS 픽셀 폭을 바꾸므로 같은 기준으로 다시 잰다.
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

    const apply = () => {
      const width = readContainerWidth(el)
      setObservedLevel((prev) => {
        const next = computeExpandLevel(width, prev, breakpointsRef.current)
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
  }, [el])

  // el 이 없는 동안(모바일 카드뷰 등)은 관찰 대상이 없으므로 항상 0단계.
  return el ? observedLevel : 0
}
