// worker/data-processor.ts
// Process dan save readings ke database

import { prisma } from '../lib/prisma';
import type { SensorReading, MachineReading, TemperatureSensorType } from '../type';
import { logger } from '../lib/logger';

// Aggregate sensor readings per machine
export function aggregateReadings(readings: SensorReading[]): MachineReading[] {
  const machineMap = new Map<number, MachineReading>();

  for (const reading of readings) {
    if (!reading.success) {
      logger.debug(`Skipping failed reading: ${reading.machineName}/${reading.sensorType}`);
      continue;
    }

    let machineReading = machineMap.get(reading.machineId);
    if (!machineReading) {
      machineReading = {
        machineId: reading.machineId,
        machineName: reading.machineName,
        timestamp: reading.timestamp,
      };
      machineMap.set(reading.machineId, machineReading);
    }

    // Debug: log raw values
    logger.debug(`Aggregating ${reading.sensorType} for ${reading.machineName}: values=${JSON.stringify(reading.values)}`);

    // Merge values based on sensor type
    if (reading.sensorType === 'power_meter') {
      machineReading.kwh = reading.values.kwh;
    } else if (reading.sensorType === 'on_contact_sensor') {
      machineReading.on_contact = reading.values.on_contact;
    } else if (reading.sensorType === 'capstan_speed') {
      machineReading.capstan_speed = reading.values.capstan_speed;
      logger.debug(`  -> capstan_speed = ${machineReading.capstan_speed}`);
    } else if (reading.sensorType === 'temperature_inlet_heater') {
      machineReading.temperature_inlet_heater = reading.values.temperature;
      logger.debug(`  -> temperature_inlet_heater = ${machineReading.temperature_inlet_heater}`);
    } else if (reading.sensorType === 'temperature_lower_heater') {
      machineReading.temperature_lower_heater = reading.values.temperature;
      logger.debug(`  -> temperature_lower_heater = ${machineReading.temperature_lower_heater}`);
    } else if (reading.sensorType === 'temperature_after_catalyst') {
      machineReading.temperature_after_catalyst = reading.values.temperature;
      logger.debug(`  -> temperature_after_catalyst = ${machineReading.temperature_after_catalyst}`);
    } else if (reading.sensorType === 'temperature_upper_heater') {
      machineReading.temperature_upper_heater = reading.values.temperature;
      logger.debug(`  -> temperature_upper_heater = ${machineReading.temperature_upper_heater}`);
    }
  }

  // Debug: log final aggregated readings
  for (const [machineId, reading] of machineMap) {
    logger.debug(`Aggregated Machine ${machineId}: temps=[${reading.temperature_inlet_heater}, ${reading.temperature_lower_heater}, ${reading.temperature_after_catalyst}, ${reading.temperature_upper_heater}], capstan=${reading.capstan_speed}, on_contact=${reading.on_contact}, kwh=${reading.kwh}`);
  }

  return Array.from(machineMap.values());
}

