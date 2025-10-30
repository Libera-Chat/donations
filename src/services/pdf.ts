import puppeteer, { type Browser } from 'puppeteer'
import { logger } from '../logger.js'
import { UpstreamError } from '../errors.js'

let browserInstance: Browser | null = null

/**
 * Get or create a singleton browser instance.
 * This is a best practice to reuse the browser across requests.
 */
async function getBrowser (): Promise<Browser> {
  if (browserInstance?.connected === true) {
    return browserInstance
  }

  logger.debug('Launching Puppeteer browser')
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })

  // Clean up browser on process exit
  process.on('beforeExit', () => {
    if (browserInstance != null) {
      void browserInstance.close()
    }
  })

  return browserInstance
}

/**
 * Converts an HTML receipt webpage (from a URL) to a PDF buffer.
 * Uses Puppeteer to render the page and generate a high-quality PDF.
 *
 * @param receiptUrl - The URL of the HTML receipt page
 * @returns A Buffer containing the PDF data
 * @throws {UpstreamError} If the page cannot be loaded or PDF generation fails
 */
export async function htmlReceiptToPdf (receiptUrl: string): Promise<Buffer> {
  const browser = await getBrowser()
  let page = null

  try {
    page = await browser.newPage()

    // Set reasonable viewport for PDF generation
    await page.setViewport({ width: 1200, height: 800 })

    // Navigate to the receipt URL with a timeout
    logger.debug({ receiptUrl }, 'Navigating to receipt URL')
    await page.goto(receiptUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })

    // Generate PDF with optimized settings for receipts
    logger.debug('Generating PDF from receipt page')
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
      },
      preferCSSPageSize: false,
    })

    logger.debug({ size: pdfBuffer.length }, 'PDF generated successfully')
    return Buffer.from(pdfBuffer)
  } catch (error) {
    logger.error({ error, receiptUrl }, 'Failed to generate PDF from receipt')
    throw new UpstreamError('Failed to generate PDF from receipt page', {
      cause: error,
      privateCtx: { receiptUrl },
    })
  } finally {
    if (page != null) {
      await page.close()
    }
  }
}
