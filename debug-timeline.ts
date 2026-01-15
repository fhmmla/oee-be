// debug-timeline.ts
import { prisma } from './lib/prisma';

async function main() {
  const startOfDay = new Date(2026, 0, 13, 0, 0, 0, 0);
  const endOfDay = new Date(2026, 0, 13, 23, 59, 59, 999);
  
  const conditions = await prisma.condition.findMany({
    where: {
      machine_id: 2,
      current_timestamp: { gte: startOfDay, lte: endOfDay }
    },
    orderBy: { current_timestamp: 'asc' },
    select: { current_timestamp: true, current_condition: true }
  });
  
  console.log('Timeline with condition changes:');
  console.log('─'.repeat(60));
  
  let lastCondition = '';
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i]!;
    if (c.current_condition !== lastCondition) {
      const time = new Date(c.current_timestamp);
      console.log(`${time.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} -> ${c.current_condition}`);
      lastCondition = c.current_condition;
    }
  }
  
  await prisma.$disconnect();
}

main();
