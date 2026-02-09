// worker/temperature-tracker.ts
// Track temperature >= target_temp for 1 hour per machine per sensor using LogHistory

import { prisma } from '../lib/prisma';
import type { TemperatureSensorType } from '../type';

// Cache key format: "machineId:sensorType" e.g., "1:temperature_inlet_heater"
interface CachedRecord {
  machineId: number;
  sensorType: TemperatureSensorType;
  heatingUpSince: Date | null;
  lastFetch: Date;
}

// Map from LogHistory column name to sensor type
const SENSOR_COLUMN_MAP: Record<TemperatureSensorType, string> = {
  'temperature_inlet_heater': 'temperature_inlet_heater',
  'temperature_lower_heater': 'temperature_lower_heater',
  'temperature_after_catalyst': 'temperature_after_catalyst',
  'temperature_upper_heater': 'temperature_upper_heater',
};

class TemperatureTracker {
  private cache: Map<string, CachedRecord> = new Map();
  private readonly DURATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6 hours lookback (increased for program restarts)

  /**
   * Generate cache key for machine + sensor combination
   */
  private getCacheKey(machineId: number, sensorType: TemperatureSensorType): string {
    return `${machineId}:${sensorType}`;
  }

  /**
   * Load initial state from database on startup
   * Call this once when worker starts
   */
  async initialize(machineIds: number[]): Promise<void> {
    const sensorTypes: TemperatureSensorType[] = [
      'temperature_inlet_heater',
      'temperature_lower_heater',
      'temperature_after_catalyst',
      'temperature_upper_heater',
    ];

    for (const machineId of machineIds) {
      for (const sensorType of sensorTypes) {
        await this.fetchFromDatabase(machineId, sensorType, 300); // Default target 300 for initialization
      }
    }
  }

  /**
   * Fetch temperature history from LogHistory and find when temp >= target started
   * Each sensor has its own target_temp from the database
   */
  private async fetchFromDatabase(
    machineId: number, 
    sensorType: TemperatureSensorType,
    targetTemp: number
  ): Promise<void> {
    try {
      const lookbackTime = new Date(Date.now() - this.LOOKBACK_MS);
      const columnName = SENSOR_COLUMN_MAP[sensorType];

      // Get all logs from the last 90 minutes, ordered by timestamp ASC
      const logs = await prisma.logHistory.findMany({
        where: {
          machine_id: machineId,
          timestamp: { gte: lookbackTime },
        },
        orderBy: {
          timestamp: 'asc',
        },
        select: {
          timestamp: true,
          temperature_inlet_heater: true,
          temperature_lower_heater: true,
          temperature_after_catalyst: true,
          temperature_upper_heater: true,
        },
      });

      // Find the first timestamp where temperature continuously >= target
      let heatingUpSince: Date | null = null;

      for (const log of logs) {
        // Get the temperature value for the specific sensor
        const temp = (log as any)[columnName] ?? 0;

        if (temp >= targetTemp) {
          // Temperature >= target, start tracking if not already
          if (!heatingUpSince) {
            heatingUpSince = new Date(log.timestamp);
          }
          // If already tracking, keep the same start time (continuous)
        } else {
          // Temperature < target, reset the timer
          heatingUpSince = null;
        }
      }

      const cacheKey = this.getCacheKey(machineId, sensorType);
      this.cache.set(cacheKey, {
        machineId,
        sensorType,
        heatingUpSince,
        lastFetch: new Date(),
      });
    } catch (error) {
      console.error(`Error fetching temperature history for machine ${machineId}, sensor ${sensorType}:`, error);
    }
  }

  /**
   * Check if temperature has been >= target_temp for at least 1 hour
   * Uses LogHistory data for accurate tracking
   * FALLBACK: If LogHistory insufficient, check last condition from Condition table
   * @returns true if temperature has been >= target_temp for at least 1 hour
   */
  async check(
    machineId: number,
    sensorType: TemperatureSensorType,
    currentTemperature: number,
    targetTemp: number
  ): Promise<boolean> {
    // If current temperature < target, definitely not over 1 hour
    if (currentTemperature < targetTemp) {
      // Reset cache since temperature dropped below target
      const cacheKey = this.getCacheKey(machineId, sensorType);
      this.cache.set(cacheKey, {
        machineId,
        sensorType,
        heatingUpSince: null,
        lastFetch: new Date(),
      });
      return false;
    }

    // Always fetch fresh data from LogHistory for accuracy
    await this.fetchFromDatabase(machineId, sensorType, targetTemp);

    // Check cache
    const cacheKey = this.getCacheKey(machineId, sensorType);
    const cached = this.cache.get(cacheKey);
    
    // Calculate duration if we have cache data
    if (cached && cached.heatingUpSince) {
      const now = new Date();
      const duration = now.getTime() - cached.heatingUpSince.getTime();
      
      if (duration >= this.DURATION_MS) {
        return true;
      }
    }

    // FALLBACK: If LogHistory data insufficient (gap/restart), check last condition
    // If last condition was MachineProduction or Iddle, it means temp was already >= target for 1 hour
    // So we should NOT reset to HeatingUp just because of data gap
    const fallbackResult = await this.checkLastConditionFallback(machineId);
    if (fallbackResult) {
      console.log(`[TempTracker] Machine ${machineId}, Sensor ${sensorType}: Using fallback - last condition indicates temp was already >= target for 1 hour`);
    }
    
    return fallbackResult;
  }

