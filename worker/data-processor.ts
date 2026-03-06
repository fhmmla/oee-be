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

/**
 * Check if all required sensor values are present (not null/undefined)
 * Required: on_contact, capstan_speed, 4 temperature sensors, kwh
 */
export function hasAllRequiredValues(reading: MachineReading): boolean {
  return (
    reading.on_contact != null &&
    reading.capstan_speed != null &&
    reading.temperature_inlet_heater != null &&
    reading.temperature_lower_heater != null &&
    reading.temperature_after_catalyst != null &&
    reading.temperature_upper_heater != null &&
    reading.kwh != null
  );
}

// Save to LogHistory table
// Hanya simpan jika SEMUA required values tersedia (tidak null/undefined)
export async function saveLogHistory(readings: SensorReading[]): Promise<void> {
  try {
    const aggregated = aggregateReadings(readings);
    
    // Filter: hanya simpan reading yang semua required values-nya ada
    const completeReadings = aggregated.filter(reading => {
      if (!hasAllRequiredValues(reading)) {
        logger.warn(`⚠️ Skipping LogHistory for machine ${reading.machineId} (${reading.machineName}): missing required sensor values - on_contact=${reading.on_contact}, temps=[${reading.temperature_inlet_heater}, ${reading.temperature_lower_heater}, ${reading.temperature_after_catalyst}, ${reading.temperature_upper_heater}]`);
        return false;
      }
      return true;
    });
    
    const logRecords = completeReadings.map(reading => ({
      on_contact: Math.round(reading.on_contact!),
      temperature_inlet_heater: Math.round(reading.temperature_inlet_heater!),
      temperature_lower_heater: Math.round(reading.temperature_lower_heater!),
      temperature_after_catalyst: Math.round(reading.temperature_after_catalyst!),
      temperature_upper_heater: Math.round(reading.temperature_upper_heater!),
      kwh: reading.kwh!.toString(),
      capstan_speed: reading.capstan_speed != null ? Math.round(reading.capstan_speed) : null,
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
 * Check 5 conditions based on sensor values
 * 
 * Logic (on_contact >= 1 means ON, < 1 means OFF):
 * Priority order:
 * 1. MachineOFF         - on_contact=0, capstan=0, all 4 temps=0
 * 2. HeatingUp           - NOT (all 4 temps >= target for 1 hour)
 * 3. Iddle[SU]           - on_contact=0, capstan < speed_to_production, all 4 temps >= target
 * 4. Iddle[Make Sample]  - on_contact=0, capstan >= speed_to_production, all 4 temps >= target for time_to_make_sample min
 * 5. MachineProduction   - on_contact=1, capstan >= speed_to_production, all 4 temps >= target
 * 
 * Returns null if:
 * - Any required value is null/undefined (skip condition check)
 * - No condition matches (e.g. impossible scenario on_contact=1, capstan < speed_to_production)
 */
export async function checkConditions(reading: MachineReading): Promise<string | null> {
  // Guard: jika ada required value yang null/undefined, skip pengecekan
  if (!hasAllRequiredValues(reading)) {
    logger.warn(`⚠️ Skipping condition check for machine ${reading.machineId} (${reading.machineName}): missing required sensor values - on_contact=${reading.on_contact}, capstan=${reading.capstan_speed}, temps=[${reading.temperature_inlet_heater}, ${reading.temperature_lower_heater}, ${reading.temperature_after_catalyst}, ${reading.temperature_upper_heater}]`);
    return null;
  }

  const onContactValue = reading.on_contact!;
  const isOn = onContactValue >= 1;  // >= 1 means ON
  const capstanSpeed = reading.capstan_speed!;
  const speedToProduction = reading.speed_to_production || 60;

  // Get temperature values (sudah pasti tidak null karena guard di atas)
  const temperatures = {
    inlet_heater: reading.temperature_inlet_heater!,
    lower_heater: reading.temperature_lower_heater!,
    after_catalyst: reading.temperature_after_catalyst!,
    upper_heater: reading.temperature_upper_heater!,
  };

  // Get target temperatures (default to 300 if not set)
  const targetTemps = {
    inlet_heater: reading.target_temp_inlet_heater || 300,
    lower_heater: reading.target_temp_lower_heater || 300,
    after_catalyst: reading.target_temp_after_catalyst || 300,
    upper_heater: reading.target_temp_upper_heater || 300,
  };

  // Check apakah semua 4 temperature = 0 (oven mati total)
  const allTempsZero = 
    temperatures.inlet_heater === 0 &&
    temperatures.lower_heater === 0 &&
    temperatures.after_catalyst === 0 &&
    temperatures.upper_heater === 0;

  // ----- CONDITION 1: MachineOFF -----
  // on_contact=0 AND capstan=0 AND semua 4 temp=0
  if (!isOn && capstanSpeed === 0 && allTempsZero) {
    return 'MachineOFF';
  }

  // ----- CONDITION 2: HeatingUp -----
  // NOT (all 4 temps >= target selama 1 jam)
  const { tempTracker } = require('./temperature-tracker');
  
  const ovenReady = await tempTracker.checkAll(
    reading.machineId,
    temperatures,
    targetTemps
  );

  if (!ovenReady) {
    return 'HeatingUp';
  }

  // === Dari sini oven sudah ready (semua temp >= target selama 1 jam) ===

  // ----- CONDITION 3: Iddle[SU] -----
  // on_contact=0 AND capstan < speed_to_production AND oven ready
  if (!isOn && capstanSpeed < speedToProduction) {
    return 'Iddle[SU]';
  }

  // ----- CONDITION 4: Iddle[Make Sample] -----
  // on_contact=0 AND capstan >= speed_to_production AND
  // all 4 temps >= target selama time_to_make_sample menit
  if (!isOn && capstanSpeed >= speedToProduction) {
    // Get time_to_make_sample per sensor (default 60 menit)
    const timeToMakeSample = {
      inlet_heater: reading.time_to_make_sample_inlet_heater || 60,
      lower_heater: reading.time_to_make_sample_lower_heater || 60,
      after_catalyst: reading.time_to_make_sample_after_catalyst || 60,
      upper_heater: reading.time_to_make_sample_upper_heater || 60,
    };

    const sampleReady = await tempTracker.checkAllWithDuration(
      reading.machineId,
      temperatures,
      targetTemps,
      timeToMakeSample
    );

    if (sampleReady) {
      return 'Iddle[Make Sample]';
    }
    // Belum cukup lama untuk make sample → tidak ada condition yang cocok
    return null;
  }

  // ----- CONDITION 5: MachineProduction -----
  // on_contact=1 AND capstan >= speed_to_production AND oven ready
  if (isOn && capstanSpeed >= speedToProduction) {
    return 'MachineProduction';
  }

  // No condition matched (e.g. on_contact=1 & capstan < speed_to_production → impossible)
  // Jangan log kemanapun
  logger.debug(`No condition matched for machine ${reading.machineId}: on_contact=${onContactValue}, capstan=${capstanSpeed}, speedToProd=${speedToProduction}`);
  return null;
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
    // Skip if any required sensor value is null
    if (conditionChanged && reading && !skipLogHistory && hasAllRequiredValues(reading)) {
      await prisma.logHistory.create({
        data: {
          on_contact: Math.round(reading.on_contact!),
          temperature_inlet_heater: Math.round(reading.temperature_inlet_heater!),
          temperature_lower_heater: Math.round(reading.temperature_lower_heater!),
          temperature_after_catalyst: Math.round(reading.temperature_after_catalyst!),
          temperature_upper_heater: Math.round(reading.temperature_upper_heater!),
          kwh: reading.kwh!.toString(),
          capstan_speed: reading.capstan_speed != null ? Math.round(reading.capstan_speed) : null,
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
      if (condition === null) continue; // Skip jika ada sensor value null
      const kwh = reading.kwh!.toString();
      
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
      if (condition === null) continue; // Skip jika ada sensor value null
      const kwh = reading.kwh!.toString();
      
      await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading);
    }
  } catch (error) {
    logger.error('Error processing readings:', error);
    throw error;
  }
}
