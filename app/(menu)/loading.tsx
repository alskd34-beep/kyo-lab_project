'use client'

import { usePathname } from 'next/navigation'
import { PageSkeleton } from '@frontend/components/common/page-skeleton'
import type { PageSkeletonVariant } from '@frontend/components/common/page-skeleton'

export default function MenuLoading() {
  const pathname = usePathname() ?? ''
  let variant: PageSkeletonVariant = 'table'

  if (
    pathname === '/home' ||
    pathname.startsWith('/insights/') ||
    pathname === '/schedule/dashboard'
  ) {
    variant = 'dashboard'
  } else if (
    pathname === '/schedule/monthly' ||
    pathname === '/schedule/weekly' ||
    pathname === '/schedule/weekly-plan'
  ) {
    variant = 'board'
  } else if (
    pathname === '/settings/sys-settings' ||
    pathname === '/test-mgmt/pretest-checklist'
  ) {
    variant = 'detail'
  }

  return <PageSkeleton variant={variant} />
}