  /**
   * Check all 4 temperature sensors at once
   * Returns true only if ALL 4 sensors have been >= their respective target_temp for 1 hour
   */
  async checkAll(
    machineId: number,
    temperatures: {
      inlet_heater: number;
      lower_heater: number;
      after_catalyst: number;
      upper_heater: number;
    },
    targetTemps: {
      inlet_heater: number;
      lower_heater: number;
      after_catalyst: number;
      upper_heater: number;
    }
  ): Promise<boolean> {
    // Check each sensor independently
    const results = await Promise.all([
      this.check(machineId, 'temperature_inlet_heater', temperatures.inlet_heater, targetTemps.inlet_heater),
      this.check(machineId, 'temperature_lower_heater', temperatures.lower_heater, targetTemps.lower_heater),
      this.check(machineId, 'temperature_after_catalyst', temperatures.after_catalyst, targetTemps.after_catalyst),
      this.check(machineId, 'temperature_upper_heater', temperatures.upper_heater, targetTemps.upper_heater),
    ]);

    // All 4 sensors must meet the condition (AND logic)
    return results.every(result => result === true);
  }

  /**
   * Fallback: Check last condition from Condition table
   * If last condition was MachineProduction or Iddle, temp was >= target for 1 hour before
   * This handles cases where LogHistory has gaps (restart, downtime, etc.)
   */
  private async checkLastConditionFallback(machineId: number): Promise<boolean> {
    try {
      const lastCondition = await prisma.condition.findFirst({
        where: { machine_id: machineId },
        orderBy: { current_timestamp: 'desc' },
        select: { current_condition: true },
      });

      if (!lastCondition) {
        return false;
      }

      // If last condition was MachineProduction or Iddle, 
      // it means temperature WAS >= target for at least 1 hour before
      // So we maintain that state instead of resetting to HeatingUp
      const conditionsRequiringTempTarget = ['MachineProduction', 'Iddle'];
      return conditionsRequiringTempTarget.includes(lastCondition.current_condition || '');
    } catch (error) {
      console.error(`Error checking last condition fallback for machine ${machineId}:`, error);
      return false;
    }
  }

  /**
   * Get status for debugging - for a specific sensor
   */
  async getStatus(
    machineId: number, 
    sensorType: TemperatureSensorType
  ): Promise<{ above300Since: Date | null; durationMinutes: number } | null> {
    const cacheKey = this.getCacheKey(machineId, sensorType);
    const cached = this.cache.get(cacheKey);
    
    if (!cached) {
      return null;
    }

    if (!cached.heatingUpSince) {
      return null;
    }

    const now = new Date();
    const duration = now.getTime() - cached.heatingUpSince.getTime();
    const durationMinutes = Math.floor(duration / (60 * 1000));

    return {
      above300Since: cached.heatingUpSince,
      durationMinutes,
    };
  }

  /**
   * Get status for all sensors of a machine
   */
  async getAllStatus(machineId: number): Promise<Record<TemperatureSensorType, { above300Since: Date | null; durationMinutes: number } | null>> {
    const sensorTypes: TemperatureSensorType[] = [
      'temperature_inlet_heater',
      'temperature_lower_heater',
      'temperature_after_catalyst',
      'temperature_upper_heater',
    ];

    const result: Record<string, any> = {};
    for (const sensorType of sensorTypes) {
      result[sensorType] = await this.getStatus(machineId, sensorType);
    }
    return result as Record<TemperatureSensorType, { above300Since: Date | null; durationMinutes: number } | null>;
  }

  /**
   * Clear cache for a specific sensor of a machine
   */
  clearCache(machineId: number, sensorType: TemperatureSensorType): void {
    const cacheKey = this.getCacheKey(machineId, sensorType);
    this.cache.delete(cacheKey);
  }

  /**
   * Clear all cache for a machine (all 4 sensors)
   */
  clearMachineCache(machineId: number): void {
    const sensorTypes: TemperatureSensorType[] = [
      'temperature_inlet_heater',
      'temperature_lower_heater',
      'temperature_after_catalyst',
      'temperature_upper_heater',
    ];

    for (const sensorType of sensorTypes) {
      this.clearCache(machineId, sensorType);
    }
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const tempTracker = new TemperatureTracker();
