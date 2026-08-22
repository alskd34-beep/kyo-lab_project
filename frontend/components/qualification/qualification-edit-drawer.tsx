"use client"

/**
 * 자격 1건 부여·수정·해제 패널.
 *
 * 매트릭스 셀을 누르면 (시험자 × OJT 항목 × 자격종류) 한 칸을 편집한다.
 * 재인증도 같은 칸의 갱신이라 새 행을 만들지 않는다(서버가 upsert).
 */

import { useEffect, useState } from "react"
import { Save, Trash2 } from "lucide-react"

import { api, errorMessage } from "@frontend/lib/api-client"
import { Button } from "@frontend/components/ui/button"
import { DateField } from "@frontend/components/ui/date-field"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  CERT_METHODS, CERT_TYPES, QUALIFICATION_ROLES, calcExpiryDate, daysUntilExpiry, todayIso,
} from "@shared/qualification"
import type { QualItem, QualTester, TesterQual } from "./types"

export interface QualEditTarget {
  tester: QualTester
  item: QualItem
  role: string
  /** 기존 자격. null 이면 신규 부여 */
  existing: TesterQual | null
}

interface Props {
  target: QualEditTarget | null
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] " +
  "focus-visible:ring-ring/50 focus-visible:outline-none"

export function QualificationEditDrawer({ target, onClose, onSaved }: Props) {
  const [role, setRole] = useState<string>("시험자")
  const [grantedOn, setGrantedOn] = useState("")
  const [expiresOn, setExpiresOn] = useState("")
  const [certType, setCertType] = useState<string>("최초인증")
  const [certMethod, setCertMethod] = useState<string>("OJT")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 대상이 바뀔 때마다 폼을 다시 채운다. 신규 부여는 오늘 날짜 + 항목 유효기간으로 미리 계산해 둔다.
  useEffect(() => {
    if (!target) return
    const ex = target.existing
    // toISOString() 은 UTC 라 한국 시간 오전에는 하루 전 날짜가 된다 — 보는 사람의 날짜를 쓴다.
    const today = todayIso()
    setRole(ex?.qualificationRole ?? target.role)
    setGrantedOn(ex?.grantedOn ?? today)
    setExpiresOn(ex?.expiresOn ?? calcExpiryDate(today, target.item.validMonths) ?? "")
    setCertType(ex?.certType ?? "최초인증")
    setCertMethod(ex?.certMethod ?? "OJT")
    setNote(ex?.note ?? target.item.note ?? "")
    setErr(null)
  }, [target])

  if (!target) return null
  const { tester, item, existing } = target
  const daysLeft = daysUntilExpiry(expiresOn || null)

  /** 부여일을 바꾸면 만료일도 항목 유효기간에 맞춰 따라오게 한다(직접 고친 값은 그대로 두지 않는다). */
  function changeGranted(value: string) {
    setGrantedOn(value)
    const auto = calcExpiryDate(value, item.validMonths)
    if (auto) setExpiresOn(auto)
  }

  async function save() {
    if (!grantedOn) { setErr("자격부여일을 입력하세요."); return }
    setSaving(true)
    setErr(null)
    try {
      if (existing) {
        await api.patch("/api/tester-qualifications", {
          id: existing.id,
          qualificationRole: role,
          grantedOn,
          expiresOn: expiresOn || null,
          certType,
          certMethod,
          note,
        })
      } else {
        await api.post("/api/tester-qualifications", {
          testerId: tester.id,
          qualificationItemId: item.id,
          qualificationRole: role,
          grantedOn,
          expiresOn: expiresOn || null,
          certType,
          certMethod,
          note,
        })
      }
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function revoke() {
    if (!existing) return
    setSaving(true)
    setErr(null)
    try {
      await api.del("/api/tester-qualifications", { id: existing.id })
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ManagementDrawer
      open
      onOpenChange={o => { if (!o) onClose() }}
      size="md"
      title={existing ? "자격 수정" : "자격 부여"}
      description={`${tester.name} (${tester.employeeNo}) · ${item.categoryName} / ${item.name}`}
      footer={(
        <>
          {existing && (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => void revoke()}
              disabled={saving}
            >
              <Trash2 />
              {saving ? "처리 중..." : "자격 해제"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void save()} disabled={saving}>
            <Save />
            {saving ? "저장 중..." : existing ? "저장" : "부여"}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">인증 정보</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="자격종류">
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUALIFICATION_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="인증구분">
              <Select value={certType} onValueChange={setCertType}>
                <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="인증방법" full>
              <Select value={certMethod} onValueChange={setCertMethod}>
                <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">유효기간</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label="자격부여일" value={grantedOn} onChange={changeGranted} size="sm" />
            <DateField
              label="자격만료일"
              helper={`비우면 무기한 · 기본 ${item.validMonths}개월`}
              value={expiresOn}
              onChange={setExpiresOn}
              size="sm"
            />
          </div>
          {expiresOn && daysLeft != null && (
            <p className="mt-2 text-xs text-muted-foreground">
              {daysLeft < 0
                ? `만료일이 ${-daysLeft}일 지났습니다.`
                : `만료까지 ${daysLeft}일 남았습니다.`}
            </p>
          )}
        </section>

        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">비고</h3>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="재인증 생략 승인 등 특이사항"
            className={inputCls}
          />
        </section>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
            {err}
          </div>
        )}
      </div>
    </ManagementDrawer>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-xs font-semibold text-foreground">{label}</label>
      {children}
    </div>
  )
}
