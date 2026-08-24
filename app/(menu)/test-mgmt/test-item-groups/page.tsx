"use client"

import { useEffect, useState } from "react"

import { api, errorMessage } from "@frontend/lib/api-client"
import {
  TestItemGroupPanel,
  type GroupCandidateItem,
} from "@frontend/components/test-mgmt/test-item-group-panel"

/**
 * 시험항목 그룹(템플릿) 관리 화면.
 *
 * 예전에는 시험항목 마스터 화면 상단 탭으로 붙어 있었지만, 마스터(개별 항목)와
 * 그룹(항목 묶음)은 서로 다른 개념이라 사이드바 메뉴부터 분리했다.
 * 그룹에 담을 후보 목록만 여기서 불러와 패널에 넘긴다.
 */
export default function TestItemGroupsPage() {
  const [candidates, setCandidates] = useState<GroupCandidateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await api.get<{ rows: GroupCandidateItem[] }>("/api/test-items")
        if (alive) setCandidates(data.rows ?? [])
      } catch (e) {
        if (alive) setError(errorMessage(e, "시험항목을 불러오지 못했습니다."))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* 오류색은 시맨틱 토큰(destructive)으로 — 화면마다 red-50/red-700 을 직접 고르면 톤이 갈린다 */}
      {error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm break-keep text-destructive">
          {error}
        </div>
      )}
      <TestItemGroupPanel candidates={candidates} candidatesLoading={loading} />
    </div>
  )
}
