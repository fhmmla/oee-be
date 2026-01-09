// debug-conditions.ts
// Script untuk debug condition data

import { prisma } from './lib/prisma';
import { logger } from './lib/logger';

async function debugConditions() {
  try {
    logger.info('============================================');
    logger.info('   DEBUG CONDITION DATA                    ');
    logger.info('============================================');

    // Target date: 11 Dec 2025
    const targetDate = new Date(2025, 11, 11); // Dec 11
    
    const startOfDayWIB = new Date(targetDate);
    startOfDayWIB.setHours(0, 0, 0, 0);
    const endOfDayWIB = new Date(targetDate);
    endOfDayWIB.setHours(23, 59, 59, 999);
    
    const startOfDayUTC = new Date(startOfDayWIB.getTime() - (7 * 60 * 60 * 1000));
    const endOfDayUTC = new Date(endOfDayWIB.getTime() - (7 * 60 * 60 * 1000));

    logger.info(`\nQuerying for date: ${targetDate.toISOString().split('T')[0]}`);
    logger.info(`UTC range: ${startOfDayUTC.toISOString()} to ${endOfDayUTC.toISOString()}`);

    // Get all conditions for machine 2
    const conditions = await prisma.condition.findMany({
      where: {
        machine_id: 2,
        current_timestamp: {
          gte: startOfDayUTC,
          lte: endOfDayUTC,
        },
      },
      orderBy: { current_timestamp: 'asc' },
      select: {
        id: true,
        current_condition: true,
        current_timestamp: true,
        current_kwh: true,
        last_kwh: true,
      },
    });

    logger.info(`\n📊 Found ${conditions.length} total records\n`);

    // Group by condition
    const heatingUp = conditions.filter(c => c.current_condition === 'HeatingUp');
    const iddle = conditions.filter(c => c.current_condition === 'Iddle');
    const production = conditions.filter(c => c.current_condition === 'MachineProduction');

    logger.info(`Condition breakdown:`);
    logger.info(`  HeatingUp: ${heatingUp.length} records`);
    logger.info(`  Iddle: ${iddle.length} records`);
    logger.info(`  MachineProduction: ${production.length} records`);

    // Show first/last for each condition
    if (heatingUp.length > 0) {
      logger.info(`\n🔥 HeatingUp:`);
      const firstHU = heatingUp[0];
      const lastHU = heatingUp[heatingUp.length - 1];
      if (firstHU && lastHU) {
        logger.info(`  First: ${firstHU.current_timestamp.toISOString()}, last_kwh: ${firstHU.last_kwh}, current_kwh: ${firstHU.current_kwh}`);
        logger.info(`  Last: ${lastHU.current_timestamp.toISOString()}, current_kwh: ${lastHU.current_kwh}`);
      }
    }

    if (iddle.length > 0) {
      logger.info(`\n⏸️  Iddle:`);
      const firstIddle = iddle[0];
      const lastIddle = iddle[iddle.length - 1];
      if (firstIddle && lastIddle) {
        logger.info(`  First: ${firstIddle.current_timestamp.toISOString()}, last_kwh: ${firstIddle.last_kwh}, current_kwh: ${firstIddle.current_kwh}`);
        logger.info(`  Last: ${lastIddle.current_timestamp.toISOString()}, current_kwh: ${lastIddle.current_kwh}`);
        
        const iddleKwh = (parseFloat(lastIddle.current_kwh) || 0) - (parseFloat(firstIddle.last_kwh ?? '0') || 0);
        logger.info(`  Calculated KWH: ${iddleKwh.toFixed(2)}`);
      }
    }

    if (production.length > 0) {
      logger.info(`\n🏭 MachineProduction:`);
      const firstProd = production[0];
      const lastProd = production[production.length - 1];
      if (firstProd && lastProd) {
        logger.info(`  First: ${firstProd.current_timestamp.toISOString()}, last_kwh: ${firstProd.last_kwh}, current_kwh: ${firstProd.current_kwh}`);
        logger.info(`  Last: ${lastProd.current_timestamp.toISOString()}, current_kwh: ${lastProd.current_kwh}`);
        
        const prodKwh = (parseFloat(lastProd.current_kwh) || 0) - (parseFloat(firstProd.last_kwh ?? '0') || 0);
        logger.info(`  Calculated KWH: ${prodKwh.toFixed(2)}`);
      }
    }

    // Show ALL records
    logger.info(`\n📋 ALL Records (first 10):`);
    conditions.slice(0, 10).forEach((c, i) => {
      logger.info(`  ${i + 1}. ${c.current_timestamp.toISOString()} - ${c.current_condition} - KWH: ${c.current_kwh}`);
    });

    if (conditions.length > 10) {
      logger.info(`  ... and ${conditions.length - 10} more`);
    }

    // Calculate what should be saved
    logger.info(`\n✅ Expected Database Values:`);
    
    if (conditions.length > 0) {
      const firstRecord = conditions[0];
      const lastRecord = conditions[conditions.length - 1];
      
      if (firstRecord && lastRecord) {
        const totalKwh = (parseFloat(lastRecord.current_kwh) || 0) - (parseFloat(firstRecord.last_kwh ?? '0') || 0);
        
        logger.info(`  mc_run_kwh: ${totalKwh.toFixed(2)} (from ALL records)`);
      }
    }
    
    if (iddle.length > 0) {
      const firstIddle = iddle[0];
      const lastIddle = iddle[iddle.length - 1];
      if (firstIddle && lastIddle) {
        const iddleKwh = (parseFloat(lastIddle.current_kwh) || 0) - (parseFloat(firstIddle.last_kwh ?? '0') || 0);
        logger.info(`  iddle_kwh: ${iddleKwh.toFixed(2)} (from Iddle records only)`);
      }
    }
    
    if (production.length > 0) {
      const firstProd = production[0];
      const lastProd = production[production.length - 1];
      if (firstProd && lastProd) {
        const prodKwh = (parseFloat(lastProd.current_kwh) || 0) - (parseFloat(firstProd.last_kwh ?? '0') || 0);
        logger.info(`  mc_production_kwh: ${prodKwh.toFixed(2)} (from Production records only)`);
      }
    }

    logger.info(`\n✅ Debug complete!`);
    process.exit(0);
  } catch (error) {
    logger.error('Error:', error);
    process.exit(1);
  }
}

debugConditions();
