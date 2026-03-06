import { prisma } from "../lib/prisma";

// Helper function for sensor select structure with target_temp and time_to_make_sample
const temperatureSensorSelect = {
    id: true,
    name: true,
    address: true,
    target_temp: true,  // Include target_temp for temperature sensors
    time_to_make_sample: true,  // Include time_to_make_sample for Iddle[Make Sample] condition
    gateway_id: true,
    mapping_id: true,
    gateway: {
        select: {
            id: true,
            name: true,
            protocol: true,
            config: true,
        }
    },
    mapping: {
        select: {
            id: true,
            type: true,
            params: true,
        }
    }
};

// Helper function for basic sensor select structure
const basicSensorSelect = {
    id: true,
    name: true,
    address: true,
    gateway_id: true,
    mapping_id: true,
    gateway: {
        select: {
            id: true,
            name: true,
            protocol: true,
            config: true,
        }
    },
    mapping: {
        select: {
            id: true,
            type: true,
            params: true,
        }
    }
};

// Capstan speed sensor select with speed_to_production
const capstanSpeedSelect = {
    id: true,
    name: true,
    address: true,
    speed_to_production: true,  // Include speed_to_production
    gateway_id: true,
    mapping_id: true,
    gateway: {
        select: {
            id: true,
            name: true,
            protocol: true,
            config: true,
        }
    },
    mapping: {
        select: {
            id: true,
            type: true,
            params: true,
        }
    }
};

export async function getMachine() {
    try {
        const data = await prisma.machine.findMany({
            where: {
                enabled: true, // Only fetch enabled machines
            },
            select: {
                id: true,
                name: true,
                power_meter_id: true,
                temperature_inlet_heater_id: true,
                temperature_lower_heater_id: true,
                temperature_after_catalyst_id: true,
                temperature_upper_heater_id: true,
                on_contact_sensor_id: true,
                capstan_speed_id: true,
                power_meter: {
                    select: basicSensorSelect
                },
                // 4 Temperature sensors with target_temp
                temperature_inlet_heater: {
                    select: temperatureSensorSelect
                },
                temperature_lower_heater: {
                    select: temperatureSensorSelect
                },
                temperature_after_catalyst: {
                    select: temperatureSensorSelect
                },
                temperature_upper_heater: {
                    select: temperatureSensorSelect
                },
                on_contact_sensor: {
                    select: basicSensorSelect
                },
                // Capstan speed with speed_to_production
                capstan_speed: {
                    select: capstanSpeedSelect
                }
            }
        });
        console.log(JSON.stringify(data));
        return data;
    } catch (error) {
        console.log(error);
    }
}