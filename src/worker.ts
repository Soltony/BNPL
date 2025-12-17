
'use server';
/**
 * @fileOverview Standalone worker process for running background tasks.
 * This script is intended to be executed by a scheduler (e.g., cron) or run as a long-running service.
 *
 * Usage:
 * To run a one-off task (like NPL check):
 * npm run run:worker -- npl
 *
 * To start the continuous repayment service:
 * npm run run:worker -- repayment-service
 */

import { processAutomatedRepayments } from './actions/repayment';
import { updateNplStatus } from './actions/npl';
import { sendDueDateReminders } from './actions/repayment';

const REPAYMENT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runRepaymentServiceLoop() {
    // startup log removed to reduce console noise
    while (true) {
        try {
          // Send due-date reminders for loans due today
            try {
              await sendDueDateReminders();
            } catch (e) {
              console.error(`[${new Date().toISOString()}] Error sending due-date reminders:`, e);
            }
            // cycle start log removed to reduce console noise
            await processAutomatedRepayments();
            // cycle finished log removed to reduce console noise
        } catch (error) {
            console.error(`[${new Date().toISOString()}] An error occurred during the repayment cycle:`, error);
        }
        // waiting log removed to reduce console noise
        await new Promise(resolve => setTimeout(resolve, REPAYMENT_INTERVAL_MS));
    }
}


async function main() {
  const task = process.argv[2];

  if (!task) {
    console.error('Error: No task specified.');
    process.exit(1);
  }

  // start task log removed to reduce console noise

  try {
    switch (task) {
      case 'repayment-service':
        // This is a long-running service, it will not exit on its own.
        await runRepaymentServiceLoop();
        break;
      case 'npl':
        // This is a one-off task.
        await updateNplStatus();
        process.exit(0);
        break;
      default:
        console.error(`Error: Unknown task "${task}".`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error executing task "${task}":`, error);
    process.exit(1);
  }
}

main();
