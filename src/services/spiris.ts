import { request } from 'undici'
import { SPIRIS_CLIENT_ID, SPIRIS_CLIENT_SECRET, SPIRIS_IDENTITY_BASE_URI, SPIRIS_API_BASE_URI, DATA_DIRECTORY } from '../config.js'
import { CollisionError, UnauthenticatedError, UpstreamError, ValidationError } from '../errors.js'
import { logger } from '../logger.js'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { decodeJwt, JWTPayload } from 'jose'

let authState: string | null = null
export async function getAuthenticationRedirectUrl (redirectUri: string) {
  let accessToken: string | undefined
  try {
    accessToken = await getAccessToken()
  } catch {}
  if (accessToken != null) {
    throw new CollisionError('Authentication already exists')
  }

  authState = crypto.randomUUID()
  const redirectUrl = new URL('connect/authorize', SPIRIS_IDENTITY_BASE_URI)
  redirectUrl.searchParams.set('client_id', SPIRIS_CLIENT_ID)
  redirectUrl.searchParams.set('redirect_uri', redirectUri)
  redirectUrl.searchParams.set('scope', 'offline_access ea:api ea:accounting')
  redirectUrl.searchParams.set('response_type', 'code')
  redirectUrl.searchParams.set('prompt', 'select_account')
  redirectUrl.searchParams.set('acr_values', 'service:44643EB1-3F76-4C1C-A672-402AE8085934')
  redirectUrl.searchParams.set('state', authState)

  return redirectUrl
}

export async function redeemAuthCode (code: string, state: string, redirectUri: string) {
  if (state !== authState) {
    throw new ValidationError('Authentication failed', { publicCtx: { state, expectedState: authState } })
  }

  authState = null

  const body = new URLSearchParams()
  body.append('grant_type', 'authorization_code')
  body.append('code', code)
  body.append('redirect_uri', redirectUri)

  const tokenResponse = await request(new URL('connect/token', SPIRIS_IDENTITY_BASE_URI), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${SPIRIS_CLIENT_ID}:${SPIRIS_CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: body.toString(),
  })

  if (tokenResponse.statusCode > 299) {
    throw new UpstreamError('Failed to redeem authentication code', {
      privateCtx: {
        body: await tokenResponse.body.text(),
        statusCode: tokenResponse.statusCode,
        headers: tokenResponse.headers,
      },
    })
  }

  const token = await tokenResponse.body.json() as { access_token: string, refresh_token: string }
  logger.info({ token }, 'Redeemed authentication code')

  await setSpirisTokens(token.access_token, token.refresh_token)
}

