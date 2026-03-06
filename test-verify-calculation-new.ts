// test-verify-calculation-new.ts
// Script untuk verifikasi manual perhitungan daily calculation (VERSI BARU)
// Termasuk perbaikan:
// 1. Handling last_kwh=null (fallback ke current_kwh)
// 2. Logic Shared Power Meter (isOneBlock)
// Jalankan dengan: bun run test-verify-calculation-new.ts

import { prisma } from './lib/prisma';
import type { Condition } from './lib/generated/prisma/client';

// ========== KONFIGURASI ==========
const MACHINE_ID = 2;           // Ganti dengan Machine ID yang ingin ditest
const TARGET_DATE = '2026-03-05'; // Ganti dengan tanggal yang ingin diverifikasi (YYYY-MM-DD)
// =================================

interface ConditionStats {
  totalHours: number;
  totalKwh: number;
  segmentCount: number;
}

async function verifyCalculation(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🔍 VERIFIKASI PERHITUNGAN DAILY CALCULATION (V2 - IMPROVED)');
  console.log('='.repeat(80));
  console.log(`📅 Tanggal Target: ${TARGET_DATE}`);
  console.log(`🏭 Machine ID: ${MACHINE_ID}`);
  console.log('='.repeat(80));

  // Parse tanggal target
  const dateParts = TARGET_DATE.split('-');
  const year = parseInt(dateParts[0] || '2026', 10);
  const month = parseInt(dateParts[1] || '1', 10);
  const day = parseInt(dateParts[2] || '1', 10);
  const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

  console.log(`\n⏰ Range Query:`);
  console.log(`   Start: ${startOfDay.toISOString()} (${startOfDay.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB)`);
  console.log(`   End:   ${endOfDay.toISOString()} (${endOfDay.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB)`);

  // ========== 1. AMBIL SEMUA DATA CONDITION ==========
  const allConditions: Condition[] = await prisma.condition.findMany({
    where: {
      machine_id: MACHINE_ID,
      current_timestamp: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: { current_timestamp: 'asc' },
  });

  console.log(`\n📊 Total Records: ${allConditions.length}`);

  if (allConditions.length === 0) {
    console.log('❌ Tidak ada data condition untuk tanggal ini!');
    await prisma.$disconnect();
    return;
  }

  // Show unique conditions
  const uniqueConditions = [...new Set(allConditions.map(c => c.current_condition))];
  console.log(`📋 Unique Conditions Found: ${uniqueConditions.join(', ')}`);

  // ========== 2. DATA ACUAN PERHITUNGAN ==========
  console.log('\n' + '─'.repeat(80));
  console.log('📌 DATA ACUAN PERHITUNGAN');
  console.log('─'.repeat(80));
  
  const firstRecord = allConditions[0]!;
  const lastRecord = allConditions[allConditions.length - 1]!;
  const firstTime = new Date(firstRecord.current_timestamp);
  const lastTime = new Date(lastRecord.current_timestamp);

  const firstLastTime = firstRecord.last_timstamp ? new Date(firstRecord.last_timstamp) : null;

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ FIRST RECORD (Acuan awal perhitungan)                                       │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│ ID:              ${firstRecord.id.padEnd(56)} │`);
  console.log(`│ last_timstamp:   ${(firstLastTime ? firstLastTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'null').padEnd(56)} │`);
  console.log(`│ current_timstamp:${firstTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).padEnd(56)} │`);
  console.log(`│ Condition:       ${firstRecord.current_condition.padEnd(56)} │`);
  console.log(`│ last_kwh:        ${(firstRecord.last_kwh ?? 'null').toString().padEnd(56)} │`);
  console.log(`│ current_kwh:     ${firstRecord.current_kwh.padEnd(56)} │`);
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ 📌 Hours Start: last_timstamp | KWH Start: last_kwh                         │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ LAST RECORD (Acuan akhir perhitungan)                                       │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log(`│ ID:             ${lastRecord.id.padEnd(57)} │`);
  console.log(`│ Timestamp:      ${lastTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).padEnd(57)} │`);
  console.log(`│ Condition:      ${lastRecord.current_condition.padEnd(57)} │`);
  console.log(`│ last_kwh:       ${(lastRecord.last_kwh ?? 'null').toString().padEnd(57)} │`);
  console.log(`│ current_kwh:    ${lastRecord.current_kwh.padEnd(57)} │`);
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // ========== 3. TIMELINE PERUBAHAN KONDISI ==========
  console.log('\n' + '─'.repeat(80));
  console.log('📜 TIMELINE PERUBAHAN KONDISI (Transitions)');
  console.log('─'.repeat(80));
  console.log('\n   No │ Timestamp            │ Condition         │ Duration to Next  │ KWH Delta');
  console.log('  ────┼──────────────────────┼───────────────────┼───────────────────┼───────────');

  let transitionCount = 0;
  let prevCondition = '';
  
  for (let i = 0; i < allConditions.length; i++) {
    const record = allConditions[i]!;
    const time = new Date(record.current_timestamp);
    
    // Only show when condition changes
    if (record.current_condition !== prevCondition) {
      transitionCount++;
      
      // Calculate duration to next different condition
      let durationStr = '-';
      let kwhDelta = '-';
      
      // Find next transition or end
      let nextIdx = i + 1;
      while (nextIdx < allConditions.length && allConditions[nextIdx]!.current_condition === record.current_condition) {
        nextIdx++;
      }
      
      if (nextIdx <= allConditions.length) {
        const endOfSegmentIdx = nextIdx - 1;
        const endRecord = allConditions[endOfSegmentIdx]!;
        
        if (nextIdx < allConditions.length) {
          const nextRecord = allConditions[nextIdx]!;
          const nextTime = new Date(nextRecord.current_timestamp);
          const endTime = new Date(endRecord.current_timestamp);
          const duration = (nextTime.getTime() - time.getTime()) / (1000 * 60 * 60);
          durationStr = `${duration.toFixed(4)} h`;
          
          // KWH delta for this segment
          const startKwh = parseFloat(record.last_kwh ?? record.current_kwh) || 0; // FIX: use current_kwh fallback
          const endKwh = parseFloat(endRecord.current_kwh) || 0;
          kwhDelta = `${(endKwh - startKwh).toFixed(2)} kWh`;
        } else {
          durationStr = '(last)';
          const startKwh = parseFloat(record.last_kwh ?? record.current_kwh) || 0; // FIX: use current_kwh fallback
          const endKwh = parseFloat(endRecord.current_kwh) || 0;
          kwhDelta = `${(endKwh - startKwh).toFixed(2)} kWh`;
        }
      }
      
      const timeStr = time.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      console.log(`  ${String(transitionCount).padStart(3)} │ ${timeStr.padEnd(20)} │ ${record.current_condition.padEnd(17)} │ ${durationStr.padEnd(17)} │ ${kwhDelta}`);
      
      prevCondition = record.current_condition;
    }
  }
  console.log('  ────┴──────────────────────┴───────────────────┴───────────────────┴───────────');

  // ========== 4. PER-CONDITION CALCULATION ==========
  console.log('\n' + '─'.repeat(80));
  console.log('📋 PER-CONDITION CALCULATION');
  console.log('   📌 Hours: Duration dari record saat ini → record berikutnya');
  console.log('   📌 KWH: Segment-based (start.last_kwh → end.current_kwh)');
  console.log('   📌 MachineOFF TIDAK DIHITUNG (excluded)');
  console.log('─'.repeat(80));

  const conditionStats: Record<string, ConditionStats> = {
    'HeatingUp': { totalHours: 0, totalKwh: 0, segmentCount: 0 },
    'Iddle': { totalHours: 0, totalKwh: 0, segmentCount: 0 },
    'MachineProduction': { totalHours: 0, totalKwh: 0, segmentCount: 0 },
  };
  
  let machineOffHours = 0;
  let machineOffKwh = 0;

  // ===== CALCULATE HOURS: Duration to next record =====
  // Logic: start.last_timestamp → end.current_timestamp (matches KWH logic)
  for (let i = 0; i < allConditions.length - 1; i++) {
    const currentRecord = allConditions[i]!;
    const nextRecord = allConditions[i + 1]!;
    
    // For first record, use last_timstamp to capture full duration
    let startTime: Date;
    if (i === 0 && currentRecord.last_timstamp) {
      startTime = new Date(currentRecord.last_timstamp);
    } else {
      startTime = new Date(currentRecord.current_timestamp);
    }
    
    const endTime = new Date(nextRecord.current_timestamp);
    const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    
    const condition = currentRecord.current_condition;
    
    switch (condition) {
      case 'HeatingUp':
        conditionStats['HeatingUp']!.totalHours += durationHours;
        break;
      case 'Iddle':
      case 'Iddle[SU]':
      case 'Iddle[Make Sample]':
        conditionStats['Iddle']!.totalHours += durationHours;
        break;
      case 'MachineProduction':
        conditionStats['MachineProduction']!.totalHours += durationHours;
        break;
      case 'MachineOFF':
        machineOffHours += durationHours;
        break;
      default:
        break;
    }
  }

  // ===== CALCULATE KWH: Segment-based =====
  function calculateKwhForCondition(condName: string): { kwh: number; segments: number } {
    let currentSegment: { start: Condition; end: Condition } | null = null;
    let segmentCount = 0;
    let totalCondKwh = 0;

    for (const record of allConditions) {
      if (record.current_condition === condName) {
        if (!currentSegment) {
          currentSegment = { start: record, end: record };
        } else {
          currentSegment.end = record;
        }
      } else {
        if (currentSegment) {
          const startKwh = parseFloat(currentSegment.start.last_kwh ?? currentSegment.start.current_kwh) || 0; // FIX
          const endKwh = parseFloat(currentSegment.end.current_kwh) || 0;
          totalCondKwh += endKwh - startKwh;
          segmentCount++;
          currentSegment = null;
        }
      }
    }
    
    if (currentSegment) {
      const startKwh = parseFloat(currentSegment.start.last_kwh ?? currentSegment.start.current_kwh) || 0; // FIX
      const endKwh = parseFloat(currentSegment.end.current_kwh) || 0;
      totalCondKwh += endKwh - startKwh;
      segmentCount++;
    }

    return { kwh: totalCondKwh, segments: segmentCount };
  }

  const heatingUpKwh = calculateKwhForCondition('HeatingUp');
  const iddleLegacyKwh = calculateKwhForCondition('Iddle');
  const iddleSuKwh = calculateKwhForCondition('Iddle[SU]');
  const iddleMakeSampleKwh = calculateKwhForCondition('Iddle[Make Sample]');
  const iddleKwh = {
    kwh: iddleLegacyKwh.kwh + iddleSuKwh.kwh + iddleMakeSampleKwh.kwh,
    segments: iddleLegacyKwh.segments + iddleSuKwh.segments + iddleMakeSampleKwh.segments,
  };
  const productionKwh = calculateKwhForCondition('MachineProduction');
  const machineOffKwhData = calculateKwhForCondition('MachineOFF');
  machineOffKwh = machineOffKwhData.kwh;

  conditionStats['HeatingUp']!.totalKwh = heatingUpKwh.kwh;
  conditionStats['HeatingUp']!.segmentCount = heatingUpKwh.segments;
  conditionStats['Iddle']!.totalKwh = iddleKwh.kwh;
  conditionStats['Iddle']!.segmentCount = iddleKwh.segments;
  conditionStats['MachineProduction']!.totalKwh = productionKwh.kwh;
  conditionStats['MachineProduction']!.segmentCount = productionKwh.segments;

  // ========== 5. CEK SHARED POWER METER (LOGIC CRON) ==========
  console.log('\n' + '─'.repeat(80));
  console.log('🔌 CEK SHARED POWER METER (Is One Block Logic)');
  console.log('─'.repeat(80));

  const currentMachine = await prisma.machine.findUnique({
    where: { id: MACHINE_ID },
    select: { id: true, name: true, power_meter_id: true },
  });

  let isOneBlock = true;
  let sharedWithMachine = '-';

  if (currentMachine) {
    console.log(`Machine: ${currentMachine.name} (Power Meter ID: ${currentMachine.power_meter_id})`);
    
    // Cari mesin lain dengan power meter sama
    const machinesWithSamePowerMeter = await prisma.machine.findMany({
      where: {
        power_meter_id: currentMachine.power_meter_id,
        id: { not: MACHINE_ID },
      },
      select: { id: true, name: true },
    });

    if (machinesWithSamePowerMeter.length > 0) {
      const currentMachineHasProduction = conditionStats['MachineProduction']!.totalHours > 0;
      
      if (currentMachineHasProduction) {
        for (const otherMachine of machinesWithSamePowerMeter) {
          // Cek apakah mesin lain tersebut juga produksi di hari yang sama
          const otherMachineConditions = await prisma.condition.findFirst({
            where: {
              machine_id: otherMachine.id,
              current_condition: 'MachineProduction',
              current_timestamp: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
          });

          if (otherMachineConditions) {
            isOneBlock = false;
            sharedWithMachine = otherMachine.name;
            console.log(`⚠️  Shared detected! Mesin '${otherMachine.name}' juga produksi hari ini.`);
            break;
          }
        }
      } else {
        console.log('ℹ️  Mesin ini tidak produksi, skip cek shared power.');
      }
    } else {
      console.log('✅  Single Machine (Tidak ada mesin lain dengan power meter ini).');
    }
  }

  // Apply Shared Logic
  if (!isOneBlock) {
    console.log('\n🔄  APPLYING SHARED LOGIC (Membagi KWH dengan 2)');
    conditionStats['HeatingUp']!.totalKwh /= 2;
    conditionStats['Iddle']!.totalKwh /= 2;
    conditionStats['MachineProduction']!.totalKwh /= 2;
    machineOffKwh /= 2;
    
    console.log('   HeatingUp KWH     /= 2');
    console.log('   Iddle KWH         /= 2');
    console.log('   Production KWH    /= 2');
  } else {
    console.log('\n✅  Is One Block = TRUE (Tidak ada pembagian KWH)');
  }

  // Recalculate Totals
  const finalTotalHours = conditionStats['HeatingUp']!.totalHours + 
                          conditionStats['Iddle']!.totalHours + 
                          conditionStats['MachineProduction']!.totalHours;
                          
  const finalTotalKwh = conditionStats['HeatingUp']!.totalKwh + 
                        conditionStats['Iddle']!.totalKwh + 
                        conditionStats['MachineProduction']!.totalKwh;

  // ========== 6. TAMPILKAN HASIL AKHIR ==========
  const conditionTypes = ['HeatingUp', 'Iddle', 'MachineProduction'];
  
  console.log('\n┌────────────────────────┬────────────────┬────────────────┬──────────┐');
  console.log('│ Kondisi                │     Hours      │      KWH       │ Segments │');
  console.log('├────────────────────────┼────────────────┼────────────────┼──────────┤');
  
  for (const conditionName of conditionTypes) {
    const stats = conditionStats[conditionName]!;
    console.log(`│ ${conditionName.padEnd(22)} │ ${stats.totalHours.toFixed(4).padStart(14)} │ ${stats.totalKwh.toFixed(2).padStart(14)} │ ${String(stats.segmentCount).padStart(8)} │`);
  }
  
  console.log('├────────────────────────┼────────────────┼────────────────┼──────────┤');
  console.log(`│ ${'MachineOFF (excluded)'.padEnd(22)} │ ${machineOffHours.toFixed(4).padStart(14)} │ ${machineOffKwh.toFixed(2).padStart(14)} │ ${String(machineOffKwhData.segments).padStart(8)} │`);
  console.log('├────────────────────────┼────────────────┼────────────────┼──────────┤');
  console.log(`│ ${'TOTAL (excl. OFF)'.padEnd(22)} │ ${finalTotalHours.toFixed(4).padStart(14)} │ ${finalTotalKwh.toFixed(2).padStart(14)} │          │`);
  console.log('└────────────────────────┴────────────────┴────────────────┴──────────┘');

  // ========== 7. BANDINGKAN DENGAN HASIL CRON ==========
  console.log('\n' + '─'.repeat(80));
  console.log('🔄 PERBANDINGAN DENGAN HASIL CRON (tbl_mc_run_hour)');
  console.log('─'.repeat(80));

  const dateForDb = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  
  const mcRunHour = await prisma.mcRunHour.findFirst({
    where: {
      machine_id: MACHINE_ID,
      date: dateForDb,
    },
  });

  if (!mcRunHour) {
    console.log('\n⚠️  Belum ada data McRunHour untuk tanggal ini!');
    console.log('   Jalankan daily calculation terlebih dahulu.');
  } else {
    console.log('\n┌────────────────────────┬────────────────┬────────────────┬────────────────┐');
    console.log('│ Field                  │     Manual     │      Cron      │     Status     │');
    console.log('├────────────────────────┼────────────────┼────────────────┼────────────────┤');
    
    const cronTotalH = parseFloat(mcRunHour.mc_run_h ?? '0');
    const cronTotalKwh = parseFloat(mcRunHour.mc_run_kwh ?? '0');
    const cronHeatUpH = parseFloat(mcRunHour.heat_up_h ?? '0');
    const cronHeatUpKwh = parseFloat(mcRunHour.heat_up_kwh ?? '0');
    const cronIddleH = parseFloat(mcRunHour.iddle_h ?? '0');
    const cronIddleKwh = parseFloat(mcRunHour.iddle_kwh ?? '0');
    const cronProdH = parseFloat(mcRunHour.mc_production_h ?? '0');
    const cronProdKwh = parseFloat(mcRunHour.mc_production_kwh ?? '0');
    
    const checkMatch = (manual: number, cron: number, threshold: number = 0.1) => 
      Math.abs(manual - cron) < threshold ? '✅' : '⚠️';
    
    console.log(`│ ${'Total Hours'.padEnd(22)} │ ${finalTotalHours.toFixed(2).padStart(14)} │ ${cronTotalH.toFixed(2).padStart(14)} │ ${checkMatch(finalTotalHours, cronTotalH).padStart(14)} │`);
    console.log(`│ ${'Total KWH'.padEnd(22)} │ ${finalTotalKwh.toFixed(2).padStart(14)} │ ${cronTotalKwh.toFixed(2).padStart(14)} │ ${checkMatch(finalTotalKwh, cronTotalKwh, 1.0).padStart(14)} │`);
    console.log('├────────────────────────┼────────────────┼────────────────┼────────────────┤');
    console.log(`│ ${'HeatingUp Hours'.padEnd(22)} │ ${conditionStats['HeatingUp']!.totalHours.toFixed(2).padStart(14)} │ ${cronHeatUpH.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['HeatingUp']!.totalHours, cronHeatUpH).padStart(14)} │`);
    console.log(`│ ${'HeatingUp KWH'.padEnd(22)} │ ${conditionStats['HeatingUp']!.totalKwh.toFixed(2).padStart(14)} │ ${cronHeatUpKwh.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['HeatingUp']!.totalKwh, cronHeatUpKwh, 1.0).padStart(14)} │`);
    console.log(`│ ${'Iddle Hours'.padEnd(22)} │ ${conditionStats['Iddle']!.totalHours.toFixed(2).padStart(14)} │ ${cronIddleH.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['Iddle']!.totalHours, cronIddleH).padStart(14)} │`);
    console.log(`│ ${'Iddle KWH'.padEnd(22)} │ ${conditionStats['Iddle']!.totalKwh.toFixed(2).padStart(14)} │ ${cronIddleKwh.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['Iddle']!.totalKwh, cronIddleKwh, 1.0).padStart(14)} │`);
    console.log(`│ ${'Production Hours'.padEnd(22)} │ ${conditionStats['MachineProduction']!.totalHours.toFixed(2).padStart(14)} │ ${cronProdH.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['MachineProduction']!.totalHours, cronProdH).padStart(14)} │`);
    console.log(`│ ${'Production KWH'.padEnd(22)} │ ${conditionStats['MachineProduction']!.totalKwh.toFixed(2).padStart(14)} │ ${cronProdKwh.toFixed(2).padStart(14)} │ ${checkMatch(conditionStats['MachineProduction']!.totalKwh, cronProdKwh, 1.0).padStart(14)} │`);
    console.log('└────────────────────────┴────────────────┴────────────────┴────────────────┘');
    
    // Sum verification
    const cronSumH = cronHeatUpH + cronIddleH + cronProdH;
    const cronSumKwh = cronHeatUpKwh + cronIddleKwh + cronProdKwh;
    console.log(`\n📊 Cron Sum Verification:`);
    console.log(`   Sum Hours: ${cronSumH.toFixed(2)} vs Total: ${cronTotalH.toFixed(2)} ${Math.abs(cronSumH - cronTotalH) < 0.01 ? '✅' : '⚠️'}`);
    console.log(`   Sum KWH: ${cronSumKwh.toFixed(2)} vs Total: ${cronTotalKwh.toFixed(2)} ${Math.abs(cronSumKwh - cronTotalKwh) < 0.1 ? '✅' : '⚠️'}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ VERIFIKASI SELESAI');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

// Run
verifyCalculation().catch(async (error) => {
  console.error('Error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
