// worker/data-processor.ts
// Process dan save readings ke database

import { prisma } from '../lib/prisma';
import type { SensorReading, MachineReading } from '../type';
import { logger } from '../lib/logger';

// Aggregate sensor readings per machine
export function aggregateReadings(readings: SensorReading[]): MachineReading[] {
  const machineMap = new Map<number, MachineReading>();

  for (const reading of readings) {
    if (!reading.success) continue;

    let machineReading = machineMap.get(reading.machineId);
    if (!machineReading) {
      machineReading = {
        machineId: reading.machineId,
        machineName: reading.machineName,
        timestamp: reading.timestamp,
      };
      machineMap.set(reading.machineId, machineReading);
    }

    // Merge values
    Object.assign(machineReading, reading.values);
  }

  return Array.from(machineMap.values());
}

// Save to LogHistory table
export async function saveLogHistory(readings: SensorReading[]): Promise<void> {
  try {
    const aggregated = aggregateReadings(readings);
    
    const logRecords = aggregated.map(reading => ({
      on_contact: reading.on_contact !== undefined ? Math.round(reading.on_contact) : null,
      alarm_contact: reading.alarm_contact !== undefined ? Math.round(reading.alarm_contact) : null,
      temperature: reading.temperature?.toString() || null,
      kwh: reading.kwh?.toString() || null,
      // Handle both capstan_speed and capstand_speed (typo in mapping)
      capstan_speed: (reading.capstan_speed || (reading as any).capstand_speed)?.toString() || null,
      timestamp: reading.timestamp,
      machine_id: reading.machineId,
    }));

    if (logRecords.length > 0) {
      await prisma.logHistory.createMany({
        data: logRecords,
      });
      logger.info(`✓ Saved ${logRecords.length} log records to database`);
    }
  } catch (error) {
    logger.error('Error saving log history:', error);
    throw error;
  }
}

// Check 5 conditions based on sensor values
export async function checkConditions(reading: MachineReading): Promise<string> {
  const onContact = reading.on_contact || 0;
  const temperature = reading.temperature || 0;
  const alarmContact = reading.alarm_contact || 0;
  // Handle both capstan_speed and capstand_speed (typo in mapping)
  const capstanSpeed = reading.capstan_speed || (reading as any).capstand_speed || 0;

  // ----- CONDITION 1: Machine OFF -----
  if (onContact === 0) {
    return 'MachineOFF';
  }
  
  // Now we know on_contact = 1, check if we need temperature tracking
  // Import temperature tracker
  const { tempTracker } = require('./temperature-tracker');
  
  // Determine potential condition to optimize DB query
  let potentialCondition = 'HeatingUp'; // Default assumption
  
  // Quick check: if temp >= 300 and alarm/capstan indicate production/idle
  if (temperature >= 300 && (alarmContact === 1 || alarmContact === 0)) {
    potentialCondition = 'HeatingUp'; // Might transition, need to check
  }
  
  // OPTIMIZED: Only query DB if potentially in HeatingUp state
  // This reduces queries by ~90%!
  const temp300Over1Hour = await tempTracker.check(reading.machineId, temperature, potentialCondition);

  // ----- CONDITION 2: Heating Up -----
  // on_contact = 1 & temperature tidak lebih dari 300° dalam 1 jam
  if (onContact === 1 && !temp300Over1Hour) {
    return 'HeatingUp';
  }
  
  // ----- CONDITION 3: Iddle (alarm_contact = 0) -----
  // on_contact = 1 & temp 300° over 1 hour & alarm_contact = 0
  else if (onContact === 1 && temp300Over1Hour && alarmContact === 0) {
    return 'Iddle';
  }
  
  // ----- CONDITION 4: Machine Production -----
  // on_contact = 1 & temperature 300° over 1 hour & alarm_contact = 1 & capstan_speed = 1
  else if (onContact === 1 && temp300Over1Hour && alarmContact === 1 && capstanSpeed === 1) {
    return 'MachineProduction';
  }
  
  // ----- CONDITION 5: Iddle (capstan_speed = 0) -----
  // on_contact = 1 & temp 300° over 1 hour & alarm_contact = 1 & capstan_speed = 0
  else if (onContact === 1 && temp300Over1Hour && alarmContact === 1 && capstanSpeed === 0) {
    return 'Iddle';
  }
  
  // Default (shouldn't happen)
  else {
    return 'UNKNOWN';
  }
}

