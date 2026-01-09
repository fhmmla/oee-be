// worker/grouper.ts
// Helper untuk group sensors by gateway

import type { MachineData, GatewayGroup, SensorTask, ModbusConfig } from '../type';

export function groupByGateway(machines: MachineData[]): GatewayGroup[] {
  const gatewayMap = new Map<string, GatewayGroup>();

  for (const machine of machines) {
    // Process each sensor type (5 sensors)
    const sensors = [
      { sensor: machine.power_meter, type: 'power_meter' as const },
      { sensor: machine.temperature_sensor, type: 'temperature_sensor' as const },
      { sensor: machine.on_contact_sensor, type: 'on_contact_sensor' as const },
      { sensor: machine.alarm_contact_sensor, type: 'alarm_contact_sensor' as const },
      { sensor: machine.capstan_speed, type: 'capstan_speed' as const },
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
