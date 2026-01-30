import { getStripe, integeriseAmount, supportedCurrencies } from '../services/stripe.js'
import { logger } from '../logger.js'
import type { RouteDefinition } from '../main.js'
import z from 'zod'
import { ENABLE_DIRECT_DONATIONS, LIBERA_CHAT_WEBSITE_URI } from '../config.js'

const donationFormSchema = z.object({
  email: z.email(),
  type: z.enum(['one-time', 'recurring']),
  currency: z.enum(supportedCurrencies),
  amount: z.coerce.number().positive(),
}).transform(data => ({
  ...data,
  amount: integeriseAmount(data.amount, data.currency),
}))

export default [{
  method: 'post',
  path: '/libera/donate',
  handler: [
    async (req, res) => {
      if (!ENABLE_DIRECT_DONATIONS) {
        res.redirect(303, new URL('contributing/donate', LIBERA_CHAT_WEBSITE_URI).href)
        return
      }

      const stripe = getStripe()

      const body = donationFormSchema.parse(req.body)
      logger.info({ body }, 'parsed body')

      const existingCustomers = await stripe.customers.search({
        query: `email:'${body.email}'`,
        limit: 1,
      })

      const metadata = {
        liberachat_donation_type: body.type,
      }

      const checkoutSession = await stripe.checkout.sessions.create({
        mode: body.type === 'one-time' ? 'payment' : 'subscription',
        line_items: [{
          adjustable_quantity: { enabled: false },
          price_data: {
            currency: body.currency,
            product_data: {
              name: 'Libera Chat Donation',
              tax_code: 'txcd_90000001', // Cash Donation
            },
            unit_amount: body.amount,
            ...(body.type === 'recurring' ? { recurring: { interval: 'month' } } : {}),
            tax_behavior: 'inclusive',
          },
          quantity: 1,
        }],
        ...(
          existingCustomers.data.length === 0
            ? { customer_email: body.email }
            : {
                customer: existingCustomers.data[0].id,
                customer_update: { address: 'auto', name: 'auto' },
              }
        ),
        ...(existingCustomers.data.length === 0 && body.type === 'one-time' ? { customer_creation: 'always' } : {}),
        automatic_tax: {
          enabled: false,
        },
        tax_id_collection: { enabled: true },
        ...(body.type === 'one-time'
          ? {
              payment_intent_data: {
                description: 'Libera Chat (Box 1042, 262 21 Ängelholm, SWEDEN, org no. 802535-6448) is a registered non-profit organization.',
                metadata,
              },
            }
          : {
              subscription_data: {
                metadata,
              },
            }),
        metadata,
        success_url: new URL('contributing/donate-success', LIBERA_CHAT_WEBSITE_URI).href,
        cancel_url: new URL('contributing/donate', LIBERA_CHAT_WEBSITE_URI).href,
        origin_context: 'web',
        submit_type: 'donate',
      })
      logger.info({ checkoutSessionId: checkoutSession.id }, 'Checkout session created')

      if (checkoutSession.url == null) {
        logger.error({ checkoutSessionId: checkoutSession.id }, 'Checkout session has no URL')
        res.redirect(303, new URL('contributing/donate-error', LIBERA_CHAT_WEBSITE_URI).href)
        return
      }

      res.redirect(303, checkoutSession.url)
    },
  ],
}] satisfies RouteDefinition[]
