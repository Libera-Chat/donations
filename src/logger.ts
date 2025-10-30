import pino from 'pino'
import { LOG_LEVEL } from './config.js'
import { pinoHttp } from 'pino-http'

export const logger = pino({
  name: '@libera-chat/donations',
  level: LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'req.query.code'],
})

export const httpLogger = pinoHttp({
  logger,
  genReqId: function (req, res) {
    const existingID = req.headers['x-request-id']
    if (existingID) return existingID
    const id = crypto.randomUUID()
    res.setHeader('X-Request-Id', id)
    return id
  },
})
