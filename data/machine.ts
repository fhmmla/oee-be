import { prisma } from "../lib/prisma";

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
                temperature_sensor_id: true,
                on_contact_sensor_id: true,
                alarm_contact_sensor_id: true,
                capstan_speed_id: true,
                power_meter: {
                    select: {
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

                    }
                },
                temperature_sensor: {
                    select: {
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
                    }
                },
                on_contact_sensor: {
                    select: {
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
                    }
                },
                alarm_contact_sensor: {
                    select: {
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
                    }
                },
                capstan_speed: {
                    select: {
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
                    }
                }
            }
        }
        );
        console.log(JSON.stringify(data));
        return data;
    } catch (error) {
        console.log(error);
    }
}