// Save to LogHistory table
export async function saveLogHistory(readings: SensorReading[]): Promise<void> {
  try {
    const aggregated = aggregateReadings(readings);
    
    const logRecords = aggregated.map(reading => ({
      on_contact: reading.on_contact !== undefined ? Math.round(reading.on_contact) : null,
      temperature_inlet_heater: reading.temperature_inlet_heater !== undefined ? Math.round(reading.temperature_inlet_heater) : null,
      temperature_lower_heater: reading.temperature_lower_heater !== undefined ? Math.round(reading.temperature_lower_heater) : null,
      temperature_after_catalyst: reading.temperature_after_catalyst !== undefined ? Math.round(reading.temperature_after_catalyst) : null,
      temperature_upper_heater: reading.temperature_upper_heater !== undefined ? Math.round(reading.temperature_upper_heater) : null,
      kwh: reading.kwh?.toString() || null,
      capstan_speed: reading.capstan_speed !== undefined ? Math.round(reading.capstan_speed) : null,
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

/**
 * Check 4 conditions based on sensor values
 * 
 * New Logic:
 * 1. if on_contact = 0 → MachineOFF
 * 2. if on_contact = 1 AND NOT all 4 temps >= target_temp for 1 hour → HeatingUp
 * 3. if on_contact = 1 AND all 4 temps >= target_temp for 1 hour AND capstan_speed < speed_to_production → Iddle
 * 4. if on_contact = 1 AND all 4 temps >= target_temp for 1 hour AND capstan_speed >= speed_to_production → MachineProduction
 */
export async function checkConditions(reading: MachineReading): Promise<string> {
  const onContact = reading.on_contact || 0;
  const capstanSpeed = reading.capstan_speed || 0;
  const speedToProduction = reading.speed_to_production || 60; // Default 60 if not set

  // Get temperature values (default to 0 if not available)
  const temperatures = {
    inlet_heater: reading.temperature_inlet_heater || 0,
    lower_heater: reading.temperature_lower_heater || 0,
    after_catalyst: reading.temperature_after_catalyst || 0,
    upper_heater: reading.temperature_upper_heater || 0,
  };

  // Get target temperatures (default to 300 if not set)
  const targetTemps = {
    inlet_heater: reading.target_temp_inlet_heater || 300,
    lower_heater: reading.target_temp_lower_heater || 300,
    after_catalyst: reading.target_temp_after_catalyst || 300,
    upper_heater: reading.target_temp_upper_heater || 300,
  };

  // ----- CONDITION 1: Machine OFF -----
  if (onContact === 0) {
    return 'MachineOFF';
  }
  
  // Now we know on_contact = 1, check if all temperatures meet their targets for 1 hour
  const { tempTracker } = require('./temperature-tracker');
  
  // Check if ALL 4 temperature sensors have been >= their target_temp for 1 hour
  const allTempsReachedTarget = await tempTracker.checkAll(
    reading.machineId,
    temperatures,
    targetTemps
  );

  // ----- CONDITION 2: Heating Up -----
  // on_contact = 1 AND NOT all 4 temps >= target_temp for 1 hour
  if (onContact === 1 && !allTempsReachedTarget) {
    return 'HeatingUp';
  }
  
  // At this point: on_contact = 1 AND all temps >= target for 1 hour
  // Now check capstan speed
  
  // ----- CONDITION 3: Iddle -----
  // on_contact = 1 AND all temps reached target AND capstan_speed < speed_to_production
  if (onContact === 1 && allTempsReachedTarget && capstanSpeed < speedToProduction) {
    return 'Iddle';
  }
  
  // ----- CONDITION 4: Machine Production -----
  // on_contact = 1 AND all temps reached target AND capstan_speed >= speed_to_production
  if (onContact === 1 && allTempsReachedTarget && capstanSpeed >= speedToProduction) {
    return 'MachineProduction';
  }
  
  // Default (shouldn't happen)
  return 'UNKNOWN';
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
    // Skip if forceSnapshot (cron) because saveLogHistory() already saved above
    if (conditionChanged && reading && !skipLogHistory) {
      await prisma.logHistory.create({
        data: {
          on_contact: reading.on_contact !== undefined ? Math.round(reading.on_contact) : null,
          temperature_inlet_heater: reading.temperature_inlet_heater !== undefined ? Math.round(reading.temperature_inlet_heater) : null,
          temperature_lower_heater: reading.temperature_lower_heater !== undefined ? Math.round(reading.temperature_lower_heater) : null,
          temperature_after_catalyst: reading.temperature_after_catalyst !== undefined ? Math.round(reading.temperature_after_catalyst) : null,
          temperature_upper_heater: reading.temperature_upper_heater !== undefined ? Math.round(reading.temperature_upper_heater) : null,
          kwh: reading.kwh?.toString() || null,
          capstan_speed: reading.capstan_speed !== undefined ? Math.round(reading.capstan_speed) : null,
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
