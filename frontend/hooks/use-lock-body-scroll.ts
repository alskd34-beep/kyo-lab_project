import { useLayoutEffect } from "react"

/**
 * 모달/오버레이가 열려 있는 동안 body 스크롤을 잠근다.
 * - 뒤 배경이 같이 스크롤되는(scroll chaining) 현상 방지.
 * - 스크롤바가 사라지며 생기는 레이아웃 이동을 padding-right 로 보정.
 * - 여러 모달이 동시에/중첩으로 열려도 ref-count 로 안전하게 처리.
 */
let lockCount = 0
let prevOverflow = ""
let prevPaddingRight = ""

export function useLockBodyScroll(active = true): void {
  useLayoutEffect(() => {
    if (!active) return
    const body = document.body

    if (lockCount === 0) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      prevOverflow = body.style.overflow
      prevPaddingRight = body.style.paddingRight
      body.style.overflow = "hidden"
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
    }
    lockCount++

    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) {
        body.style.overflow = prevOverflow
        body.style.paddingRight = prevPaddingRight
      }
    }
  }, [active])
}
