// worker/temperature-tracker.ts
// Track temperature ≥ 300° for 1 hour per machine using DATABASE (OPTIMIZED)

import { prisma } from '../lib/prisma';

interface CachedRecord {
  machineId: number;
  heatingUpSince: Date | null;
  lastFetch: Date;
}

class TemperatureTracker {
  private cache: Map<number, CachedRecord> = new Map();
  private readonly THRESHOLD = 300;
  private readonly DURATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds

  /**
   * Load initial state from database on startup
   * Call this once when worker starts
   */
  async initialize(machineIds: number[]): Promise<void> {
    for (const machineId of machineIds) {
      await this.fetchFromDatabase(machineId);
    }
  }

  /**
   * Fetch HeatingUp timestamp from database and cache it
   * FIXED: Now finds the FIRST HeatingUp after the last non-HeatingUp condition
   * This ensures the 1-hour calculation starts from when HeatingUp actually began
   */
  private async fetchFromDatabase(machineId: number): Promise<void> {
    try {
      // Step 1: Find the last condition that was NOT HeatingUp
      const lastNonHeatingUp = await prisma.condition.findFirst({
        where: {
          machine_id: machineId,
          current_condition: { not: 'HeatingUp' },
        },
        orderBy: {
          current_timestamp: 'desc',
        },
      });

      // Step 2: Find the FIRST HeatingUp condition after that
      // This gives us when the continuous HeatingUp period started
      const firstHeatingUp = await prisma.condition.findFirst({
        where: {
          machine_id: machineId,
          current_condition: 'HeatingUp',
          current_timestamp: { 
            gt: lastNonHeatingUp?.current_timestamp || new Date(0) 
          },
        },
        orderBy: {
          current_timestamp: 'asc',  // ASC to get the FIRST one
        },
      });

      this.cache.set(machineId, {
        machineId,
        heatingUpSince: firstHeatingUp ? new Date(firstHeatingUp.current_timestamp) : null,
        lastFetch: new Date(),
      });
    } catch (error) {
      console.error(`Error fetching HeatingUp timestamp for machine ${machineId}:`, error);
    }
  }

  /**
   * Check if temperature has been ≥ 300° for at least 1 hour
   * Only queries DB when currentCondition = 'HeatingUp'
   * @param currentCondition - Current condition to optimize queries
   * @returns true if temperature has been ≥ 300° for at least 1 hour
   */
  async check(
    machineId: number,
    temperature: number,
    currentCondition: string
  ): Promise<boolean> {
    // If temperature < 300°, definitely not over 1 hour
    if (temperature < this.THRESHOLD) {
      return false;
    }

    // Only fetch from DB if current condition is HeatingUp
    // This is when we need accurate timestamp
    if (currentCondition === 'HeatingUp') {
      await this.fetchFromDatabase(machineId);
    }

    // Check cache
    const cached = this.cache.get(machineId);
    if (!cached || !cached.heatingUpSince) {
      return false;
    }

    // Calculate duration
    const now = new Date();
    const duration = now.getTime() - cached.heatingUpSince.getTime();

    return duration >= this.DURATION_MS;
  }

  /**
   * Get status for debugging
   */
  async getStatus(machineId: number): Promise<{ above300Since: Date | null; durationMinutes: number } | null> {
    const cached = this.cache.get(machineId);
    
    if (!cached) {
      // Not in cache, fetch from DB
      await this.fetchFromDatabase(machineId);
      return this.getStatus(machineId); // Retry
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
   * Clear cache for a machine (useful when condition changes)
   */
  clearCache(machineId: number): void {
    this.cache.delete(machineId);
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
