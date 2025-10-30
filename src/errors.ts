interface ErrorOptions {
  cause?: unknown
  publicCtx?: Record<string, unknown>
  privateCtx?: Record<string, unknown>
}

export class BaseError extends Error {
  statusCode = 500
  publicCtx?: Record<string, unknown>
  privateCtx?: Record<string, unknown>

  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError instanceof Error ? messageOrError.message : messageOrError)
    this.name = this.constructor.name
    this.cause = options.cause ?? (messageOrError instanceof Error ? messageOrError : undefined)
    this.publicCtx = options.publicCtx
    this.privateCtx = options.privateCtx
  }

  toJSON () {
    return {
      error: this.name,
      message: this.message,
      context: this.publicCtx,
    }
  }
}

export class ValidationError extends BaseError {
  statusCode = 400
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}

export class NotFoundError extends BaseError {
  statusCode = 404
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}
export class UnauthenticatedError extends BaseError {
  statusCode = 401
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}
export class UnauthorizedError extends BaseError {
  statusCode = 403
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}
export class CollisionError extends BaseError {
  statusCode = 409
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}

export class UnexpectedError extends BaseError {
  statusCode = 500
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}
export class UpstreamError extends BaseError {
  statusCode = 502
  constructor (messageOrError: string | Error, options: ErrorOptions = {}) {
    super(messageOrError, options)
  }
}