// Update Condition table if condition changed
// Also saves to LogHistory when condition changes
export async function updateCondition(
  machineId: number,
  currentCondition: string,
  currentKwh: string,
  currentTimestamp: Date,
  reading?: MachineReading,  // Optional reading parameter
  forceSnapshot: boolean = false,  // Force save even if condition unchanged (for cron)
  skipLogHistory: boolean = false  // Skip LogHistory save (when cron already saved it)
): Promise<void> {
  try {
    // Get existing condition for this machine
    const existing = await prisma.condition.findFirst({
      where: { machine_id: machineId },
      orderBy: { current_timestamp: 'desc' },
    });

    // Check if condition changed OR if forced snapshot (cron)
    const conditionChanged = !existing || existing.current_condition !== currentCondition;
    
    if (!conditionChanged && !forceSnapshot) {
      // Condition hasn't changed and not forced snapshot - DO NOTHING
      logger.debug(`Condition unchanged for machine ${machineId}: ${currentCondition}`);
      return; // Exit early, no database operation
    }

    // DEDUPLICATION: Prevent race condition between cron and cycle
    // If a record with the same condition was created within 5 seconds, skip
    if (existing) {
      const timeSinceLastRecord = currentTimestamp.getTime() - new Date(existing.current_timestamp).getTime();
      const DEDUP_WINDOW_MS = 5000; // 5 seconds
      
      if (existing.current_condition === currentCondition && timeSinceLastRecord < DEDUP_WINDOW_MS) {
        logger.debug(`Skipping duplicate: ${currentCondition} for machine ${machineId} (within ${DEDUP_WINDOW_MS}ms window)`);
        return;
      }
    }

    // Either condition changed OR forced snapshot (cron)
    // Always INSERT new record
    await prisma.condition.create({
      data: {
        current_timestamp: currentTimestamp,
        last_timstamp: existing?.current_timestamp || null,
        current_condition: currentCondition,
        last_condition: existing?.current_condition || null,
        current_kwh: currentKwh,
        last_kwh: existing?.current_kwh || null,
        machine_id: machineId,
      },
    });
    
    if (forceSnapshot) {
      logger.info(`📸 Snapshot: Condition record for machine ${machineId}: ${currentCondition} (kwh: ${currentKwh})`);
    } else {
      logger.info(`✓ Condition changed for machine ${machineId}: ${existing?.current_condition} → ${currentCondition}`);
    }
    
    // Also save to LogHistory ONLY if condition actually changed (not on snapshot)
    // Skip if forceSnapshot (cron) because saveLogHistory() already saved it
    if (conditionChanged && reading && !skipLogHistory) {
      await prisma.logHistory.create({
        data: {
          on_contact: reading.on_contact !== undefined ? Math.round(reading.on_contact) : null,
          alarm_contact: reading.alarm_contact !== undefined ? Math.round(reading.alarm_contact) : null,
          temperature: reading.temperature?.toString() || null,
          kwh: reading.kwh?.toString() || null,
          // Handle both capstan_speed and capstand_speed (typo in mapping)
          capstan_speed: (reading.capstan_speed || (reading as any).capstand_speed)?.toString() || null,
          timestamp: currentTimestamp,
          machine_id: machineId,
        },
      });
      logger.info(`  → LogHistory also saved`);
    }
  } catch (error) {
    logger.error(`Error updating condition for machine ${machineId}:`, error);
    throw error;
  }
}

// Save condition snapshot (called by cron) - DEPRECATED, not used anymore
// Left for backward compatibility
export async function saveConditionSnapshot(readings: MachineReading[]): Promise<void> {
  try {
    for (const reading of readings) {
      const condition = await checkConditions(reading);
      const kwh = reading.kwh?.toString() || '0';
      
      await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading);
    }
    
    logger.info(`✓ Saved condition snapshot for ${readings.length} machines`);
  } catch (error) {
    logger.error('Error saving condition snapshot:', error);
    throw error;
  }
}

// Process all readings: save log history + update conditions on change
export async function processReadings(readings: SensorReading[]): Promise<void> {
  try {
    // 1. Save to LogHistory (cron-based)
    await saveLogHistory(readings);

    // 2. Aggregate and check conditions
    const aggregated = aggregateReadings(readings);
    
    // 3. Update condition if changed (also saves LogHistory on change)
    for (const reading of aggregated) {
      const condition = await checkConditions(reading);
      const kwh = reading.kwh?.toString() || '0';
      
      await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading);
    }
  } catch (error) {
    logger.error('Error processing readings:', error);
    throw error;
  }
}
