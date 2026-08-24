"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * 스크롤 컨테이너 안에서 보이는 구간만 계산한다.
 * 품목 마스터처럼 수백 행을 한 번에 그리면 메인 스레드가 멈춘다.
 * 검색으로 itemCount 가 바뀌어도 리스너는 다시 달지 않는다.
 *
 * ── 행 높이는 상수로 받지 않고 **실제로 그려진 행을 재서** 쓴다 ─────────────
 * 예전에는 호출부가 `ROW_HEIGHT = 52` 같은 상수를 넘겼는데, 이 프로젝트의 루트
 * 폰트가 18px 이라(`app/styles/typography.scss`) Tailwind `h-14` 는 56px 이 아니라
 * **63px** 이다. 세 화면 모두 상수가 실제 높이와 어긋나 있었고, 행마다 오차가
 * 쌓여 스크롤 위치가 밀렸다. 클래스를 바꿀 때마다 상수를 같이 고쳐야 하는 것도
 * 지켜지지 않았다.
 *
 * 이제 호출부는 렌더된 행 **아무거나 하나**에 `itemRef` 를 달아 주기만 하면 되고,
 * 훅이 ResizeObserver 로 그 높이를 읽어 창을 계산한다. `fallbackSize` 는 첫
 * 페인트에서 아직 잰 값이 없을 때만 쓰이는 대략치다.
 */
export function useVirtualWindow(itemCount: number, fallbackSize = 40, overscan = 12) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [rowEl, setRowEl] = useState<HTMLElement | null>(null)
  const [measured, setMeasured] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setEl(node)
  }, [])

  /** 렌더된 행 하나에 달아 준다. 어느 행이든 상관없다(모두 같은 높이라는 전제). */
  const itemRef = useCallback((node: HTMLElement | null) => {
    setRowEl(node)
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
   * 행 높이 실측. 폰트 로딩·창 폭 변화(모바일 카드 ↔ 데스크톱 행)로 높이가
   * 바뀌면 ResizeObserver 가 다시 알려 준다. 같은 값이면 setState 를 건너뛰어
   * 불필요한 렌더를 만들지 않는다.
   */
  useEffect(() => {
    if (!rowEl) return
    const ro = new ResizeObserver(() => {
      const next = rowEl.offsetHeight
      if (next > 0) setMeasured(prev => (prev === next ? prev : next))
    })
    ro.observe(rowEl)
    return () => ro.disconnect()
  }, [rowEl])

  const itemSize = measured ?? fallbackSize

  /**
   * 검색 등으로 목록이 짧아지면 현재 스크롤 위치가 끝을 넘어가 빈 화면이 보인다.
   *
   * 예전에는 이 상황을 effect 안에서 `el.scrollTop = max` + `setScrollTop(max)` 로 처리했다.
   * 그러면 effect 가 다시 렌더를 유발해(cascading render) 한 프레임 어긋난 창이 먼저 그려진다.
   * 지금은 **렌더 중에 값을 깎고**(clampedTop), effect 는 실제 DOM 스크롤만 맞춘다.
   * 스크롤이 실제로 움직이면 scroll 리스너가 setScrollTop 으로 따라온다.
   */
  const maxScroll = Math.max(0, itemCount * itemSize - height)
  const clampedTop = Math.min(scrollTop, maxScroll)

  useEffect(() => {
    if (!el) return
    const max = Math.max(0, itemCount * itemSize - el.clientHeight)
    if (el.scrollTop > max) el.scrollTo({ top: max })
  }, [el, itemCount, itemSize])

  const start = Math.max(0, Math.floor(clampedTop / itemSize) - overscan)
  const end = Math.min(itemCount, Math.ceil((clampedTop + height) / itemSize) + overscan)

  return {
    containerRef,
    itemRef,
    start,
    end,
    padTop: start * itemSize,
    padBottom: Math.max(0, (itemCount - end) * itemSize),
  }
}
