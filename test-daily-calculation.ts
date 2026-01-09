// test-daily-calculation.ts
// Manual trigger untuk daily calculation

import { calculateAllMachinesDailyStats, saveDailyMcRunHour } from './worker/daily-calculator';
import { logger } from './lib/logger';

logger.info('============================================');
logger.info('   MANUAL DAILY CALCULATION TEST           ');
logger.info('============================================');

async function testDailyCalculation() {
  try {
    // Option 1: Calculate semua machines (seperti cron)
    logger.info('\n🔧 Running daily calculation for ALL machines...');
    await calculateAllMachinesDailyStats();
    
    // Option 2: Calculate untuk 1 machine saja (untuk testing spesifik)
    // Uncomment dan ganti machine_id sesuai kebutuhan
    // const targetDate = new Date(2025, 11, 11); // Year, Month(0-indexed), Day
    // logger.info('\n🔧 Running daily calculation for Machine ID 2...');
    // await saveDailyMcRunHour(2, targetDate);
    
    logger.info('\n✅ Daily calculation complete!');
    logger.info('Check tbl_mc_run_hour for results.');
    
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during daily calculation:', error);
    process.exit(1);
  }
}

// Run the test
testDailyCalculation();
