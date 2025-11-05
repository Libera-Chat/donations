import express from 'express'
import Stripe from 'stripe'
import { getStripe } from '../services/stripe.js'
import { SPIRIS_LIBERAPAY_PROJECT_NUMBER, SPIRIS_STRIPE_ONETIME_PROJECT_NUMBER, SPIRIS_STRIPE_RECURRING_PROJECT_NUMBER, STRIPE_WEBHOOK_SECRET } from '../config.js'
import { UpstreamError, ValidationError } from '../errors.js'
import { logger, setAttribute } from '../logger.js'
import type { RouteDefinition } from '../main.js'
import { htmlReceiptToPdf } from '../services/pdf.js'
import { createPdfAttachment, createVoucher, findProjectIdByNumber } from '../services/spiris.js'
import { trace } from '@opentelemetry/api'
import { tracer } from '../instrumentation.js'
import { fetch } from 'undici'

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

      switch (event.type) {
        case 'charge.succeeded':
        case 'charge.updated':
          await handleChargeEvent(event)
          break
        case 'invoice_payment.paid':
          await handleInvoiceEvent(event)
          break
        case 'payout.paid':
          await handlePayout(event)
          break
        default:
          logger.warn({ event: event.type }, 'Unhandled event type')
      }

      res.sendStatus(202)
    },
  ],
}] satisfies RouteDefinition[]

async function getInvoicePdf (invoice: Stripe.Invoice): Promise<Buffer> {
  if (invoice.invoice_pdf == null) throw new UpstreamError('Invoice PDF is not available')

  const pdfRes = await fetch(invoice.invoice_pdf, {
    method: 'GET',
    headers: {
      'user-agent': 'LiberaChat/0.1 (support@libera.chat)',
      accept: 'application/pdf',
    },
    redirect: 'follow',
  })
  if (!pdfRes.ok) {
    throw new UpstreamError('Failed to retrieve invoice PDF', {
      privateCtx: {
        url: invoice.invoice_pdf,
        statusCode: pdfRes.status,
        headers: pdfRes.headers,
        body: await pdfRes.text(),
      },
    })
  }
  return Buffer.from(await pdfRes.arrayBuffer())
}

type DonationType = `lc_${'one-time' | 'recurring'}` | 'lp_recurring'
function determineDonationType (object: Stripe.Charge | Stripe.Invoice): DonationType | undefined {
  if ('liberapay_transfer_id' in (object.metadata ?? {})) return 'lp_recurring'
  else if ('liberachat_donation_type' in (object.metadata ?? {})) return `lc_${object.metadata?.liberachat_donation_type as 'one-time' | 'recurring'}`
  else if (
    object.object === 'invoice' &&
    object.parent?.type === 'subscription_details' &&
    object.parent.subscription_details?.metadata?.liberachat_donation_type != null
  ) {
    return `lc_${object.parent.subscription_details.metadata.liberachat_donation_type as 'one-time' | 'recurring'}`
  }

  return undefined
}
const projectsByDonationType: Record<DonationType, string> = {
  lp_recurring: SPIRIS_LIBERAPAY_PROJECT_NUMBER,
  'lc_one-time': SPIRIS_STRIPE_ONETIME_PROJECT_NUMBER,
  lc_recurring: SPIRIS_STRIPE_RECURRING_PROJECT_NUMBER,
}
const descriptionByDonationType: Record<DonationType, string> = {
  lp_recurring: 'Liberapay Recurring Donation',
  'lc_one-time': 'Direct One-Time Donation',
  lc_recurring: 'Direct Recurring Donation',
}

