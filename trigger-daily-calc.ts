// trigger-daily-calc.ts
// Manual trigger untuk kalkulasi McRunHour H-1
// Usage: bun trigger-daily-calc.ts

import { calculateAllMachinesDailyStats } from './worker/daily-calculator';

async function main() {
  console.log('🚀 Manually triggering daily McRunHour calculation (H-1)...');
  console.log(`⏰ Current time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`);
  console.log('');

  try {
    await calculateAllMachinesDailyStats();
    console.log('');
    console.log('✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
