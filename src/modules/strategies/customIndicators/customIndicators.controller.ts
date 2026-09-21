import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middlewares/auth.middleware';
import { parsePagination } from '../../../utils/pagination';
import { BrokerName } from '../../../models/brokerConnection.model';
import { getHistoricalCandles } from '../../brokers/broker.service';
import * as customIndicatorsService from './customIndicators.service';

export const listCustomIndicatorsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const { rows, meta } = await customIndicatorsService.listCustomIndicators(req.user!.id, pagination);
  res.json({ success: true, data: rows, meta });
});

export const getCustomIndicatorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const indicator = await customIndicatorsService.getCustomIndicator(req.user!.id, req.params.id);
  res.json({ success: true, data: indicator });
});

export const createCustomIndicatorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const indicator = await customIndicatorsService.createCustomIndicator(req.user!.id, req.body);
  res.status(201).json({ success: true, data: indicator });
});

export const updateCustomIndicatorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const indicator = await customIndicatorsService.updateCustomIndicator(req.user!.id, req.params.id, req.body);
  res.json({ success: true, data: indicator });
});

export const deleteCustomIndicatorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await customIndicatorsService.deleteCustomIndicator(req.user!.id, req.params.id);
  res.json({ success: true, data: result });
});

/**
 * Authoring-time "Validate" / "Run Indicator Test" action — runs
 * arbitrary, not-yet-saved code (never a saved indicator's id, so an
 * indicator being edited can be tested before Save is clicked). If
 * broker/instrument/exchange/timeframe are given, fetches real historical
 * candles to test against (matching the design doc's "NIFTY, 5m, 01 Sep →
 * 20 Sep" example); otherwise falls back to a small synthetic series.
 */
export const testCustomIndicatorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { code, params, broker, instrument, exchange, segment, timeframe, from, to } = req.body;

  let candles;
  if (broker && instrument && exchange && timeframe) {
    candles = await getHistoricalCandles(req.user!.id, broker as BrokerName, {
      tradingSymbol: instrument,
      exchange,
      segment,
      timeframe,
      from: from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : new Date(),
    });
  }

  const result = await customIndicatorsService.testCustomIndicatorCode(code, params ?? {}, candles);
  res.json({ success: true, data: result });
});
