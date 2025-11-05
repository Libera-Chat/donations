import test from 'node:test'
import assert from 'node:assert'
import { integeriseAmount } from './stripe.js'

void test('integeriseAmount', async t => {
  const multipliedCurrencies = ['sek', 'usd', 'eur']
  const nonMultipliedCurrencies = ['jpy', 'krw', 'clp']
  for (const currency of multipliedCurrencies) {
    await t.test(currency, () => {
      assert.strictEqual(integeriseAmount(100, currency), 100_00, `Expected 10000 for ${currency}`)
      assert.strictEqual(integeriseAmount(105.254, currency), 105_25, `Expected 10525 for ${currency}`)
    })
  }

  for (const currency of nonMultipliedCurrencies) {
    await t.test(currency, () => {
      assert.strictEqual(integeriseAmount(100, currency), 100, `Expected 100 for ${currency}`)
      assert.strictEqual(integeriseAmount(105.254, currency), 105, `Expected 105 for ${currency}`)
    })
  }
})
