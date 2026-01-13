// worker/modbus-worker.ts
// Main worker orchestrator dengan infinite loop + node-cron

import cron from 'node-cron';
import { getMachine } from '../data/machine';
import { groupByGateway } from './grouper';
import { saveLogHistory, checkConditions, updateCondition, aggregateReadings } from './data-processor';
import { connectionPool } from '../lib/modbus/connection-pool';
import { readSensorWithRetry } from '../lib/modbus/reader';
import { getLogFrequency } from '../lib/config';
import { logger } from '../lib/logger';
import { validateLicense } from '../lib/license';
import type { SensorReading, MachineData } from '../type';

class ModbusWorker {
  private isRunning = false;
  private logFreq = 15; // Default 15 minutes
  private cronJob: any = null; // node-cron ScheduledTask
  private freqCheckIntervalId: NodeJS.Timeout | null = null; // For checking log_freq changes
  private latestReadings: SensorReading[] = [];

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Worker is already running');
      return;
    }

    try {
      // Fetch log frequency from database
      this.logFreq = await getLogFrequency();
      logger.info(`Worker starting with log frequency: ${this.logFreq} minutes`);
    } catch (error) {
      logger.error('Failed to fetch log frequency, using default 15 minutes');
    }

    // Initialize temperature tracker with machine IDs
    try {
      const machines = await getMachine();
      if (machines && machines.length > 0) {
        const machineIds = machines.map(m => m.id);
        
        const { tempTracker } = require('./temperature-tracker');
        await tempTracker.initialize(machineIds);
        logger.info(`✓ Temperature tracker initialized for ${machineIds.length} machines`);
      }
    } catch (error) {
      logger.error('Failed to initialize temperature tracker:', error);
    }

    this.isRunning = true;
    logger.info('🚀 Modbus Worker started - Infinite loop mode with node-cron');

    // Setup cron job for LogHistory saves
    this.setupCronJob();

    // Setup frequency watcher (checks every 1 minute for log_freq changes)
    this.setupFrequencyWatcher();

    // Infinite loop for continuous sensor reading
    while (this.isRunning) {
      await this.executeCycle();
      
      // Small delay to prevent CPU thrashing (100ms)
      await this.sleep(100);
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    
    logger.info('⏹ Stopping Modbus Worker...');
    this.isRunning = false;
    
    // Stop cron job
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('✓ Cron job stopped');
    }

    // Stop frequency watcher
    if (this.freqCheckIntervalId) {
      clearInterval(this.freqCheckIntervalId);
      this.freqCheckIntervalId = null;
      logger.info('✓ Frequency watcher stopped');
    }
  }

  private setupCronJob(): void {
    // 1. Setup snapshot cron (log_freq interval)
    const cronExpression = `*/${this.logFreq} * * * *`;
    
    logger.info(`📅 Setting up snapshot cron job with expression: "${cronExpression}"`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        logger.info('⏰ Cron triggered - Saving snapshots');
        
        if (this.latestReadings.length > 0) {
          // 1. Save LogHistory snapshot
          await saveLogHistory(this.latestReadings);
          
          // 2. Save Condition snapshot (with forceSnapshot=true)
          const aggregated = aggregateReadings(this.latestReadings);
          for (const reading of aggregated) {
            const condition = await checkConditions(reading);
            const kwh = reading.kwh?.toString() || '0';
            
            // forceSnapshot=true ensures INSERT even if condition unchanged
            // skipLogHistory=true because saveLogHistory() already saved above
            await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading, true, true);
          }
          
          logger.info(`✓ Cron snapshot complete: ${aggregated.length} machines`);
        } else {
          logger.warn('No readings available to save');
        }
      } catch (error) {
        logger.error('Error in cron job:', error);
      }
    });

    logger.info('✓ Snapshot cron job scheduled successfully');

    // 2. Setup daily calculation cron (01:00 WIB every day)
    // Cron expression: "0 1 * * *" = At 01:00 every day
    // Note: Server timezone should be UTC+7 (WIB)
    const dailyCronExpression = '0 1 * * *';
    
    logger.info(`📅 Setting up daily calculation cron job: "${dailyCronExpression}" (01:00 WIB)`);

    const { calculateAllMachinesDailyStats } = require('./daily-calculator');
    
    cron.schedule(dailyCronExpression, async () => {
      try {
        logger.info('🌙 Daily calculation triggered - Calculating yesterday\'s run hours');
        await calculateAllMachinesDailyStats();
        logger.info('✓ Daily calculation complete');
      } catch (error) {
        logger.error('Error in daily calculation cron:', error);
      }
    });

    logger.info('✓ Daily calculation cron job scheduled successfully');
  }

  /**
   * Setup frequency watcher to check for log_freq changes every 1 minute
   * If log_freq changes, recreate the snapshot cron job
   */
  private setupFrequencyWatcher(): void {
    const CHECK_INTERVAL_MS = 60 * 1000; // Check every 1 minute

    logger.info('👁 Setting up frequency watcher (checks every 1 minute)');

    this.freqCheckIntervalId = setInterval(async () => {
      try {
        const newLogFreq = await getLogFrequency();
        
        if (newLogFreq !== this.logFreq) {
          logger.info(`🔄 Log frequency changed: ${this.logFreq} min → ${newLogFreq} min`);
          
          // Stop old cron job
          if (this.cronJob) {
            this.cronJob.stop();
          }
          
          // Update frequency and recreate cron
          this.logFreq = newLogFreq;
          this.recreateSnapshotCron();
          
          logger.info('✓ Cron job recreated with new frequency');
        }
      } catch (error) {
        logger.error('Error checking log frequency:', error);
      }
    }, CHECK_INTERVAL_MS);

    logger.info('✓ Frequency watcher started');
  }

  /**
   * Recreate only the snapshot cron job (not the daily calculation cron)
   */
  private recreateSnapshotCron(): void {
    const cronExpression = `*/${this.logFreq} * * * *`;
    
    logger.info(`📅 Recreating snapshot cron with expression: "${cronExpression}"`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        logger.info('⏰ Cron triggered - Saving snapshots');
        
        if (this.latestReadings.length > 0) {
          // 1. Save LogHistory snapshot
          await saveLogHistory(this.latestReadings);
          
          // 2. Save Condition snapshot (with forceSnapshot=true)
          const aggregated = aggregateReadings(this.latestReadings);
          for (const reading of aggregated) {
            const condition = await checkConditions(reading);
            const kwh = reading.kwh?.toString() || '0';
            
            // forceSnapshot=true ensures INSERT even if condition unchanged
            // skipLogHistory=true because saveLogHistory() already saved above
            await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading, true, true);
          }
          
          logger.info(`✓ Cron snapshot complete: ${aggregated.length} machines`);
        } else {
          logger.warn('No readings available to save');
        }
      } catch (error) {
        logger.error('Error in cron job:', error);
      }
    });
  }

  private async executeCycle(): Promise<void> {
    const cycleStart = Date.now();

    try {
      // 0. License validation before reading
      const licenseValidation = await validateLicense();
      if (!licenseValidation.isValid) {
        logger.warn(`⚠️ License validation failed: ${licenseValidation.message}`);
        await this.sleep(5000); // Wait 5s before retry
        return;
      }

      // 1. Fetch machine configuration from database
      const machines = await getMachine();
      if (!machines || machines.length === 0) {
        logger.warn('No machines found in database');
        await this.sleep(5000); // Wait 5s before retry
        return;
      }

      // 2. Group sensors by gateway
      const gatewayGroups = groupByGateway(machines as unknown as MachineData[]);
      logger.debug(`Reading from ${gatewayGroups.length} gateways, ${machines.length} machines`);

      // 3. Read from all gateways in parallel
      const allReadings = await this.readAllGateways(gatewayGroups);

      if (allReadings.length === 0) {
        return;
      }

      // 4. Store latest readings for cron job
      this.latestReadings = allReadings;

      // 5. Always check conditions and update ONLY if changed
      // This will also save LogHistory when condition changes
      const aggregated = aggregateReadings(allReadings);
      for (const reading of aggregated) {
        const condition = await checkConditions(reading);
        const kwh = reading.kwh?.toString() || '0';
        
        // This will save Condition if changed, and also LogHistory on condition change
        await updateCondition(reading.machineId, condition, kwh, reading.timestamp, reading);
      }

      const cycleTime = Date.now() - cycleStart;
      logger.info(`✓ Cycle completed in ${cycleTime}ms - Read ${allReadings.length} sensors from ${machines.length} machines`);

    } catch (error) {
      logger.error('Error in worker cycle:', error);
      // Continue despite errors
    }
  }

  private async readAllGateways(gatewayGroups: any[]): Promise<SensorReading[]> {
    // Read from all gateways in parallel
    const gatewayPromises = gatewayGroups.map(group => 
      this.readGatewaySequential(group)
    );

    const results = await Promise.allSettled(gatewayPromises);
    
    // Flatten all readings
    const allReadings: SensorReading[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allReadings.push(...result.value);
      } else {
        logger.error('Gateway reading failed:', result.reason);
      }
    }

    return allReadings;
  }

  private async readGatewaySequential(group: any): Promise<SensorReading[]> {
    const readings: SensorReading[] = [];

    try {
      // Get connection from pool
      const client = await connectionPool.getConnection(group.config);

      // Read all sensors from this gateway sequentially
      for (const task of group.tasks) {
        const reading = await readSensorWithRetry(client, {
          machineId: task.machineId,
          machineName: task.machineName,
          sensorType: task.sensorName,
          slaveId: task.slaveId,
          params: task.params,
        });

        readings.push(reading);

        // Small delay between sensors (50ms)
        await this.sleep(50);
      }

      logger.debug(`✓ Read ${readings.length} sensors from gateway ${group.id}`);
      
    } catch (error) {
      logger.error(`Error reading gateway ${group.id}:`, error);
      connectionPool.markDisconnected(group.id);
    }

    return readings;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down worker...');
    this.stop();
    await connectionPool.closeAll();
    logger.info('✓ Worker shutdown complete');
  }
}

// Export singleton instance
export const worker = new ModbusWorker();

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await worker.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await worker.shutdown();
  process.exit(0);
});
