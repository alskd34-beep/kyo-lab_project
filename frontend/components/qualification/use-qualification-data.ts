"use client"

/**
 * 자격 인증 데이터 로딩.
 *
 * 시험자 관리 화면의 역량 탭(`fetchCapabilities`)과 같은 방식으로, 탭을 처음 열 때만
 * 한 번 불러오고 그 뒤에는 캐시를 쓴다. 자격을 부여·수정하면 `reload()` 로 다시 받는다.
 */

import { useCallback, useMemo, useState } from "react"

import { api, errorMessage } from "@frontend/lib/api-client"
import { qualificationStatus, type QualificationStatus } from "@shared/qualification"
import type { QualItem, QualificationOverview, TesterQual } from "./types"

const EMPTY: QualificationOverview = { categories: [], items: [], testers: [], quals: [] }

export interface QualificationData {
  data: QualificationOverview
  loading: boolean
  error: string | null
  /** 탭을 열 때 호출 — 이미 받아왔으면 아무것도 하지 않는다 */
  ensureLoaded: () => Promise<void>
  /** 저장 후 강제 재조회 */
  reload: () => Promise<void>
  /** 선택한 자격종류에서 (시험자, 항목) 의 자격 */
  qualAt: (testerId: string, itemId: string) => TesterQual | null
  /** 상태별 집계 — 주어진 시험자·항목 조합 전체를 센다 */
  countByStatus: (testerIds: string[], items: QualItem[]) => Record<QualificationStatus, number>
}

export function useQualificationData(role: string): QualificationData {
  const [data, setData] = useState<QualificationOverview>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<QualificationOverview>("/api/tester-qualifications"))
      setLoaded(true)
    } catch (e) {
      setError(errorMessage(e))
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  const ensureLoaded = useCallback(async () => {
    if (loaded || loading) return
    await fetchAll()
  }, [loaded, loading, fetchAll])

  /** 선택한 자격종류의 자격만 (시험자, 항목) 키로 색인 */
  const index = useMemo(() => {
    const m = new Map<string, TesterQual>()
    for (const q of data.quals) {
      if (q.qualificationRole !== role) continue
      m.set(`${q.testerId}__${q.qualificationItemId}`, q)
    }
    return m
  }, [data.quals, role])

  const qualAt = useCallback(
    (testerId: string, itemId: string) => index.get(`${testerId}__${itemId}`) ?? null,
    [index],
  )

  const countByStatus = useCallback((testerIds: string[], items: QualItem[]) => {
    const acc: Record<QualificationStatus, number> = { valid: 0, expiring: 0, expired: 0, none: 0 }
    for (const testerId of testerIds) {
      for (const item of items) {
        const q = index.get(`${testerId}__${item.id}`)
        // 서버 status 를 쓰지 않고 만료일로 다시 판정한다 — 서버 UTC / 사용자 KST 하루 차이 때문.
        acc[q ? qualificationStatus(q.expiresOn) : "none"] += 1
      }
    }
    return acc
  }, [index])

  return { data, loading, error, ensureLoaded, reload: fetchAll, qualAt, countByStatus }
}
