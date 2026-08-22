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
    // ResizeObserver 는 observe() 직후 현재 크기로 한 번 호출된다(사양). 그래서
    // 최초 측정을 effect 본문에서 setState 로 밀어 넣을 필요가 없다 —
    // 구독 콜백 안에서 갱신하면 cascading render 없이 같은 결과를 얻는다.
    // 스크롤 위치도 여기서 같이 읽어, 이미 스크롤된 채로 마운트되는 경우(bfcache 복원 등)를 덮는다.
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight)
      setScrollTop(el.scrollTop)
    })
    el.addEventListener("scroll", onScroll, { passive: true })
    ro.observe(el)

    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el])

  /**
   * 검색 등으로 목록이 짧아지면 현재 스크롤 위치가 끝을 넘어가 빈 화면이 보인다.
   *
   * 예전에는 이 상황을 effect 안에서 `el.scrollTop = max` + `setScrollTop(max)` 로 처리했다.
   * 그러면 effect 가 다시 렌더를 유발해(cascading render) 한 프레임 어긋난 창이 먼저 그려진다.
   * 지금은 **렌더 중에 값을 깎고**(clampedTop), effect 는 실제 DOM 스크롤만 맞춘다.
   * 스크롤이 실제로 움직이면 scroll 리스너가 setScrollTop 으로 따라온다.
   */
  const maxScroll = Math.max(0, itemCount * estimateSize - height)
  const clampedTop = Math.min(scrollTop, maxScroll)

  useEffect(() => {
    if (!el) return
    const max = Math.max(0, itemCount * estimateSize - el.clientHeight)
    if (el.scrollTop > max) el.scrollTo({ top: max })
  }, [el, itemCount, estimateSize])

  const start = Math.max(0, Math.floor(clampedTop / estimateSize) - overscan)
  const end = Math.min(itemCount, Math.ceil((clampedTop + height) / estimateSize) + overscan)

  return {
    containerRef,
    start,
    end,
    padTop: start * estimateSize,
    padBottom: Math.max(0, (itemCount - end) * estimateSize),
  }
}
