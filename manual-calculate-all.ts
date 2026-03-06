
import { saveDailyMcRunHour } from './worker/daily-calculator';
import { prisma } from './lib/prisma';

// ========== KONFIGURASI ==========
// Ganti tanggal ini sesuai kebutuhan (YYYY-MM-DD)
// Data tanggal 12 tidak ada, maka kita set ke tanggal 12
const TARGET_DATE_STR = '2026-02-12'; 
// =================================

async function main() {
  console.log('='.repeat(80));
  console.log('🛠️  MANUAL DAILY CALCULATION (ALL MACHINES)');
  console.log('='.repeat(80));
  console.log(`📅 Target Date: ${TARGET_DATE_STR}`);
  console.log('='.repeat(80));

  // Parse date safely
  const dateParts = TARGET_DATE_STR.split('-');
  const year = parseInt(dateParts[0] || '2026', 10);
  const month = parseInt(dateParts[1] || '1', 10);
  const day = parseInt(dateParts[2] || '1', 10);
  
  // Create date object (Month is 0-indexed in JS Date)
  const targetDate = new Date(year, month - 1, day);
  
  // Validasi
  if (isNaN(targetDate.getTime())) {
    console.error('❌ Invalid Date Format! Use YYYY-MM-DD');
    process.exit(1);
  }

  console.log(`\n1. Fetching enabled machines...`);
  
  const machines = await prisma.machine.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  if (machines.length === 0) {
    console.warn('⚠️ No enabled machines found.');
    return;
  }

  console.log(`   Found ${machines.length} machines.`);

  console.log(`\n2. Starting calculation...`);

  let successCount = 0;
  let failCount = 0;

  for (const machine of machines) {
    process.stdout.write(`   [${machine.id}] ${machine.name.padEnd(20)} ... `);
    try {
      await saveDailyMcRunHour(machine.id, targetDate);
      console.log(`✅ OK`);
      successCount++;
    } catch (error) {
      console.log(`❌ FAILED`);
      console.error(`      Error: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 SUMMARY`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed:  ${failCount}`);
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Fatal Error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
