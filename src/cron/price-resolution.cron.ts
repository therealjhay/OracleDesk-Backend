import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { scheduleJob } from './registry';
import { revealPriceSpec, runPriceResolutionTick } from '../services/price-resolution.service';
import { resolverState } from '../services/chain.service';
import type { ResolutionSpecJson } from '../lib/resolution-spec';

/**
 * Price-mode markets (#90): every five minutes, reveal any price spec the
 * resolver still reports Unconfigured, then try `resolve_price` for markets
 * past close. The retry/escalation policy lives in runPriceResolutionTick.
 */
export function startPriceResolutionCron(): void {
  scheduleJob('price-resolution', async () => {
    const revealed = await revealPendingSpecs();
    const candidates = await prisma.market.findMany({
      where: {
        status: { in: ['ACTIVE', 'RESOLVING'] },
        onChainMarketId: { not: null },
        expiryTimestamp: { lte: new Date() },
        resolutionSpec: { path: ['kind'], equals: 'price' },
      },
      select: { id: true, onChainMarketId: true, expiryTimestamp: true, createdAt: true },
    });
    const { resolved, escalated } = await runPriceResolutionTick({ markets: candidates });
    if (resolved.length || escalated.length) {
      logger.info({ resolved: resolved.map(String), escalated: escalated.map(String) }, 'Price resolution cron: tick complete');
    }
    return {
      outcome: 'SUCCESS',
      counters: {
        revealed,
        candidates: candidates.length,
        resolved: resolved.length,
        escalated: escalated.length,
      },
    };
  });
}

/** Reveals any live price market whose resolver state is still Unconfigured. */
async function revealPendingSpecs(): Promise<number> {
  const markets = await prisma.market.findMany({
    where: {
      status: 'ACTIVE',
      onChainMarketId: { not: null },
      resolutionSpec: { path: ['kind'], equals: 'price' },
    },
    select: { id: true, onChainMarketId: true, resolutionSpec: true },
  });
  let revealed = 0;
  for (const market of markets) {
    if (market.onChainMarketId === null) continue;
    try {
      if ((await resolverState(market.onChainMarketId)).tag !== 'Unconfigured') continue;
      await revealPriceSpec(market.onChainMarketId, market.resolutionSpec as Extract<ResolutionSpecJson, { kind: 'price' }>);
      revealed++;
    } catch (err) {
      logger.warn({ marketId: market.id, err }, 'Price resolution cron: reveal failed; will retry next tick');
    }
  }
  return revealed;
}
