// worker/daily-calculator.ts
// Calculate daily McRunHour from tbl_condition data
// UPDATED: Using accurate segment-based calculation where sum of per-condition = total

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { Condition } from '../lib/generated/prisma/client';

interface DailyStats {
  heatingUpHours: number;
  heatingUpKwh: number;
  iddleHours: number;
  iddleKwh: number;
  productionHours: number;
  productionKwh: number;
  totalHours: number;
  totalKwh: number;
}

/**
 * Calculate daily run hours and kwh for a specific machine
 * 
 * LOGIC:
 * - Total Hours & KWH: First record → Last record
 * - Per-Condition Hours: Duration from current record to next record belongs to current condition
 *   This ensures: Sum(heatingUpHours + iddleHours + productionHours) = totalHours
 * - Per-Condition KWH: Segment-based (start.last_kwh → end.current_kwh per segment)
 * 
 * @param machineId - Machine ID to calculate
 * @param targetDate - Date to calculate in WIB timezone
 * @returns DailyStats object
 */
export async function calculateDailyStats(machineId: number, targetDate: Date): Promise<DailyStats> {
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
  const conditions: Condition[] = await prisma.condition.findMany({
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
    logger.warn(`No condition data found for machine ${machineId} on ${dateStr} (WIB)`);
    return {
      heatingUpHours: 0,
      heatingUpKwh: 0,
      iddleHours: 0,
      iddleKwh: 0,
      productionHours: 0,
      productionKwh: 0,
      totalHours: 0,
      totalKwh: 0,
    };
  }

  // Initialize stats
  const stats: DailyStats = {
    heatingUpHours: 0,
    heatingUpKwh: 0,
    iddleHours: 0,
    iddleKwh: 0,
    productionHours: 0,
    productionKwh: 0,
    totalHours: 0,
    totalKwh: 0,
  };

  // ===== 1. CALCULATE PER-CONDITION HOURS (Duration-based) =====
  // Logic matches KWH: start.last_timestamp → end.current_timestamp
  // For first record: use last_timestamp as start
  // For subsequent: use current_timestamp of previous record
  // NOTE: MachineOFF is NOT counted - it is excluded from total hours
  
  for (let i = 0; i < conditions.length - 1; i++) {
    const currentRecord = conditions[i]!;
    const nextRecord = conditions[i + 1]!;
    
    // For first record, use last_timestamp to capture full duration
    // This matches KWH logic: start.last_kwh uses the "before" value
    let startTime: Date;
    if (i === 0 && currentRecord.last_timstamp) {
      startTime = new Date(currentRecord.last_timstamp);
    } else {
      startTime = new Date(currentRecord.current_timestamp);
    }
    
    const endTime = new Date(nextRecord.current_timestamp);
    const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    
    // Assign duration to current record's condition
    // MachineOFF is EXCLUDED (not counted)
    switch (currentRecord.current_condition) {
      case 'HeatingUp':
        stats.heatingUpHours += durationHours;
        break;
      case 'Iddle':
        stats.iddleHours += durationHours;
        break;
      case 'MachineProduction':
        stats.productionHours += durationHours;
        break;
      case 'MachineOFF':
        // MachineOFF is NOT counted - excluded from total
        logger.debug(`  MachineOFF excluded: ${durationHours.toFixed(4)} hours`);
        break;
      default:
        // Unknown conditions are excluded
        logger.debug(`  Unknown condition "${currentRecord.current_condition}" excluded`);
        break;
    }
  }

  // ===== 2. CALCULATE TOTAL HOURS (Sum of per-condition, excluding MachineOFF) =====
  stats.totalHours = stats.heatingUpHours + stats.iddleHours + stats.productionHours;

  // ===== 3. CALCULATE PER-CONDITION KWH (Segment-based) =====
  // For KWH, we use segment-based calculation because KWH is cumulative
  // Each continuous segment: start.last_kwh → end.current_kwh
  // MachineOFF KWH is NOT counted
  
  stats.heatingUpKwh = calculateKwhForCondition('HeatingUp', conditions);
  stats.iddleKwh = calculateKwhForCondition('Iddle', conditions);
  stats.productionKwh = calculateKwhForCondition('MachineProduction', conditions);
  
  // Total KWH = Sum of per-condition KWH (excluding MachineOFF)
  stats.totalKwh = stats.heatingUpKwh + stats.iddleKwh + stats.productionKwh;

  // Log per-condition results
  logger.info(`Machine ${machineId}: Total ${stats.totalHours.toFixed(2)}h, ${stats.totalKwh.toFixed(2)} kWh`);
  logger.info(`  Per-condition Hours: HeatingUp=${stats.heatingUpHours.toFixed(2)}, Iddle=${stats.iddleHours.toFixed(2)}, Production=${stats.productionHours.toFixed(2)}`);
  logger.info(`  Per-condition KWH: HeatingUp=${stats.heatingUpKwh.toFixed(2)}, Iddle=${stats.iddleKwh.toFixed(2)}, Production=${stats.productionKwh.toFixed(2)}`);

  return stats;
}

/**
 * Calculate KWH for a specific condition using SEGMENT-BASED approach
 * 
 * Identifies continuous segments of the same condition and sums their KWH.
 * For each segment: KWH = end.current_kwh - start.last_kwh
 */
function calculateKwhForCondition(conditionName: string, allConditions: Condition[]): number {
  if (allConditions.length === 0) return 0;
  
  // Sort by timestamp (should already be sorted, but ensure)
  const sortedAll = [...allConditions].sort((a, b) => 
    new Date(a.current_timestamp).getTime() - new Date(b.current_timestamp).getTime()
  );
  
  // Identify continuous segments for this condition
  interface Segment {
    start: Condition;
    end: Condition;
  }
  
  const segments: Segment[] = [];
  let currentSegment: Segment | null = null;
  
  for (const record of sortedAll) {
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
    const dateForDb = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    
    // Format date string for logging
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // ===== CHECK FOR SHARED POWER METER (is_one_block logic) =====
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
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
        id: { not: machineId },
      },
      select: { id: true, name: true },
    });

    // is_one_block = TRUE if only 1 machine runs
    // is_one_block = FALSE if 2 machines run (shared)
    let isOneBlock = true;

    // 3. Check if any other machine has Production condition on same day
    if (machinesWithSamePowerMeter.length > 0) {
      const currentMachineHasProduction = stats.productionHours > 0;

      if (currentMachineHasProduction) {
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
            isOneBlock = false;
            logger.info(`🔗 Shared power meter detected: ${currentMachine.name} & ${otherMachine.name} both in Production on ${dateStr}`);
            break;
          }
        }
      }
    }

    // 4. Split KWH if is_one_block = FALSE
    let finalTotalKwh = stats.totalKwh;
    let finalProductionKwh = stats.productionKwh;
    let finalHeatingUpKwh = stats.heatingUpKwh;
    let finalIddleKwh = stats.iddleKwh;

    if (!isOneBlock) {
      finalTotalKwh = stats.totalKwh / 2;
      finalProductionKwh = stats.productionKwh / 2;
      finalHeatingUpKwh = stats.heatingUpKwh / 2;
      finalIddleKwh = stats.iddleKwh / 2;
      
      logger.info(`  → KWH split by 2 (is_one_block=false)`);
    } else {
      logger.info(`  → KWH full (is_one_block=true)`);
    }

    // ===== SAVE TO DATABASE =====
    const existing = await prisma.mcRunHour.findFirst({
      where: {
        machine_id: machineId,
        date: dateForDb,
      },
    });

    const data = {
      date: dateForDb,
      mc_run_h: stats.totalHours.toFixed(2),
      mc_run_kwh: finalTotalKwh.toFixed(2),
      heat_up_h: stats.heatingUpHours.toFixed(2),
      heat_up_kwh: finalHeatingUpKwh.toFixed(2),
      iddle_h: stats.iddleHours.toFixed(2),
      iddle_kwh: finalIddleKwh.toFixed(2),
      mc_production_h: stats.productionHours.toFixed(2),
      mc_production_kwh: finalProductionKwh.toFixed(2),
      is_one_block: isOneBlock,
      machine_id: machineId,
    };

    if (existing) {
      await prisma.mcRunHour.update({
        where: { id: existing.id },
        data,
      });
      logger.info(`✓ Updated McRunHour for machine ${machineId} on ${dateStr}`);
    } else {
      await prisma.mcRunHour.create({
        data,
      });
      logger.info(`✓ Created McRunHour for machine ${machineId} on ${dateStr}`);
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
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    
    const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    
    logger.info(`Starting daily McRunHour calculation for ${dateStr} (H-1 WIB)`);

    // Get all enabled machines
    const machines = await prisma.machine.findMany({
      where: { enabled: true },
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
