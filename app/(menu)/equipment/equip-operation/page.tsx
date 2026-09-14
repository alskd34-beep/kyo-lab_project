import { EquipOperationView } from '@frontend/components/equipment/equip-operation-view'

// 장비 서버 주소는 환경변수로 받는다. 빌드 결과에 주소가 박히면 IP 가 바뀔 때마다
// 다시 배포해야 하므로, 빌드 시점이 아니라 요청 시점에 읽는다.
export const dynamic = 'force-dynamic'

export default function EquipOperationPage() {
  const schedulerUrl = process.env.SAMPLE_SCHEDULER_URL?.trim() || null

  return <EquipOperationView schedulerUrl={schedulerUrl} />
}
