// types.ts

export interface ModbusConfig {
  ip: string;
  port: number;
}

export interface MappingParam {
  name: string;      // "kwh", "temperature", "on_contact", "alarm_contact"
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

// Full machine data from database
export interface MachineData {
  id: number;
  name: string;
  power_meter_id: number;
  temperature_sensor_id: number;
  on_contact_sensor_id: number;
  alarm_contact_sensor_id: number;
  capstan_speed_id: number;
  power_meter: Sensor;
  temperature_sensor: Sensor;
  on_contact_sensor: Sensor;
  alarm_contact_sensor: Sensor;
  capstan_speed: Sensor;
}

// Result from reading a single sensor
export interface SensorReading {
  machineId: number;
  machineName: string;
  sensorType: 'power_meter' | 'temperature_sensor' | 'on_contact_sensor' | 'alarm_contact_sensor' | 'capstan_speed';
  timestamp: Date;
  values: {
    kwh?: number;
    temperature?: number;
    on_contact?: number;
    alarm_contact?: number;
    capstan_speed?: number;
  };
  success: boolean;
  error?: string;
}

// Aggregated reading for a machine (all 4 sensors)
export interface MachineReading {
  machineId: number;
  machineName: string;
  timestamp: Date;
  kwh?: number;
  temperature?: number;
  on_contact?: number;
  alarm_contact?: number;
  capstan_speed?: number;
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