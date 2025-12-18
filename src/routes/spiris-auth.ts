import type { RouteDefinition } from '../main.js'
import { SPIRIS_DEV_REDIRECT_URI } from '../config.js'
import { ValidationError } from '../errors.js'
import { getAuthenticationRedirectUrl, redeemAuthCode } from '../services/spiris.js'

export default [
  {
    method: 'get',
    path: '/spiris/authenticate',
    handler: async (req, res) => {
      res.redirect(307, (await getAuthenticationRedirectUrl(SPIRIS_DEV_REDIRECT_URI ?? `https://${req.get('host')}/spiris/auth-callback`)).href)
    },
  },
  {
    method: 'get',
    path: '/spiris/auth-callback',
    handler: async (req, res) => {
      if (req.query.error != null) {
        throw new ValidationError('Authentication failed', { publicCtx: { error: req.query.error } })
      }
      if (req.query.state == null) {
        throw new ValidationError('State is required')
      }

      await redeemAuthCode(req.query.code as string, req.query.state as string, SPIRIS_DEV_REDIRECT_URI ?? `https://${req.get('host')}/spiris/auth-callback`)

      res.json({
        message: 'Authentication successful',
      })
    },
  },
] satisfies RouteDefinition[]
