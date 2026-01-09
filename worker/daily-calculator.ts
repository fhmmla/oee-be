// worker/daily-calculator.ts
// Calculate daily McRunHour from tbl_condition data

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

interface DailyStats {
  heatingUpHours: number;
  heatingUpKwh: number;
  iddleHours: number;
  iddleKwh: number;
  productionHours: number;
  productionKwh: number;
}

/**
 * Calculate daily run hours and kwh for a specific machine
 * @param machineId - Machine ID to calculate
 * @param targetDate - Date to calculate in WIB timezone (YYYY-MM-DD)
 * @returns DailyStats object
 */
export async function calculateDailyStats(machineId: number, targetDate: Date): Promise<DailyStats> {
  // IMPORTANT: Server runs in WIB (UTC+7). JavaScript Date objects already store 
  // timestamps in UTC internally. No manual conversion needed.
  // When we create a Date at midnight WIB, its internal UTC value is already correct.
  
  // Start of day in WIB (00:00:00 WIB)
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  // End of day in WIB (23:59:59 WIB)
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Format date for logging (WIB date)
  const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  
  logger.debug(`Calculating stats for machine ${machineId} on ${dateStr} (WIB)`);
  logger.debug(`  Query range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

  // Fetch all condition records for this machine on target date
  // The Date objects already contain correct UTC timestamps for WIB boundaries
  const conditions = await prisma.condition.findMany({
    where: {
      machine_id: machineId,
      current_timestamp: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: {
      current_timestamp: 'asc',
    },
  });

  if (conditions.length === 0) {
    const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
    logger.warn(`No condition data found for machine ${machineId} on ${dateStr} (WIB)`);
    return {
      heatingUpHours: 0,
      heatingUpKwh: 0,
      iddleHours: 0,
      iddleKwh: 0,
      productionHours: 0,
      productionKwh: 0,
    };
  }

  const stats: DailyStats = {
    heatingUpHours: 0,
    heatingUpKwh: 0,
    iddleHours: 0,
    iddleKwh: 0,
    productionHours: 0,
    productionKwh: 0,
  };

  // ===== OPTION A: Calculate TOTAL from ALL records (simple & accurate) =====
  
  // Get first and last record across ALL conditions
  const firstRecord = conditions[0]; // Already sorted ASC
  const lastRecord = conditions[conditions.length - 1];
  
  if (firstRecord && lastRecord) {
    // Total hours: last - first (regardless of condition)
    const firstTime = new Date(firstRecord.current_timestamp);
    const lastTime = new Date(lastRecord.current_timestamp);
    const totalHoursCalculated = (lastTime.getTime() - firstTime.getTime()) / (1000 * 60 * 60);
    
    // Total KWH: Use last_kwh from first record, current_kwh from last record
    const firstKwh = parseFloat(firstRecord.last_kwh ?? '0') || 0;  // Changed: use last_kwh
    const lastKwh = parseFloat(lastRecord.current_kwh) || 0;
    const totalKwhCalculated = lastKwh - firstKwh;
    
    logger.info(`Machine ${machineId} TOTAL: ${totalHoursCalculated.toFixed(2)}h, KWH: ${firstKwh.toFixed(2)} (last) → ${lastKwh.toFixed(2)} (current) = ${totalKwhCalculated.toFixed(2)} kWh`);
  }

  // ===== Calculate KWH delta per condition (for breakdown) =====
  
  // Group by condition
  const heatingUpRecords = conditions.filter(c => c.current_condition === 'HeatingUp');
  const iddleRecords = conditions.filter(c => c.current_condition === 'Iddle');
  const productionRecords = conditions.filter(c => c.current_condition === 'MachineProduction');

  // KWH deltas per condition (pass all conditions for overlap detection)
  if (heatingUpRecords.length > 0) {
    stats.heatingUpKwh = calculateKwhDelta(heatingUpRecords, conditions);
    stats.heatingUpHours = calculateHours(heatingUpRecords); // For reference, but won't be used in total
  }

  if (iddleRecords.length > 0) {
    stats.iddleKwh = calculateKwhDelta(iddleRecords, conditions);
    stats.iddleHours = calculateHours(iddleRecords);
  }

  if (productionRecords.length > 0) {
    stats.productionKwh = calculateKwhDelta(productionRecords, conditions);
    stats.productionHours = calculateHours(productionRecords);
  }

  logger.info(`  Per-condition KWH: HeatingUp=${stats.heatingUpKwh.toFixed(2)}, Iddle=${stats.iddleKwh.toFixed(2)}, Production=${stats.productionKwh.toFixed(2)}`);

  return stats;
}

/**
 * Calculate total hours for a condition
 * Simple method: Last timestamp - First timestamp
 * This handles gaps better and is more accurate
 */
function calculateHours(records: any[]): number {
  if (records.length === 0) return 0;
  
  // Get first and last record
  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];
  
  const firstTime = new Date(firstRecord.current_timestamp);
  const lastTime = new Date(lastRecord.current_timestamp);
  
  // Calculate duration
  const durationMs = lastTime.getTime() - firstTime.getTime();
  
  // Convert to hours
  return durationMs / (1000 * 60 * 60);
}

/**
 * Calculate KWH delta for a condition using SEGMENT-BASED approach
 * 
 * Identifies continuous segments of the same condition and sums their KWH.
 * This ensures accurate calculation even when conditions alternate.
 * 
 * Example timeline:
 *   10:00 Production (kwh: 100)
 *   12:00 Production (kwh: 110) ← End segment 1 (10 kWh)
 *   12:00 Iddle (kwh: 110)
 *   14:00 Iddle (kwh: 115) ← Iddle segment (5 kWh)
 *   14:00 Production (kwh: 115)
 *   16:00 Production (kwh: 125) ← End segment 2 (10 kWh)
 * 
 * Production total = 10 + 10 = 20 kWh (not 25!)
 */
function calculateKwhDelta(records: any[], allConditions: any[]): number {
  if (records.length === 0) return 0;

  const conditionName = records[0].current_condition;
  
  // Sort ALL conditions by timestamp
  const sortedAll = [...allConditions].sort((a, b) => 
    new Date(a.current_timestamp).getTime() - new Date(b.current_timestamp).getTime()
  );
  
  // Identify continuous segments for this condition
  const segments: Array<{start: any, end: any}> = [];
  let currentSegment: any = null;
  
  for (let i = 0; i < sortedAll.length; i++) {
    const record = sortedAll[i];
    
    if (record.current_condition === conditionName) {
      if (!currentSegment) {
        // Start new segment
        currentSegment = { start: record, end: record };
      } else {
        // Continue segment
        currentSegment.end = record;
      }
    } else {
      // Different condition - close current segment if exists
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = null;
      }
    }
  }
  
  // Don't forget last segment
  if (currentSegment) {
    segments.push(currentSegment);
  }
  
  // Calculate KWH for each segment and sum
  let totalKwh = 0;
  
  for (const segment of segments) {
    // For each segment: last_kwh from start, current_kwh from end
    const startKwh = parseFloat(segment.start.last_kwh ?? '0') || 0;
    const endKwh = parseFloat(segment.end.current_kwh) || 0;
    const segmentKwh = endKwh - startKwh;
    
    totalKwh += segmentKwh;
  }
  
  return totalKwh;
}

/**
 * Save daily McRunHour data for a machine
 */
export async function saveDailyMcRunHour(machineId: number, targetDate: Date): Promise<void> {
  try {
    const stats = await calculateDailyStats(machineId, targetDate);

    // Get local date components (WIB)
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const day = targetDate.getDate();
    
    // Create date for database storage
    // Use Date.UTC() so that the DATE displayed in database matches WIB date
    // Example: Jan 4 WIB → stored as 2026-01-04T00:00:00Z (UTC midnight)
    // This ensures the DATE field shows "2026-01-04" correctly
    const dateForDb = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    
    // Format date string for logging (WIB date, not UTC)
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // ===== CALCULATE TOTAL from ALL records =====
    // Get ALL condition records for this day
    // Server runs in WIB - Date objects already have correct UTC timestamps
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const allRecords = await prisma.condition.findMany({
      where: {
        machine_id: machineId,
        current_timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { current_timestamp: 'asc' },
    });

    // Calculate TOTAL hours and KWH from first to last record
    let totalHours = 0;
    let totalKwh = 0;

    if (allRecords.length > 0) {
      const firstRecord = allRecords[0];
      const lastRecord = allRecords[allRecords.length - 1];
      
      if (firstRecord && lastRecord) {
        const firstTime = new Date(firstRecord.current_timestamp);
        const lastTime = new Date(lastRecord.current_timestamp);
        totalHours = (lastTime.getTime() - firstTime.getTime()) / (1000 * 60 * 60);
        
        // Use last_kwh from first record, current_kwh from last record
        const firstKwh = parseFloat(firstRecord.last_kwh ?? '0') || 0;  // Changed: use last_kwh
        const lastKwh = parseFloat(lastRecord.current_kwh) || 0;
        totalKwh = lastKwh - firstKwh;
        
        logger.info(`Machine ${machineId} on ${dateStr}: Total ${totalHours.toFixed(2)}h, ${totalKwh.toFixed(2)} kWh`);
      }
    }

    // ===== CHECK FOR SHARED POWER METER (is_one_block logic) =====
    
    // 1. Get current machine info with power_meter_id
    const currentMachine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { 
        id: true, 
        name: true,
        power_meter_id: true 
      },
    });

    if (!currentMachine) {
      throw new Error(`Machine ${machineId} not found`);
    }

    // 2. Find other machines with same power_meter_id
    const machinesWithSamePowerMeter = await prisma.machine.findMany({
      where: {
        power_meter_id: currentMachine.power_meter_id,
        id: { not: machineId }, // Exclude current machine
      },
      select: { id: true, name: true },
    });

    // is_one_block = TRUE if only 1 machine runs (1 block)
    // is_one_block = FALSE if 2 machines run (2 blocks, shared)
    let isOneBlock = true; // Default: assume only this machine

    // 3. Check if any other machine has Production condition on same day
    if (machinesWithSamePowerMeter.length > 0) {
      // Server runs in WIB - reuse startOfDay/endOfDay from above
      // (already defined with correct UTC timestamps)

      // Check if current machine has Production
      const currentMachineHasProduction = stats.productionHours > 0;

      if (currentMachineHasProduction) {
        // Check each other machine for Production condition on same day
        for (const otherMachine of machinesWithSamePowerMeter) {
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
            // Found another machine with Production on same day!
            // NOT one block, it's TWO blocks (shared)
            isOneBlock = false;
            logger.info(`🔗 Shared power meter detected: ${currentMachine.name} & ${otherMachine.name} both in Production on ${dateStr}`);
            break; // Found one, that's enough
          }
        }
      }
    }

    // 4. Split KWH if is_one_block = FALSE (2 machines running)
    let finalTotalKwh = totalKwh;
    let finalProductionKwh = stats.productionKwh;

    if (!isOneBlock) { // FALSE = shared, need to split
      // Split KWH equally (2 machines sharing)
      finalTotalKwh = totalKwh / 2;
      finalProductionKwh = stats.productionKwh / 2;
      
      logger.info(`  → KWH split: ${totalKwh.toFixed(2)} / 2 = ${finalTotalKwh.toFixed(2)} (is_one_block=false)`);
    } else {
      logger.info(`  → KWH full: ${totalKwh.toFixed(2)} (is_one_block=true, only this machine)`);
    }

    // ===== SAVE TO DATABASE =====
    
    // Check if record already exists
    const existing = await prisma.mcRunHour.findFirst({
      where: {
        machine_id: machineId,
        date: dateForDb,
      },
    });

    const data = {
      date: dateForDb,
      mc_run_h: totalHours.toFixed(2),
      mc_run_kwh: finalTotalKwh.toFixed(2), // Use split KWH
      heat_up_h: stats.heatingUpHours.toFixed(2),
      heat_up_kwh: stats.heatingUpKwh.toFixed(2),
      iddle_h: stats.iddleHours.toFixed(2),
      iddle_kwh: stats.iddleKwh.toFixed(2),
      mc_production_h: stats.productionHours.toFixed(2),
      mc_production_kwh: finalProductionKwh.toFixed(2), // Use split KWH
      is_one_block: isOneBlock, // Set based on detection
      machine_id: machineId,
    };

    if (existing) {
      // Update existing record
      await prisma.mcRunHour.update({
        where: { id: existing.id },
        data,
      });
      logger.info(`✓ Updated McRunHour for machine ${machineId} on ${dateStr} (Total: ${totalHours.toFixed(2)}h, ${totalKwh.toFixed(2)} kWh)`);
    } else {
      // Create new record
      await prisma.mcRunHour.create({
        data,
      });
      logger.info(`✓ Created McRunHour for machine ${machineId} on ${dateStr} (Total: ${totalHours.toFixed(2)}h, ${totalKwh.toFixed(2)} kWh)`);
    }
  } catch (error) {
    logger.error(`Error saving McRunHour for machine ${machineId}:`, error);
    throw error;
  }
}

/**
 * Calculate and save for all machines (called by cron)
 */
export async function calculateAllMachinesDailyStats(): Promise<void> {
  try {
    // Calculate H-1 (yesterday) in WIB timezone
    // Server runs in WIB (UTC+7), so new Date() returns WIB time
    // Example: If cron runs at 01:00 WIB on Jan 5, yesterday = Jan 4 WIB
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    
    // Format date string properly for WIB date (not using toISOString which shows UTC)
    const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    
    logger.info(`Starting daily McRunHour calculation for ${dateStr} (H-1 WIB)`);

    // Get all machines
    const machines = await prisma.machine.findMany({
      select: { id: true, name: true },
    });

    logger.info(`Processing ${machines.length} machines`);

    // Process each machine
    for (const machine of machines) {
      await saveDailyMcRunHour(machine.id, yesterday);
    }

    logger.info(`✓ Daily McRunHour calculation complete for ${machines.length} machines`);
  } catch (error) {
    logger.error('Error in daily calculation:', error);
    throw error;
  }
}