async function handleChargeEvent (event: Stripe.ChargeSucceededEvent | Stripe.ChargeUpdatedEvent): Promise<void> {
  await tracer.startActiveSpan('app.handleChargeEvent', async () => {
    addMessagingAttributes(event)
    logger.info({ event }, 'Event payload')

    const stripe = getStripe()

    if (!event.data.object.paid) {
      logger.warn('Charge is not paid')
      return
    }

    // Re-fetch in an attempt to avoid race conditions, especially if a webhook
    // is retried.
    const charge = await stripe.charges.retrieve(event.data.object.id, {
      expand: ['balance_transaction'],
    })
    const donationType = determineDonationType(charge)
    if (donationType == null) {
      logger.warn('Charge does not come from Liberapay or internal Stripe checkout')
      return
    }
    if ('spiris_voucher_id' in charge.metadata) {
      logger.warn('Charge already has a voucher number')
      return
    }

    if (charge.balance_transaction == null) {
      logger.warn('Charge does not have a balance transaction')
      return
    }

    logger.info({
      balanceTransactionId: typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction.id,
    }, 'Retrieving balance transaction')
    const transaction = typeof charge.balance_transaction === 'string'
      ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
      : charge.balance_transaction

    if (transaction.currency !== 'sek') {
      logger.error('Balance transaction is not in SEK')
      return
    }

    let attachmentId: string | undefined
    let receiptInvoiceNumber: string | undefined
    try {
      if (typeof charge.metadata.invoice === 'string') {
        const invoice = await stripe.invoices.retrieve(charge.metadata.invoice)
        const pdfBuffer = await getInvoicePdf(invoice)
        logger.info({ pdfSize: pdfBuffer.length }, 'Invoice PDF retrieved successfully')

        receiptInvoiceNumber = invoice.number ?? undefined

        attachmentId = await createPdfAttachment(pdfBuffer, `stripe-invoice-${receiptInvoiceNumber ?? invoice.id}.pdf`)
      } else if (charge.receipt_url != null) {
        const pdfBuffer = await htmlReceiptToPdf(charge.receipt_url)
        logger.info({ pdfSize: pdfBuffer.length }, 'Receipt PDF generated successfully')

        receiptInvoiceNumber = charge.receipt_number ?? undefined

        attachmentId = await createPdfAttachment(pdfBuffer, `stripe-receipt-${receiptInvoiceNumber ?? charge.id}.pdf`)
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create PDF attachment')
    }

    const voucher = await createVoucher(
      {
        date: new Date(charge.created * 1000),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        description: `${descriptionByDonationType[donationType] ?? 'Donation'} ${receiptInvoiceNumber ?? ''}`.trim(),
      },
      [
        {
          account: 3993,
          amount: transaction.amount / 100,
          type: 'credit',
          projectId: await findProjectIdByNumber(projectsByDonationType[donationType]),
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

    await stripe.charges.update(charge.id, {
      metadata: {
        spiris_voucher_id: voucher.NumberAndNumberSeries,
      },
    })
    logger.info({ voucherNumber: voucher.NumberAndNumberSeries }, 'Charge updated with voucher number')
  })
}

async function handleInvoiceEvent (event: Stripe.InvoicePaymentPaidEvent): Promise<void> {
  await tracer.startActiveSpan('app.handleInvoiceEvent', async () => {
    addMessagingAttributes(event)
    logger.info({ event }, 'Event payload')

    const stripe = getStripe()

    const invoice = typeof event.data.object.invoice === 'string'
      ? await stripe.invoices.retrieve(event.data.object.invoice)
      : event.data.object.invoice

    if (invoice.deleted) {
      logger.warn('Invoice is deleted')
      return
    }

    const donationType = determineDonationType(invoice)
    if (donationType == null) {
      logger.warn('Invoice is not for a donation')
      return
    }

    let charge: Stripe.Charge
    if (event.data.object.payment.type === 'charge') {
      charge = typeof event.data.object.payment.charge === 'string'
        ? await stripe.charges.retrieve(event.data.object.payment.charge)
        : event.data.object.payment.charge!
    } else {
      const paymentIntent = typeof event.data.object.payment.payment_intent === 'string'
        ? await stripe.paymentIntents.retrieve(event.data.object.payment.payment_intent)
        : event.data.object.payment.payment_intent!
      charge = typeof paymentIntent.latest_charge === 'string'
        ? await stripe.charges.retrieve(paymentIntent.latest_charge)
        : paymentIntent.latest_charge!
    }

    await stripe.charges.update(charge.id, {
      metadata: {
        liberachat_donation_type: donationType.split('_')[1],
        invoice: invoice.id,
      },
    })
  })
}

async function handlePayout (event: Stripe.PayoutPaidEvent) {
  await tracer.startActiveSpan('app.handlePayout', async () => {
    addMessagingAttributes(event)
    logger.info({ event }, 'Event payload')

    const stripe = getStripe()

    const payout = await stripe.payouts.retrieve(event.data.object.id)

    if (payout.metadata != null && 'spiris_voucher_id' in payout.metadata) {
      logger.warn('Payout already has a voucher number')
      return
    }

    if (payout.currency !== 'sek') {
      logger.warn('Payout is not in SEK')
      return
    }

    const voucher = await createVoucher(
      {
        date: new Date(payout.arrival_date * 1000),
        description: 'Utbetalning Stripe',
      },
      [
        {
          account: 1580,
          amount: payout.amount / 100,
          type: 'credit',
        },
        {
          account: 1930,
          amount: payout.amount / 100,
          type: 'credit',
        },
      ],
      // TODO: cannot programmatically get receipt?
      []
    )
    logger.info({ voucher }, 'Voucher created successfully')

    await stripe.payouts.update(payout.id, {
      metadata: {
        ...(payout.metadata ?? {}),
        spiris_voucher_id: voucher.NumberAndNumberSeries,
      },
    })
    logger.info({ voucherNumber: voucher.NumberAndNumberSeries }, 'Payout updated with voucher number')
  })
}