async function refreshAccessToken () {
  let refreshToken: string
  try {
    const tokenData = JSON.parse((await readFile(path.join(DATA_DIRECTORY, 'spiris-tokens.json'), { encoding: 'utf-8' }))) as { accessToken: string, refreshToken: string } | undefined
    if (tokenData?.refreshToken == null) {
      throw new Error('No refresh token found')
    }
    refreshToken = tokenData.refreshToken
  } catch (err) {
    throw new UnauthenticatedError('No authentication tokens found', { cause: err })
  }

  const res = await request(new URL('connect/token', SPIRIS_IDENTITY_BASE_URI), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${SPIRIS_CLIENT_ID}:${SPIRIS_CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (res.statusCode > 299) {
    throw new UpstreamError('Failed to refresh access token', {
      privateCtx: {
        body: await res.body.text(),
        statusCode: res.statusCode,
        headers: res.headers,
      },
    })
  }
  const token = await res.body.json() as { access_token: string, refresh_token: string, expires_in: number, type: 'bearer' }
  await setSpirisTokens(token.access_token, token.refresh_token)
  return token.access_token
}

export async function getAccessToken () {
  let accessToken: string
  let accessTokenPayload: JWTPayload
  try {
    const tokenData = JSON.parse((await readFile(path.join(DATA_DIRECTORY, 'spiris-tokens.json'), { encoding: 'utf-8' }))) as { accessToken: string, refreshToken: string } | undefined
    if (tokenData?.accessToken == null) {
      throw new Error('No refresh token found')
    }
    accessToken = tokenData.accessToken
    accessTokenPayload = await decodeJwt(accessToken)
  } catch (err) {
    throw new UnauthenticatedError('No authentication tokens found', { cause: err })
  }

  if (accessTokenPayload.exp && (accessTokenPayload.exp * 1000) < (Date.now() - 10_000)) {
    return await refreshAccessToken()
  }

  return accessToken
}

export async function setSpirisTokens (accessToken: string, refreshToken: string) {
  await mkdir(DATA_DIRECTORY, { recursive: true })

  await writeFile(
    path.join(DATA_DIRECTORY, 'spiris-tokens.json'),
    JSON.stringify({ accessToken, refreshToken }),
    {
      encoding: 'utf-8',
      mode: 0o600,
    }
  )
}

export async function createPdfAttachment (data: Buffer, fileName?: string) {
  const res = await request(new URL('v2/attachments', SPIRIS_API_BASE_URI), {
    method: 'POST',
    headers: { authorization: `Bearer ${await getAccessToken()}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      ContentType: 'application/pdf',
      FileName: fileName ?? `${crypto.randomUUID()}.pdf`,
      Data: data.toString('base64'),
    }),
  })

  if (res.statusCode > 299) {
    throw new UpstreamError('Failed to create attachment', {
      privateCtx: {
        statusCode: res.statusCode,
        headers: res.headers,
        body: await res.body.text(),
      },
    })
  }

  const attachment = await res.body.json() as { Id: string }
  return attachment.Id
}

interface SpirisVoucherApi {
  Id: string
  VoucherDate: string
  VoucherText: string
  Rows: SpirisVoucherRowApi[]
  NumberAndNumberSeries: string
  NumberSeries: string
  ImportedVoucherNumber: string
  Attachments: SpirisAttachmentLinkApi
  VoucherType: number
  SourceId: string

  CreatedUtc: string
  ModifiedUtc: string
}
interface SpirisVoucherRowApi {
  AccountNumber: number
  AccountDescription: string
  DebitAmount: number
  CreditAmount: number
  TransactionText: string
  CostCenterItemId1: string
  CostCenterItemId2: string
  CostCenterItemId3: string
  VatCodeId: string
  VatCodeAndPercent: string
  VatAmount: number
  Quantity: number
  Weight: number
  DeliveryDate: string
  HarvestYear: number
  ProjectId: string
}
interface SpirisAttachmentLinkApi {
  DocumentId: string
  DocumentType: number
  AttachmentIds: string[]
}

interface VoucherBaseData {
  date: Date
  description: string
}
interface VoucherRowData {
  account: number
  amount: number
  type: 'debit' | 'credit'
  projectId?: string
}
export async function createVoucher (voucherData: VoucherBaseData, voucherRows: VoucherRowData[], attachmentIds: string[]): Promise<SpirisVoucherApi> {
  const res = await request(new URL('v2/vouchers', SPIRIS_API_BASE_URI), {
    method: 'POST',
    headers: { authorization: `Bearer ${await getAccessToken()}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      VoucherDate: voucherData.date.toISOString().split('T')[0],
      VoucherText: voucherData.description,
      VoucherType: 2, // 2 = Manual
      Rows: voucherRows.map(row => ({
        AccountNumber: row.account,
        ...(row.type === 'debit' ? { DebitAmount: row.amount } : { CreditAmount: row.amount }),
        ProjectId: row.projectId,
      })),
      Attachments: {
        DocumentType: 3, // 3 = Voucher
        AttachmentIds: attachmentIds,
      },
    }),
  })
  if (res.statusCode > 299) {
    throw new UpstreamError('Failed to create voucher', {
      privateCtx: {
        statusCode: res.statusCode,
        headers: res.headers,
        body: await res.body.text(),
      },
    })
  }
  return await res.body.json() as SpirisVoucherApi
}

export async function findProjectIdByNumber (projectNumber: string) {
  const res = await request(new URL('v2/projects', SPIRIS_API_BASE_URI), {
    method: 'GET',
    headers: { authorization: `Bearer ${await getAccessToken()}`, accept: 'application/json' },
  })

  if (res.statusCode > 299) {
    throw new UpstreamError('Failed to list projects', {
      privateCtx: {
        statusCode: res.statusCode,
        headers: res.headers,
        body: await res.body.text(),
      },
    })
  }

  // TODO: Handle pagination

  const body = await res.body.json() as {
    Data: { Id: string, Number: string | number, Name: string }[],
    Meta: {
      CurrentPage: number,
      PageSize: number,
      TotalNumberOfPages: number,
      TotalNumberOfResults: number,
      ServerTimeUtc: string
    },
  }
  logger.info({ body }, 'Projects found')
  const projectId = body.Data.find(project => `${project.Number}` === projectNumber)?.Id
  if (projectId == null) logger.warn({ projectNumber }, 'Project not found')
  return projectId
}
