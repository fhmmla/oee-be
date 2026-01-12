// worker/temperature-tracker.ts
// Track temperature ≥ 300° for 1 hour per machine using LogHistory (OPTION B)

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
  private readonly LOOKBACK_MS = 90 * 60 * 1000; // 90 minutes lookback

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
   * Fetch temperature history from LogHistory and find when temp >= 300 started
   * OPTION B: Uses actual temperature readings, not Condition records
   */
  private async fetchFromDatabase(machineId: number): Promise<void> {
    try {
      const lookbackTime = new Date(Date.now() - this.LOOKBACK_MS);

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
          temperature: true,
        },
      });

      // Find the first timestamp where temperature continuously >= 300
      let heatingUpSince: Date | null = null;

      for (const log of logs) {
        const temp = parseFloat(log.temperature || '0');

        if (temp >= this.THRESHOLD) {
          // Temperature >= 300, start tracking if not already
          if (!heatingUpSince) {
            heatingUpSince = new Date(log.timestamp);
          }
          // If already tracking, keep the same start time (continuous)
        } else {
          // Temperature < 300, reset the timer
          heatingUpSince = null;
        }
      }

      this.cache.set(machineId, {
        machineId,
        heatingUpSince,
        lastFetch: new Date(),
      });
    } catch (error) {
      console.error(`Error fetching temperature history for machine ${machineId}:`, error);
    }
  }

  /**
   * Check if temperature has been ≥ 300° for at least 1 hour
   * Uses LogHistory data for accurate tracking
   * @returns true if temperature has been ≥ 300° for at least 1 hour
   */
  async check(
    machineId: number,
    temperature: number,
    _currentCondition: string // Keep parameter for API compatibility
  ): Promise<boolean> {
    // If current temperature < 300°, definitely not over 1 hour
    if (temperature < this.THRESHOLD) {
      // Reset cache since temperature dropped
      this.cache.set(machineId, {
        machineId,
        heatingUpSince: null,
        lastFetch: new Date(),
      });
      return false;
    }

    // Always fetch fresh data from LogHistory for accuracy
    await this.fetchFromDatabase(machineId);

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
