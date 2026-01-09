// lib/config.ts
// Helper untuk fetch configuration dari database

import { prisma } from './prisma';
import type { GeneralConfig } from '../type';

export async function getLogFrequency(): Promise<number> {
  try {
    const config = await prisma.general.findFirst();
    if (!config) {
      throw new Error('General config not found in database');
    }
    return config.log_freq;
  } catch (error) {
    console.error('Error fetching log frequency:', error);
    throw error;
  }
}

export async function getGeneralConfig(): Promise<GeneralConfig | null> {
  try {
    const config = await prisma.general.findFirst();
    return config as GeneralConfig | null;
  } catch (error) {
    console.error('Error fetching general config:', error);
    return null;
  }
}

export async function getConversionFactors(): Promise<{ co2: number; cost: number }> {
  try {
    const conversion = await prisma.conversion.findFirst();
    if (!conversion) {
      throw new Error('Conversion config not found in database');
    }
    return {
      co2: conversion.co2_value,
      cost: conversion.cost_value,
    };
  } catch (error) {
    console.error('Error fetching conversion factors:', error);
    throw error;
  }
}
