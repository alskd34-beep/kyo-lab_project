import { supabase } from '@backend/lib/supabase'

export interface ManhoursRow {
  id: string
  productId: string
  productCode: string
  productName: string
  packageUnit: string
  avgHours: number
  updatedAt: string | null
}

export async function listManhours(): Promise<ManhoursRow[]> {
  const { data, error } = await supabase
    .from('product_manhours')
    .select(`
      id,
      product_id,
      package_unit,
      avg_hours,
      updated_at,
      products (
        product_code,
        name
      )
    `)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map(r => ({
    id:          r.id as string,
    productId:   r.product_id as string,
    productCode: (r.products as { product_code: string; name: string } | null)?.product_code ?? '',
    productName: (r.products as { product_code: string; name: string } | null)?.name ?? '',
    packageUnit: r.package_unit as string,
    avgHours:    r.avg_hours as number,
    updatedAt:   r.updated_at as string | null,
  }))
}

export async function updateManhour(id: string, avgHours: number): Promise<void> {
  const { error } = await supabase
    .from('product_manhours')
    .update({ avg_hours: avgHours, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteManhour(id: string): Promise<void> {
  const { error } = await supabase
    .from('product_manhours')
    .delete()
    .eq('id', id)
  if (error) throw error
}
