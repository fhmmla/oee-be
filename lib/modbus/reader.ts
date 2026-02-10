// lib/modbus/reader.ts
// Modbus data reader dengan optimized reading

import type ModbusRTU from 'modbus-serial';
import type { MappingParam, SensorReading, SensorType } from '../../type';
import { parseModbusData } from './data-parser';
import { logger } from '../logger';

export interface ReadSensorOptions {
  machineId: number;
  machineName: string;
  sensorType: SensorType;
  slaveId: number;
  params: MappingParam[];
}

/**
 * Map sensor type to the correct value key in SensorReading.values
 * This ensures values are stored correctly regardless of param.name in database
 */
function getValueKeyForSensorType(sensorType: SensorType, paramName: string): keyof SensorReading['values'] | null {
  // Temperature sensors - store as 'temperature'
  if (sensorType.startsWith('temperature_')) {
    return 'temperature';
  }
  
  // Other sensors - map based on sensor type
  switch (sensorType) {
    case 'power_meter':
      // Power meter can have kwh param
      if (paramName.toLowerCase().includes('kwh') || paramName.toLowerCase().includes('energy')) {
        return 'kwh';
      }
      return 'kwh'; // Default for power meter
      
    case 'on_contact_sensor':
      return 'on_contact';
      
    case 'capstan_speed':
      return 'capstan_speed';
      
    default:
      return null;
  }
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
        // Read input registers (FC 04)
        const result = await client.readInputRegisters(param.address, param.length);
        
        // Convert registers to buffer
        const buffer = Buffer.alloc(param.length * 2);
        for (let i = 0; i < param.length; i++) {
          buffer.writeUInt16BE(result.data[i] || 0, i * 2);
        }

        // Parse data based on data_type
        let value = parseModbusData(buffer, param.data_type);
        
        // Apply formula (multiplier)
        value = value * param.formula;

        // Get the correct value key based on sensor type
        const valueKey = getValueKeyForSensorType(sensorType, param.name);
        
        if (valueKey) {
          // For KWH (power_meter), concatenate values from multiple params (high + low)
          // Example: high=164, low=986 -> result=164986 (string concat, not addition)
          if (valueKey === 'kwh') {
            // Convert current value to integer (remove decimals)
            const intValue = Math.floor(value);
            
            if (values[valueKey] === undefined) {
              // First param (high) - just store it
              values[valueKey] = intValue;
              logger.debug(`Read ${sensorType}/${param.name} from ${machineName}: ${intValue} -> stored as '${valueKey}' (high part)`);
            } else {
              // Second param (low) - concatenate with existing value
              // Convert both to strings, concatenate, then back to number
              const highStr = Math.floor(values[valueKey]).toString();
              const lowStr = intValue.toString();
              values[valueKey] = parseFloat(highStr + lowStr);
              logger.debug(`Read ${sensorType}/${param.name} from ${machineName}: ${intValue} -> concatenated to '${valueKey}' (${highStr} + ${lowStr} = ${values[valueKey]})`);
            }
          } else {
            values[valueKey] = value;
            logger.debug(`Read ${sensorType}/${param.name} from ${machineName}: ${value} -> stored as '${valueKey}'`);
          }
        } else {
          // Fallback: store with param name as key
          values[param.name as keyof SensorReading['values']] = value;
          logger.debug(`Read ${param.name} from ${machineName}: ${value} (fallback storage)`);
        }
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
