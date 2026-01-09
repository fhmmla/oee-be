// lib/modbus/reader.ts
// Modbus data reader dengan optimized reading

import type ModbusRTU from 'modbus-serial';
import type { MappingParam, SensorReading } from '../../type';
import { parseModbusData } from './data-parser';
import { logger } from '../logger';

export interface ReadSensorOptions {
  machineId: number;
  machineName: string;
  sensorType: 'power_meter' | 'temperature_sensor' | 'on_contact_sensor' | 'alarm_contact_sensor';
  slaveId: number;
  params: MappingParam[];
}

export async function readSensor(
  client: ModbusRTU,
  options: ReadSensorOptions
): Promise<SensorReading> {
  const { machineId, machineName, sensorType, slaveId, params } = options;
  const timestamp = new Date();
  const values: SensorReading['values'] = {};

  try {
    // Set slave ID (unit ID)
    client.setID(slaveId);

    // Read each parameter
    for (const param of params) {
      if (!param.save) continue; // Skip if not marked for saving

      try {
        // Read holding registers
        const result = await client.readHoldingRegisters(param.address, param.length);
        
        // Convert registers to buffer
        const buffer = Buffer.alloc(param.length * 2);
        for (let i = 0; i < param.length; i++) {
          buffer.writeUInt16BE(result.data[i] || 0, i * 2);
        }

        // Parse data based on data_type
        let value = parseModbusData(buffer, param.data_type);
        
        // Apply formula (multiplier)
        value = value * param.formula;

        // Store in values object
        values[param.name as keyof SensorReading['values']] = value;

        logger.debug(`Read ${param.name} from ${machineName}: ${value}`);
      } catch (error) {
        logger.error(`Error reading ${param.name} from ${machineName}:`, error);
        // Continue reading other params even if one fails
      }
    }

    return {
      machineId,
      machineName,
      sensorType,
      timestamp,
      values,
      success: Object.keys(values).length > 0,
    };
  } catch (error) {
    logger.error(`Error reading sensor ${sensorType} from ${machineName}:`, error);
    
    return {
      machineId,
      machineName,
      sensorType,
      timestamp,
      values,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readSensorWithRetry(
  client: ModbusRTU,
  options: ReadSensorOptions,
  maxRetries: number = 3
): Promise<SensorReading> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await readSensor(client, options);
      
      if (result.success) {
        if (attempt > 1) {
          logger.info(`✓ Sensor read succeeded on attempt ${attempt}`);
        }
        return result;
      }
      
      lastError = new Error(result.error || 'Unknown error');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Sensor read attempt ${attempt}/${maxRetries} failed for ${options.machineName}`);
    }

    if (attempt < maxRetries) {
      await sleep(1000 * attempt); // Exponential backoff
    }
  }

  // Return failed reading after all retries
  return {
    machineId: options.machineId,
    machineName: options.machineName,
    sensorType: options.sensorType,
    timestamp: new Date(),
    values: {},
    success: false,
    error: lastError?.message || 'Max retries exceeded',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
