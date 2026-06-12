interface TableauCredentials {
  token: string
  siteId: string
  siteContentUrl: string
  userId: string
}

export interface TableauWorkbookSummary {
  id: string
  name: string
  projectName: string | null
  updatedAt: string | null
  webUrl: string | null
}

export interface TableauViewSummary {
  id: string
  name: string
  workbookName: string | null
  projectName: string | null
  updatedAt: string | null
  webUrl: string | null
}

export interface TableauSummary {
  configured: boolean
  generatedAt: string
  serverUrl: string | null
  siteContentUrl: string | null
  workbooks: TableauWorkbookSummary[]
  views: TableauViewSummary[]
  missingEnv?: string[]
}

const DEFAULT_API_VERSION = '3.29'

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = env(name)
    if (value) return value
  }
  return undefined
}

function getConfig() {
  const serverUrl = firstEnv('TABLEAU_SERVER_URL', 'TABLEAU_BASE_URL')
  const apiVersion = firstEnv('TABLEAU_API_VERSION') ?? DEFAULT_API_VERSION
  const siteContentUrl = process.env.TABLEAU_SITE_CONTENT_URL?.trim() ?? ''
  const patName = firstEnv('TABLEAU_PAT_NAME', 'TABLEAU_TOKEN_NAME', 'TABLEAU_PERSONAL_ACCESS_TOKEN_NAME')
  const patSecret = firstEnv(
    'TABLEAU_PAT_SECRET',
    'TABLEAU_TOKEN_SECRET',
    'TABLEAU_TOKEN_KEY',
    'TABLEAU_PERSONAL_ACCESS_TOKEN_SECRET',
    'Tableau_token_key',
  )

  const missingEnv = [
    !serverUrl && 'TABLEAU_SERVER_URL',
    !patName && 'TABLEAU_PAT_NAME',
    !patSecret && 'TABLEAU_PAT_SECRET',
  ].filter(Boolean) as string[]

  return {
    serverUrl: serverUrl?.replace(/\/+$/, '') ?? null,
    apiVersion,
    siteContentUrl,
    patName,
    patSecret,
    missingEnv,
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

async function tableauFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })

  const body = await res.text()
  const json = body ? JSON.parse(body) : null

  if (!res.ok) {
    const detail = json?.error?.detail ?? json?.error?.summary ?? body
    throw new Error(detail || `Tableau API 오류 (${res.status})`)
  }

  return json as T
}

async function signIn(): Promise<{ credentials: TableauCredentials; apiBase: string }> {
  const config = getConfig()
  if (!config.serverUrl || !config.patName || !config.patSecret) {
    throw new Error(`Tableau 환경변수 미설정: ${config.missingEnv.join(', ')}`)
  }

  const apiBase = `${config.serverUrl}/api/${config.apiVersion}`
  const data = await tableauFetch<{
    credentials: {
      token: string
      site: { id: string; contentUrl: string }
      user: { id: string }
    }
  }>(`${apiBase}/auth/signin`, {
    method: 'POST',
    body: JSON.stringify({
      credentials: {
        personalAccessTokenName: config.patName,
        personalAccessTokenSecret: config.patSecret,
        site: { contentUrl: config.siteContentUrl },
      },
    }),
  })

  return {
    apiBase,
    credentials: {
      token: data.credentials.token,
      siteId: data.credentials.site.id,
      siteContentUrl: data.credentials.site.contentUrl,
      userId: data.credentials.user.id,
    },
  }
}

async function signOut(apiBase: string, token: string): Promise<void> {
  await fetch(`${apiBase}/auth/signout`, {
    method: 'POST',
    headers: { 'X-Tableau-Auth': token },
    cache: 'no-store',
  }).catch(() => null)
}

export async function getTableauSummary(limit = 6): Promise<TableauSummary> {
  const config = getConfig()
  if (config.missingEnv.length > 0) {
    return {
      configured: false,
      generatedAt: new Date().toISOString(),
      serverUrl: config.serverUrl,
      siteContentUrl: config.siteContentUrl,
      workbooks: [],
      views: [],
      missingEnv: config.missingEnv,
    }
  }

  const { apiBase, credentials } = await signIn()

  try {
    const headers = { 'X-Tableau-Auth': credentials.token }
    const pageSize = String(Math.max(limit, 1))
    const [workbookData, viewData] = await Promise.all([
      tableauFetch<{
        workbooks?: {
          workbook?: Array<{
            id: string
            name: string
            updatedAt?: string
            webpageUrl?: string
            project?: { name?: string }
          }>
        }
      }>(`${apiBase}/sites/${credentials.siteId}/workbooks?pageSize=${pageSize}`, { headers }),
      tableauFetch<{
        views?: {
          view?: Array<{
            id: string
            name: string
            updatedAt?: string
            contentUrl?: string
            viewUrlName?: string
            workbook?: { name?: string }
            project?: { name?: string }
          }>
        }
      }>(`${apiBase}/sites/${credentials.siteId}/views?pageSize=${pageSize}`, { headers }),
    ])

    const workbooks = asArray(workbookData.workbooks?.workbook).map(workbook => ({
      id: workbook.id,
      name: workbook.name,
      projectName: workbook.project?.name ?? null,
      updatedAt: workbook.updatedAt ?? null,
      webUrl: workbook.webpageUrl ?? null,
    }))

    const views = asArray(viewData.views?.view).map(view => ({
      id: view.id,
      name: view.name,
      workbookName: view.workbook?.name ?? null,
      projectName: view.project?.name ?? null,
      updatedAt: view.updatedAt ?? null,
      webUrl: view.contentUrl ?? view.viewUrlName ?? null,
    }))

    return {
      configured: true,
      generatedAt: new Date().toISOString(),
      serverUrl: config.serverUrl,
      siteContentUrl: credentials.siteContentUrl,
      workbooks,
      views,
    }
  } finally {
    await signOut(apiBase, credentials.token)
  }
}
