import { runTraceAudit } from '../services/trace-audit.service';
import { logger } from '../lib/logger';
import { scheduleJob } from './registry';

/**
 * Trace Audit Cron.
 * Periodically walks the reasoning-registry on-chain index,
 * verifies IPFS content hashes, detects discrepancies, and relinks missed records.
 */
export function startTraceAuditCron(): void {
  scheduleJob('trace-audit', async () => {
    logger.info('Trace audit cron: starting trace audit cycle');
    const summary = await runTraceAudit();
    logger.info(
      {
        runId: summary.runId,
        totalAudited: summary.totalAudited,
        relinked: summary.relinked,
        counts: summary.counts,
      },
      'Trace audit cron completed',
    );
    return {
      outcome: 'SUCCESS',
      counters: {
        totalAudited: summary.totalAudited,
        relinked: summary.relinked,
      },
    };
  });
}
