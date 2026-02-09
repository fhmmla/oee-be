// types.ts

export interface ModbusConfig {
  ip: string;
  port: number;
}

export interface MappingParam {
  name: string;      // "kwh", "temperature", "on_contact", "capstan_speed"
  save: boolean;
  length: number;    // Jumlah register (misal 2 untuk Float32)
  address: number;   // Alamat Register Modbus
  formula: number;   // Multiplier (misal 0.1)
  data_type: string; // "float32-be", "int16", etc
}

// Tugas spesifik untuk satu sensor
export interface SensorTask {
  machineId: number;    // ID Mesin (Int)
  machineName: string;
  sensorName: string;   // Nama parameter (key untuk State)
  slaveId: number;      // Unit ID Modbus
  params: MappingParam[];
}

// Grouping per Koneksi Gateway
export interface GatewayGroup {
  id: string; // Unique ID (IP:Port)
  config: ModbusConfig;
  tasks: SensorTask[];
}

// ============ NEW TYPES ============

// Gateway & Mapping from database
export interface Gateway {
  id: number;
  name: string;
  protocol: string;
  config: ModbusConfig;
}

export interface Mapping {
  id: number;
  type: string;
  params: MappingParam[];
}

// Sensor structures from database
export interface Sensor {
  id: number;
  name: string;
  address: number;
  gateway_id: number;
  mapping_id: number;
  gateway: Gateway;
  mapping: Mapping;
}

// Temperature sensor with target_temp
export interface TemperatureSensorData extends Sensor {
  target_temp: number;
}

// Capstan speed sensor with speed_to_production
export interface CapstanSpeedData extends Sensor {
  speed_to_production: number;
}

// Full machine data from database (updated for 4 temperature sensors)
export interface MachineData {
  id: number;
  name: string;
  power_meter_id: number;
  temperature_inlet_heater_id: number;
  temperature_lower_heater_id: number;
  temperature_after_catalyst_id: number;
  temperature_upper_heater_id: number;
  on_contact_sensor_id: number;
  capstan_speed_id: number;
  power_meter: Sensor;
  temperature_inlet_heater: TemperatureSensorData;
  temperature_lower_heater: TemperatureSensorData;
  temperature_after_catalyst: TemperatureSensorData;
  temperature_upper_heater: TemperatureSensorData;
  on_contact_sensor: Sensor;
  capstan_speed: CapstanSpeedData;
}

// Temperature sensor types enum
export type TemperatureSensorType = 
  | 'temperature_inlet_heater'
  | 'temperature_lower_heater'
  | 'temperature_after_catalyst'
  | 'temperature_upper_heater';

// Sensor types enum (updated - removed alarm_contact_sensor)
export type SensorType = 
  | 'power_meter' 
  | 'temperature_inlet_heater'
  | 'temperature_lower_heater'
  | 'temperature_after_catalyst'
  | 'temperature_upper_heater'
  | 'on_contact_sensor' 
  | 'capstan_speed';

// Result from reading a single sensor
export interface SensorReading {
  machineId: number;
  machineName: string;
  sensorType: SensorType;
  timestamp: Date;
  values: {
    kwh?: number;
    temperature?: number;  // For individual temperature sensor reading
    on_contact?: number;
    capstan_speed?: number;
  };
  success: boolean;
  error?: string;
}

// Aggregated reading for a machine (all sensors combined)
export interface MachineReading {
  machineId: number;
  machineName: string;
  timestamp: Date;
  kwh?: number;
  on_contact?: number;
  capstan_speed?: number;
  
  // 4 temperature sensors
  temperature_inlet_heater?: number;
  temperature_lower_heater?: number;
  temperature_after_catalyst?: number;
  temperature_upper_heater?: number;
  
  // Target temperatures for each sensor (from database)
  target_temp_inlet_heater?: number;
  target_temp_lower_heater?: number;
  target_temp_after_catalyst?: number;
  target_temp_upper_heater?: number;
  
  // Speed to production threshold (from database)
  speed_to_production?: number;
  
  condition?: string; // Determined by condition checking logic
}

// Connection pool entry
export interface GatewayConnection {
  key: string; // "IP:PORT"
  config: ModbusConfig;
  client: any; // ModbusRTU from modbus-serial
  connected: boolean;
  lastUsed: Date;
  retryCount: number;
}

// Error types
export class ModbusError extends Error {
  constructor(
    message: string,
    public code: string,
    public gatewayKey?: string,
    public machineId?: number
  ) {
    super(message);
    this.name = 'ModbusError';
  }
}

// Config from database
export interface GeneralConfig {
  key: string;
  c_name: string;
  c_logo: string;
  license_key: string;
  log_freq: number;
}