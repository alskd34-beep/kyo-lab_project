"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * 스크롤 컨테이너 안에서 보이는 구간만 계산한다.
 * 품목 마스터처럼 수백 행을 한 번에 그리면 메인 스레드가 멈춘다.
 * 검색으로 itemCount 가 바뀌어도 리스너는 다시 달지 않는다.
 */
export function useVirtualWindow(itemCount: number, estimateSize = 40, overscan = 12) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setEl(node)
  }, [])

  useEffect(() => {
    if (!el) return

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setScrollTop(el.scrollTop)
      })
    }
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    el.addEventListener("scroll", onScroll, { passive: true })
    ro.observe(el)
    setHeight(el.clientHeight)
    setScrollTop(el.scrollTop)

    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el])

  useEffect(() => {
    if (!el) return
    const maxScroll = Math.max(0, itemCount * estimateSize - el.clientHeight)
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll
      setScrollTop(maxScroll)
    }
  }, [el, itemCount, estimateSize])

  const start = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan)
  const end = Math.min(itemCount, Math.ceil((scrollTop + height) / estimateSize) + overscan)

  return {
    containerRef,
    start,
    end,
    padTop: start * estimateSize,
    padBottom: Math.max(0, (itemCount - end) * estimateSize),
  }
}
