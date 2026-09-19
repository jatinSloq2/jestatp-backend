import { Op } from 'sequelize';
import { Strategy, StrategyRuntimeState, StrategyTrade } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { PaginationParams, buildPaginationMeta } from '../../utils/pagination';

async function getOwnedStrategy(userId: string, strategyId: string): Promise<Strategy> {
  const strategy = await Strategy.findOne({ where: { id: strategyId, userId } });
  if (!strategy) throw ApiError.notFound('Strategy not found');
  return strategy;
}

/**
 * Everything the strategy detail page's "Live activity" panel needs in one
 * call: the engine's current runtime snapshot (are we holding a position
 * right now, per liveEngine.ts's persisted state), a page of trade history,
 * and summary stats computed across ALL of this strategy's closed trades
 * (not just the current page — a paginated win-rate would be misleading).
 */
export async function getStrategyActivity(userId: string, strategyId: string, pagination: PaginationParams) {
  const strategy = await getOwnedStrategy(userId, strategyId);

  const [runtimeState, { count, rows: trades }, closedTrades] = await Promise.all([
    StrategyRuntimeState.findOne({ where: { strategyId } }),
    StrategyTrade.findAndCountAll({
      where: { strategyId },
      order: [['entryTimestamp', 'DESC']],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    StrategyTrade.findAll({ where: { strategyId, exitTimestamp: { [Op.ne]: null } } }),
  ]);

  const wins = closedTrades.filter((t) => Number(t.pnl) > 0);
  const losses = closedTrades.filter((t) => Number(t.pnl) <= 0);
  const totalPnl = closedTrades.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0);
  const pnls = closedTrades.map((t) => Number(t.pnl ?? 0));

  return {
    status: strategy.status,
    executionMode: strategy.executionMode,
    broker: strategy.broker,
    runtime: runtimeState
      ? {
          lastProcessedBarTimestamp: runtimeState.lastProcessedBarTimestamp,
          openPosition: runtimeState.openPosition,
          tradesToday: runtimeState.tradesToday,
          lossToday: runtimeState.lossToday,
        }
      : null,
    summary: {
      closedTrades: closedTrades.length,
      openPosition: runtimeState?.openPosition ? 1 : 0,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRatePercent: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      totalPnl,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
    },
    trades: {
      rows: trades,
      meta: buildPaginationMeta(count, pagination.page, pagination.limit),
    },
  };
}
