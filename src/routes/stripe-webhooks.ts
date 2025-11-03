import express from 'express'
import Stripe from 'stripe'
import { stripe } from '../services/stripe.js'
import { SPIRIS_LIBERAPAY_PROJECT_NUMBER, STRIPE_WEBHOOK_SECRET } from '../config.js'
import { ValidationError } from '../errors.js'
import { logger, setAttribute } from '../logger.js'
import type { RouteDefinition } from '../main.js'
import { htmlReceiptToPdf } from '../services/pdf.js'
import { createPdfAttachment, createVoucher, findProjectIdByNumber } from '../services/spiris.js'
import { trace } from '@opentelemetry/api'
import { tracer } from '../instrumentation.js'

function addMessagingAttributes (event: Stripe.Event) {
  trace.getActiveSpan()?.setAttribute('messaging.operation.name', 'process')
  trace.getActiveSpan()?.setAttribute('messaging.system', 'stripe-webhook')
  setAttribute('messaging.message.id', event.id)
  setAttribute('messaging.destination.name', event.type)
}

export default [{
  method: 'post',
  path: '/stripe/webhooks',
  noParseBody: true,
  handler: [
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      let event = req.body as Stripe.Event
      const signature = req.get('stripe-signature')
      if (signature == null) {
        throw new ValidationError('Stripe signature is required')
      }
      event = Stripe.webhooks.constructEvent(
        req.body as string,
        signature,
        STRIPE_WEBHOOK_SECRET
      )
      logger.info({ eventType: event.type, eventId: event.id }, 'Event received')

      res.sendStatus(202)

      switch (event.type) {
        case 'charge.succeeded':
        case 'charge.updated':
          await handleCharge(event)
          break
        case 'payout.paid':
          await handlePayout(event)
          break
        default:
          logger.warn({ event: event.type }, 'Unhandled event type')
      }
    },
  ],
}] satisfies RouteDefinition[]

async function handleCharge (event: Stripe.ChargeSucceededEvent | Stripe.ChargeUpdatedEvent): Promise<void> {
  await tracer.startActiveSpan('app.handleCharge', async () => {
    addMessagingAttributes(event)
    logger.info({ event }, 'Event payload')

    if (!('liberapay_transfer_id' in event.data.object.metadata)) {
      logger.warn('Charge does not come from Liberapay')
      return
    }
    if ('spiris_voucher_id' in event.data.object.metadata) {
      logger.warn('Charge already has a voucher number')
      return
    }

    if (event.data.object.balance_transaction == null) {
      logger.warn('Charge does not have a balance transaction')
      return
    }

    logger.info({
      balanceTransactionId: typeof event.data.object.balance_transaction === 'string'
        ? event.data.object.balance_transaction
        : event.data.object.balance_transaction.id,
    }, 'Retrieving balance transaction')
    const transaction = typeof event.data.object.balance_transaction === 'string'
      ? await stripe.balanceTransactions.retrieve(event.data.object.balance_transaction)
      : event.data.object.balance_transaction

    if (transaction.currency !== 'sek') {
      logger.warn('Transaction is not in SEK')
      return
    }

    let attachmentId: string | undefined
    if (event.data.object.receipt_url != null) {
      const pdfBuffer = await htmlReceiptToPdf(event.data.object.receipt_url)
      logger.info({ pdfSize: pdfBuffer.length }, 'Receipt PDF generated successfully')

      attachmentId = await createPdfAttachment(pdfBuffer, `stripe-${event.data.object.receipt_number}.pdf`)
    }

    const voucher = await createVoucher(
      {
        date: new Date(event.data.object.created * 1000),
        description: 'Donation',
      },
      [
        {
          account: 3993,
          amount: transaction.amount / 100,
          type: 'credit',
          projectId: await findProjectIdByNumber(SPIRIS_LIBERAPAY_PROJECT_NUMBER),
        },
        ...(transaction.fee > 0
          ? [{
              account: 6040,
              amount: transaction.fee / 100,
              type: 'debit',
            } as const]
          : []),
        {
          account: 1580,
          amount: transaction.net / 100,
          type: 'debit',
        },
      ],
      attachmentId != null ? [attachmentId] : []
    )
    logger.info({ voucher }, 'Voucher created successfully')

    await stripe.charges.update(event.data.object.id, {
      metadata: {
        ...event.data.object.metadata,
        spiris_voucher_id: voucher.NumberAndNumberSeries,
      },
    })
    logger.info({ voucherNumber: voucher.NumberAndNumberSeries }, 'Charge updated with voucher number')
  })
}

async function handlePayout (event: Stripe.PayoutPaidEvent) {
  await tracer.startActiveSpan('app.handlePayout', async () => {
    addMessagingAttributes(event)
    logger.info({ event }, 'Event payload')

    if (event.data.object.metadata != null && 'spiris_voucher_id' in event.data.object.metadata) {
      logger.warn('Payout already has a voucher number')
      return
    }

    if (event.data.object.currency !== 'sek') {
      logger.warn('Payout is not in SEK')
      return
    }

    const voucher = await createVoucher(
      {
        date: new Date(event.data.object.arrival_date * 1000),
        description: 'Utbetalning Stripe',
      },
      [
        {
          account: 1580,
          amount: event.data.object.amount / 100,
          type: 'credit',
        },
        {
          account: 1930,
          amount: event.data.object.amount / 100,
          type: 'credit',
        },
      ],
      // TODO: cannot programmatically get receipt?
      []
    )
    logger.info({ voucher }, 'Voucher created successfully')

    await stripe.payouts.update(event.data.object.id, {
      metadata: {
        ...(event.data.object.metadata ?? {}),
        spiris_voucher_id: voucher.NumberAndNumberSeries,
      },
    })
    logger.info({ voucherNumber: voucher.NumberAndNumberSeries }, 'Payout updated with voucher number')
  })
}
