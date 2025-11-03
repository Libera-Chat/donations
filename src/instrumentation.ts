/* eslint-disable no-console */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
// import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
// import {
//   PeriodicExportingMetricReader,
//   ConsoleMetricExporter,
// } from '@opentelemetry/sdk-metrics'
import { resourceFromAttributes } from '@opentelemetry/resources'
import * as semconv from '@opentelemetry/semantic-conventions'
import { trace } from '@opentelemetry/api'

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: '@libera-chat/donations',
  }),
  // traceExporter: new ConsoleSpanExporter(),
  // metricReader: new PeriodicExportingMetricReader({
  //   exporter: new ConsoleMetricExporter(),
  // }),
  instrumentations: [getNodeAutoInstrumentations()],
})

sdk.start()

export const tracer = trace.getTracer('@libera-chat/donations')

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => { console.info('Tracing terminated') })
    .catch((error: unknown) => { console.warn('Error terminating tracing', error) })
    .finally(() => process.exit(0))
})
