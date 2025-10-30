import 'dotenv/config'
import express, { type RequestHandler, type ErrorRequestHandler } from 'express'
import { httpLogger, logger } from './logger.js'
import { PORT } from './config.js'
import { BaseError, NotFoundError, UnexpectedError } from './errors.js'

import stripeWebhooksRoutes from './routes/stripe-webhooks.js'
import spirisAuthRoutes from './routes/spiris-auth.js'

export interface RouteDefinition {
  method: 'all' | 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head'
  path: string | string[]
  handler: RequestHandler | RequestHandler[]
  noParseBody?: boolean
}

const routes: RouteDefinition[] = [
  ...stripeWebhooksRoutes,
  ...spirisAuthRoutes,
]

const app = express()
app.disable('x-powered-by')
app.use(httpLogger)

for (const route of routes) {
  app[route.method](route.path, [
    ...(route.noParseBody ? [] : [express.json(), express.urlencoded({ extended: true })]),
    ...(Array.isArray(route.handler) ? route.handler : [route.handler]),
  ])
}

app.use((req) => {
  throw new NotFoundError('Route not found', { publicCtx: { path: req.path, method: req.method } })
})
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  let error: BaseError = err as BaseError
  if (!(err instanceof BaseError)) {
    error = new UnexpectedError('An unexpected error occurred', {
      cause: err,
    })
  }

  logger.error(error)
  if (!res.headersSent) {
    res.status(error.statusCode).json(error)
  }
}
app.use(errorHandler)

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})
