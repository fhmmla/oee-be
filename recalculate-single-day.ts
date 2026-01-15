// recalculate-single-day.ts
// Script untuk menjalankan ulang perhitungan untuk 1 tanggal tertentu
// Jalankan dengan: bun run recalculate-single-day.ts

import { saveDailyMcRunHour } from './worker/daily-calculator';
import { prisma } from './lib/prisma';

// ========== KONFIGURASI ==========
const MACHINE_ID = 2;           // Ganti dengan Machine ID
const TARGET_DATE = '2026-01-14'; // Ganti dengan tanggal (YYYY-MM-DD)
// =================================

async function main() {
  console.log('='.repeat(80));
  console.log('🔄 RECALCULATE SINGLE DAY');
  console.log('='.repeat(80));
  console.log(`📅 Tanggal: ${TARGET_DATE}`);
  console.log(`🏭 Machine ID: ${MACHINE_ID}`);
  console.log('='.repeat(80));

  // Parse date
  const dateParts = TARGET_DATE.split('-');
  const year = parseInt(dateParts[0] || '2026', 10);
  const month = parseInt(dateParts[1] || '1', 10);
  const day = parseInt(dateParts[2] || '1', 10);
  const targetDate = new Date(year, month - 1, day);

  console.log(`\n⏳ Running calculation...`);
  
  await saveDailyMcRunHour(MACHINE_ID, targetDate);
  
  console.log(`\n✅ Done!`);
  
  // Show result
  const dateForDb = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const result = await prisma.mcRunHour.findFirst({
    where: {
      machine_id: MACHINE_ID,
      date: dateForDb,
    },
  });

  if (result) {
    console.log('\n📊 Result:');
    console.log(`   mc_run_h: ${result.mc_run_h}`);
    console.log(`   mc_run_kwh: ${result.mc_run_kwh}`);
    console.log(`   heat_up_h: ${result.heat_up_h}`);
    console.log(`   heat_up_kwh: ${result.heat_up_kwh}`);
    console.log(`   iddle_h: ${result.iddle_h}`);
    console.log(`   iddle_kwh: ${result.iddle_kwh}`);
    console.log(`   mc_production_h: ${result.mc_production_h}`);
    console.log(`   mc_production_kwh: ${result.mc_production_kwh}`);
    
    // Verify sum
    const sumH = parseFloat(result.heat_up_h ?? '0') + parseFloat(result.iddle_h ?? '0') + parseFloat(result.mc_production_h ?? '0');
    const totalH = parseFloat(result.mc_run_h ?? '0');
    console.log(`\n📊 Sum Verification:`);
    console.log(`   Sum Hours: ${sumH.toFixed(2)} vs Total: ${totalH.toFixed(2)} ${Math.abs(sumH - totalH) < 0.01 ? '✅' : '⚠️'}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
