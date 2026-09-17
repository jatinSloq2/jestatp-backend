import { BrokerName } from '../../models/brokerConnection.model';

/** Matches jestatp-feed-service's `Segment` literal exactly. */
export type FeedSegment = 'equity' | 'fno' | 'currency' | 'commodity' | 'index';

/** One instrument to stream live prices for. `token` is the broker-specific *feed* id (see instrumentToken.service.ts). */
export interface FeedInstrument {
  tradingSymbol: string;
  exchange: string;
  segment: FeedSegment;
  token: string;
}

export interface FeedTick {
  tradingSymbol: string;
  exchange: string;
  segment: FeedSegment;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  openInterest?: number;
  timestamp: number;
  raw?: Record<string, unknown>;
}

export interface FeedSessionStatus {
  sessionId: string;
  broker: BrokerName;
  connected: boolean;
  subscribedCount: number;
  subscriberCount: number;
  startedAt: number;
  lastTickAt?: number;
}

export type FeedWsEnvelope =
  | { type: 'tick'; tick: FeedTick }
  | { type: 'status'; status: FeedSessionStatus }
  | { type: 'error'; message: string };
