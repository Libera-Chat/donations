import './instrumentation.js'

import 'dotenv/config'
import express, { type RequestHandler, type ErrorRequestHandler } from 'express'
import { enterLogCtx, httpLogger, logger } from './logger.js'
import { LIBERA_CHAT_WEBSITE_URI, LISTEN_PATH, PORT } from './config.js'
import { BaseError, NotFoundError, RatelimitError, UnexpectedError, UpstreamError, ValidationError } from './errors.js'
import { engine } from 'express-handlebars'
import helmet from 'helmet'
import { trace } from '@opentelemetry/api'
import { $ZodError } from 'zod/v4/core'
import z from 'zod'

import stripeWebhooksRoutes from './routes/stripe-webhooks.js'
import spirisAuthRoutes from './routes/spiris-auth.js'
import liberaDonateRoutes from './routes/libera-forms.js'
import Stripe from 'stripe'

export interface RouteDefinition {
  method: 'all' | 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head'
  path: string | string[]
  handler: RequestHandler | RequestHandler[]
  noParseBody?: boolean
}

const routes: RouteDefinition[] = [
  ...stripeWebhooksRoutes,
  ...spirisAuthRoutes,
  ...liberaDonateRoutes,
]

const app = express()
app.disable('x-powered-by')

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.engine('handlebars', engine())
app.set('view engine', 'handlebars')

app.use(helmet({
  crossOriginEmbedderPolicy: true,
}))

app.use(enterLogCtx)
app.use(httpLogger)

for (const route of routes) {
  app[route.method](route.path, [
    ...(route.noParseBody ? [] : [express.json(), express.urlencoded({ extended: true })]),
    ...(Array.isArray(route.handler) ? route.handler : [route.handler]),
  ])
}

// 404 Handlers
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    res.redirect(303, new URL('contributing/donate', LIBERA_CHAT_WEBSITE_URI).href)
  }
})
app.use((req) => {
  throw new NotFoundError('Route not found', { publicCtx: { path: req.path, method: req.method } })
})

const errorFormatter: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof BaseError) {
    next(err)
  } else if (err instanceof $ZodError) {
    const msg = z.prettifyError(err)
    next(new ValidationError(msg, {
      cause: err,
    }))
  } else if (err instanceof Stripe.errors.StripeCardError) {
    next(new ValidationError(err.message, {
      cause: err,
      publicCtx: {
        decline_code: err.decline_code,
        code: err.code,
        param: err.param,
      },
      privateCtx: {
        stripeReqId: err.requestId,
        stripeErrorType: err.type,
        stripeErrorCode: err.code,
      },
    }))
  } else if (err instanceof Stripe.errors.StripeRateLimitError) {
    next(new RatelimitError('Too many requests received either from you or in total, please try again later', {
      cause: err,
      privateCtx: {
        stripeReqId: err.requestId,
        stripeErrorType: err.type,
        stripeErrorCode: err.code,
      },
    }))
  } else if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    next(new ValidationError(err.message, {
      cause: err,
      publicCtx: {
        code: err.code,
        param: err.param,
      },
      privateCtx: {
        stripeReqId: err.requestId,
        stripeErrorType: err.type,
        stripeErrorCode: err.code,
      },
    }))
  } else if (err instanceof Stripe.errors.StripeError) {
    next(new UpstreamError('An error was received from stripe, please try again later', {
      cause: err,
      publicCtx: {
        param: err.param,
      },
      privateCtx: {
        stripeReqId: err.requestId,
        stripeErrorType: err.type,
        stripeErrorCode: err.code,
      },
    }))
  } else {
    next(new UnexpectedError('An unexpected error occurred', {
      cause: err,
    }))
  }
}
app.use(errorFormatter)

const errorHandler: ErrorRequestHandler = (err: BaseError, req, res, next) => {
  logger.error(err)
  if (!res.headersSent) {
    if (req.accepts('html')) {
      const traceId = trace.getActiveSpan()?.spanContext().traceId

      let publicCtx = err.publicCtx ? JSON.stringify(err.publicCtx, null, 2) : undefined
      if (publicCtx === '{}') publicCtx = undefined

      res.status(err.statusCode).render('error', {
        message: err.message,
        publicCtx,
        traceId,
        LIBERA_CHAT_WEBSITE_URI,
      })
    } else {
      res.status(err.statusCode).json(err.toJSON())
    }
  }
}
app.use(errorHandler)

const server = app.listen(LISTEN_PATH ?? PORT, () => {
  logger.info({
    listenPath: LISTEN_PATH,
    port: LISTEN_PATH != null ? undefined : PORT,
  }, 'Server started')
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
