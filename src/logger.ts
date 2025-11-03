import pino from 'pino'
import { LOG_LEVEL } from './config.js'
import { pinoHttp } from 'pino-http'
import { trace } from '@opentelemetry/api'
import { AsyncLocalStorage } from 'node:async_hooks'
import { RequestHandler } from 'express'

export const logAttsContext = new AsyncLocalStorage<Record<string, string | number | boolean>>()

export function setAttribute (key: string, value: string | number | boolean) {
  const ctx = logAttsContext.getStore()
  if (ctx != null) ctx[key] = value

  trace.getActiveSpan()?.setAttribute(key, value)
}

export const enterLogCtx: RequestHandler = (req, res, next) => {
  logAttsContext.run({}, next)
}

export const logger = pino({
  name: '@libera-chat/donations',
  level: LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'req.query.code'],
  mixin: () => {
    const spanContext = trace.getActiveSpan()?.spanContext()
    return {
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      ...(logAttsContext.getStore() ?? {}),
    }
  },
})

export const httpLogger = pinoHttp({
  logger,
  // Disabled in favor of traceId and spanId
  genReqId: () => undefined as unknown as string,
})
