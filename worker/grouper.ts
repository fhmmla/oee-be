// worker/grouper.ts
// Helper untuk group sensors by gateway

import type { MachineData, GatewayGroup, SensorTask, ModbusConfig, SensorType } from '../type';

export function groupByGateway(machines: MachineData[]): GatewayGroup[] {
  const gatewayMap = new Map<string, GatewayGroup>();

  for (const machine of machines) {
    // Process each sensor type (7 sensors: power_meter, 4 temperature sensors, on_contact, capstan_speed)
    const sensors: { sensor: any; type: SensorType }[] = [
      { sensor: machine.power_meter, type: 'power_meter' },
      { sensor: machine.temperature_inlet_heater, type: 'temperature_inlet_heater' },
      { sensor: machine.temperature_lower_heater, type: 'temperature_lower_heater' },
      { sensor: machine.temperature_after_catalyst, type: 'temperature_after_catalyst' },
      { sensor: machine.temperature_upper_heater, type: 'temperature_upper_heater' },
      { sensor: machine.on_contact_sensor, type: 'on_contact_sensor' },
      { sensor: machine.capstan_speed, type: 'capstan_speed' },
    ];

    for (const { sensor, type } of sensors) {
      const config: ModbusConfig = sensor.gateway.config as ModbusConfig;
      const gatewayKey = `${config.ip}:${config.port}`;

      // Get or create gateway group
      let group = gatewayMap.get(gatewayKey);
      if (!group) {
        group = {
          id: gatewayKey,
          config,
          tasks: [],
        };
        gatewayMap.set(gatewayKey, group);
      }

      // Create sensor task
      const task: SensorTask = {
        machineId: machine.id,
        machineName: machine.name,
        sensorName: type,
        slaveId: sensor.address, // address is actually the slave/unit ID
        params: sensor.mapping.params,
      };

      group.tasks.push(task);
    }
  }

  return Array.from(gatewayMap.values());
}
