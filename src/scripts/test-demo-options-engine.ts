import { InstrumentService } from '../instruments/InstrumentService'
import { OptionChainService } from '../instruments/OptionChainService'
import { OptionRiskEngine } from '../risk/OptionRiskEngine'
import { BrokerRegistry } from '../brokers/core/BrokerRegistry'
import { ZerodhaAdapter } from '../brokers/zerodha/ZerodhaAdapter'
import { Instrument } from '../brokers/core/BrokerTypes'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
}

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ${colors.green}✔ PASS:${colors.reset} ${msg}`)
    passed++
  } else {
    console.error(`  ${colors.red}✖ FAIL:${colors.reset} ${msg}`)
    failed++
  }
}

async function runDemoOptionsEngineTest() {
  console.log(`\n${colors.bright}${colors.cyan}=================================================================\n  🚀 PINE ENGINE - INDIAN OPTIONS & BROKER ADAPTER DEMO SUITE\n=================================================================${colors.reset}\n`)

  // -------------------------------------------------------------
  // 1. BROKER REGISTRY TEST
  // -------------------------------------------------------------
  console.log(`${colors.yellow}▶ 1. Broker Registry & Zerodha Adapter Instantiation${colors.reset}`)
  const zerodha = new ZerodhaAdapter({
    apiKey: 'demo_kite_api_key',
    accessToken: 'demo_kite_access_token',
  })
  BrokerRegistry.getInstance().register('zerodha', zerodha)
  const retrieved = BrokerRegistry.getInstance().get('zerodha')
  assert(retrieved !== undefined && BrokerRegistry.getInstance().has('zerodha'), 'ZerodhaAdapter successfully registered and retrieved from BrokerRegistry')

  // -------------------------------------------------------------
  // 2. DYNAMIC INSTRUMENT SERVICE TEST
  // -------------------------------------------------------------
  console.log(`\n${colors.yellow}▶ 2. Dynamic Instrument Master & Dynamic Lot Sizes${colors.reset}`)
  const instrumentService = InstrumentService.getInstance()
  instrumentService.clear()

  // Load demo instrument master
  const demoInstruments: Instrument[] = [
    {
      instrumentToken: 256265,
      tradingsymbol: 'NIFTY 50',
      underlying: 'NIFTY',
      exchange: 'NSE',
      lotSize: 75,
      tickSize: 0.05,
    },
    {
      instrumentToken: 260105,
      tradingsymbol: 'NIFTY BANK',
      underlying: 'BANKNIFTY',
      exchange: 'NSE',
      lotSize: 30,
      tickSize: 0.05,
    },
    {
      instrumentToken: 257801,
      tradingsymbol: 'NIFTY FIN SERVICE',
      underlying: 'FINNIFTY',
      exchange: 'NSE',
      lotSize: 65,
      tickSize: 0.05,
    },
    {
      instrumentToken: 265,
      tradingsymbol: 'SENSEX',
      underlying: 'SENSEX',
      exchange: 'BSE',
      lotSize: 20,
      tickSize: 0.05,
    },
    // NIFTY ATM Call Option Contract
    {
      instrumentToken: 11223344,
      tradingsymbol: 'NIFTY24SEP25100CE',
      underlying: 'NIFTY',
      exchange: 'NFO',
      optionType: 'CE',
      strike: 25100,
      expiry: '2026-09-26',
      lotSize: 75,
      tickSize: 0.05,
    },
  ]

  instrumentService.loadInstruments(demoInstruments)
  assert(instrumentService.getLotSize('NIFTY') === 75, 'Dynamic lot size for NIFTY is 75 (not hardcoded)')
  assert(instrumentService.getLotSize('BANKNIFTY') === 30, 'Dynamic lot size for BANKNIFTY is 30')
  assert(instrumentService.getLotSize('FINNIFTY') === 65, 'Dynamic lot size for FINNIFTY is 65')
  assert(instrumentService.getLotSize('SENSEX') === 20, 'Dynamic lot size for SENSEX is 20')

  // -------------------------------------------------------------
  // 3. OPTION CHAIN STRIKE MATH TEST
  // -------------------------------------------------------------
  console.log(`\n${colors.yellow}▶ 3. Option Chain Strike Math (ATM, ITM, OTM derivation)${colors.reset}`)
  const optionChainService = new OptionChainService()

  // Demo Index Spot Price: NIFTY at 25,123.40 (Strike Step = 50)
  const spotNifty = 25123.40
  const atmNifty = optionChainService.calculateTargetStrike('NIFTY', spotNifty, 'CE', 'ATM')
  const itm1CeNifty = optionChainService.calculateTargetStrike('NIFTY', spotNifty, 'CE', 'ITM1')
  const otm1CeNifty = optionChainService.calculateTargetStrike('NIFTY', spotNifty, 'CE', 'OTM1')
  const itm1PeNifty = optionChainService.calculateTargetStrike('NIFTY', spotNifty, 'PE', 'ITM1')
  const otm1PeNifty = optionChainService.calculateTargetStrike('NIFTY', spotNifty, 'PE', 'OTM1')

  console.log(`  ${colors.blue}ℹ NIFTY Spot: ${spotNifty} -> ATM Strike: ${atmNifty} | ITM1 CE: ${itm1CeNifty} | OTM1 CE: ${otm1CeNifty}${colors.reset}`)

  assert(atmNifty === 25100, `NIFTY 25,123.40 rounded to ATM Strike 25,100 (Step 50)`)
  assert(itm1CeNifty === 25050, `NIFTY Call ITM1 Strike is 25,050 (in the money)`)
  assert(otm1CeNifty === 25150, `NIFTY Call OTM1 Strike is 25,150 (out of the money)`)
  assert(itm1PeNifty === 25150, `NIFTY Put ITM1 Strike is 25,150 (in the money)`)
  assert(otm1PeNifty === 25050, `NIFTY Put OTM1 Strike is 25,050 (out of the money)`)

  // Demo BankNifty Spot: 53,842.10 (Strike Step = 100)
  const spotBankNifty = 53842.10
  const atmBankNifty = optionChainService.calculateTargetStrike('BANKNIFTY', spotBankNifty, 'CE', 'ATM')
  console.log(`  ${colors.blue}ℹ BANKNIFTY Spot: ${spotBankNifty} -> ATM Strike: ${atmBankNifty}${colors.reset}`)
  assert(atmBankNifty === 53800, `BANKNIFTY 53,842.10 rounded to ATM Strike 53,800 (Step 100)`)

  // -------------------------------------------------------------
  // 4. OPTION RISK ENGINE SIZING & CIRCUIT BREAKER TEST
  // -------------------------------------------------------------
  console.log(`\n${colors.yellow}▶ 4. Option Risk Engine Position Sizing & Defined Risk Guard${colors.reset}`)

  // Scenario A: ₹50,000 Capital, NIFTY ATM Premium = ₹160, Lot Size = 75 (1 Lot = ₹12,000)
  const sizingA = OptionRiskEngine.calculateOptionSizing({
    totalCapital: 50000,
    maxRiskPerTradePercent: 10, // ₹5,000 max risk
    optionPremium: 160,
    lotSize: 75,
    stopLossPercent: 20,       // ₹32/share SL => ₹2,400 risk per lot
    maxLotsLimit: 5,
    currentDailyLoss: 0,
    maxDailyLossLimit: 10000,
  })
  console.log(`  ${colors.blue}ℹ ₹50,000 Capital @ ₹160 Premium -> Sized Lots: ${sizingA.lots} (${sizingA.totalQuantity} Qty, Capital Required: ₹${sizingA.estimatedCapitalRequired})${colors.reset}`)
  assert(sizingA.allowed === true, 'Position sizing allowed within risk parameters')
  assert(sizingA.lots === 2, '₹5,000 max risk allows 2 lots (₹4,800 total risk <= ₹5,000 max risk)')
  assert(sizingA.totalQuantity === 150, '2 lots = 150 quantity')
  assert(sizingA.slPrice === 128, '20% stop loss sets SL price to ₹128')

  // Scenario B: Circuit Breaker Trips when Daily Loss Limit Reached
  const sizingCircuitBreaker = OptionRiskEngine.calculateOptionSizing({
    totalCapital: 50000,
    maxRiskPerTradePercent: 10,
    optionPremium: 160,
    lotSize: 75,
    stopLossPercent: 20,
    maxLotsLimit: 5,
    currentDailyLoss: 10000,   // Limit reached!
    maxDailyLossLimit: 10000,
  })
  console.log(`  ${colors.blue}ℹ Circuit Breaker Response: allowed = ${sizingCircuitBreaker.allowed} | reason = ${sizingCircuitBreaker.reason}${colors.reset}`)
  assert(sizingCircuitBreaker.allowed === false, 'Execution blocked by circuit breaker when daily loss limit is hit')

  console.log(`\n=================================================================`)
  console.log(`  📊 PINE ENGINE DEMO RESULTS: ${colors.green}${passed} passed${colors.reset}, ${failed > 0 ? colors.red : colors.green}${failed} failed${colors.reset}`)
  console.log(`=================================================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runDemoOptionsEngineTest().catch((err) => {
  console.error('Fatal Pine Engine Demo Test Error:', err)
  process.exit(1)
})
