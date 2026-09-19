import { sequelize, Strategy, StrategyVersion, AuditLog } from '../../models';
import { StrategyLanguage } from '../../models/strategy.model';
import { BrokerName } from '../../models/brokerConnection.model';
import { ApiError } from '../../utils/ApiError';
import { PaginationParams, buildPaginationMeta } from '../../utils/pagination';
import { StrategyStatus } from './dsl/constants';
import { StrategyDefinition } from './dsl/types';
import { assertValidPythonStrategy, assertValidStrategyDefinition } from './strategy.validator';

export interface StrategyInput {
  name: string;
  description?: string | null;
  instrument: string;
  exchange: string;
  segment?: 'equity' | 'fno' | 'currency' | 'commodity';
  timeframe: StrategyDefinition['timeframe'];
  broker: BrokerName;
  executionMode?: 'paper' | 'live';
  language?: StrategyLanguage;
  // DSL strategies: both required. Python strategies: pythonCode required instead. See assertLanguagePayload.
  entry?: StrategyDefinition['entry'];
  exit?: StrategyDefinition['exit'];
  pythonCode?: string;
  risk: StrategyDefinition['risk'];
  changeNote?: string | null;
}

function toDefinition(input: Pick<StrategyInput, 'instrument' | 'exchange' | 'timeframe' | 'entry' | 'exit' | 'risk'>): StrategyDefinition {
  return {
    instrument: input.instrument,
    exchange: input.exchange,
    timeframe: input.timeframe,
    entry: input.entry as StrategyDefinition['entry'],
    exit: input.exit as StrategyDefinition['exit'],
    risk: input.risk,
  };
}

/**
 * The one place that decides "does this payload actually match its
 * declared language" and runs the matching validator — Joi already checked
 * shape, this checks the DSL-vs-Python invariant Postgres's
 * chk_strategies_language_payload CHECK also enforces as a final backstop.
 */
async function assertLanguagePayload(input: Pick<StrategyInput, 'language' | 'entry' | 'exit' | 'pythonCode' | 'risk' | 'instrument' | 'exchange' | 'timeframe'>): Promise<void> {
  const language = input.language ?? 'dsl';
  if (language === 'python') {
    if (!input.pythonCode) {
      throw ApiError.badRequest('pythonCode is required for a python-language strategy');
    }
    if (input.entry || input.exit) {
      throw ApiError.badRequest('entry/exit conditions are not used by a python-language strategy — remove them or set language to "dsl"');
    }
    await assertValidPythonStrategy(input.pythonCode, input.risk);
  } else {
    if (!input.entry || !input.exit) {
      throw ApiError.badRequest('entry and exit conditions are required for a dsl-language strategy');
    }
    if (input.pythonCode) {
      throw ApiError.badRequest('pythonCode is not used by a dsl-language strategy — remove it or set language to "python"');
    }
    assertValidStrategyDefinition(toDefinition(input));
  }
}

async function getOwnedStrategy(userId: string, strategyId: string): Promise<Strategy> {
  const strategy = await Strategy.findOne({ where: { id: strategyId, userId } });
  if (!strategy) throw ApiError.notFound('Strategy not found');
  return strategy;
}

/**
 * Creates a new strategy in `draft` status. Runs the full pipeline's
 * "Strategy Validator" stage before anything is persisted (DSL: the
 * condition-block validator; Python: a real compile-and-run smoke test
 * against jestatp-sandbox-service), and snapshots version 1 into
 * strategy_versions in the same transaction as the strategy row itself.
 */
export async function createStrategy(userId: string, input: StrategyInput) {
  const language = input.language ?? 'dsl';
  await assertLanguagePayload(input);

  return sequelize.transaction(async (t) => {
    const strategy = await Strategy.create(
      {
        userId,
        name: input.name,
        description: input.description ?? null,
        instrument: input.instrument,
        exchange: input.exchange,
        segment: input.segment ?? 'equity',
        timeframe: input.timeframe,
        broker: input.broker,
        executionMode: input.executionMode ?? 'paper',
        status: 'draft',
        currentVersion: 1,
        language,
        entryConditions: input.entry ?? null,
        exitConditions: input.exit ?? null,
        pythonCode: input.pythonCode ?? null,
        riskConfig: input.risk,
        lastValidatedAt: new Date(),
      },
      { transaction: t },
    );

    await StrategyVersion.create(
      {
        strategyId: strategy.id,
        version: 1,
        name: strategy.name,
        language,
        entryConditions: input.entry ?? null,
        exitConditions: input.exit ?? null,
        pythonCode: input.pythonCode ?? null,
        riskConfig: input.risk,
        changeNote: input.changeNote ?? 'Initial version',
        createdBy: userId,
      },
      { transaction: t },
    );

    await AuditLog.create(
      { userId, action: 'strategy.created', entityType: 'strategy', entityId: strategy.id },
      { transaction: t },
    );

    return strategy;
  });
}

export async function listStrategies(
  userId: string,
  pagination: PaginationParams,
  filters: { status?: StrategyStatus; segment?: string } = {},
) {
  const { count, rows } = await Strategy.findAndCountAll({
    where: {
      userId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.segment ? { segment: filters.segment } : {}),
    },
    order: [['updatedAt', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return { rows, meta: buildPaginationMeta(count, pagination.page, pagination.limit) };
}

export async function getStrategy(userId: string, strategyId: string) {
  return getOwnedStrategy(userId, strategyId);
}

/**
 * Updates a strategy's definition. Not allowed while `active` — the
 * strategy must be paused first so a live/paper execution loop never reads
 * a half-updated definition mid-flight. Every successful update snapshots
 * the *new* state as the next version (versions are immutable once written).
 */
export async function updateStrategy(userId: string, strategyId: string, input: Partial<StrategyInput>) {
  const strategy = await getOwnedStrategy(userId, strategyId);

  if (strategy.status === 'active') {
    throw ApiError.badRequest('Pause the strategy before editing its definition');
  }

  const language = input.language ?? strategy.language;
  const merged: StrategyInput = {
    name: input.name ?? strategy.name,
    description: input.description !== undefined ? input.description : strategy.description,
    instrument: input.instrument ?? strategy.instrument,
    exchange: input.exchange ?? strategy.exchange,
    segment: input.segment ?? strategy.segment,
    timeframe: input.timeframe ?? strategy.timeframe,
    broker: input.broker ?? strategy.broker,
    executionMode: input.executionMode ?? strategy.executionMode,
    language,
    // When switching language, don't silently carry over the other
    // language's fields — the caller must supply the new language's
    // payload fresh (mirrors what assertLanguagePayload requires anyway).
    entry: language === 'python' ? undefined : (input.entry ?? strategy.entryConditions ?? undefined),
    exit: language === 'python' ? undefined : (input.exit ?? strategy.exitConditions ?? undefined),
    pythonCode: language === 'dsl' ? undefined : (input.pythonCode ?? strategy.pythonCode ?? undefined),
    risk: input.risk ?? strategy.riskConfig,
    changeNote: input.changeNote ?? null,
  };

  await assertLanguagePayload(merged);

  return sequelize.transaction(async (t) => {
    const nextVersion = strategy.currentVersion + 1;

    await strategy.update(
      {
        name: merged.name,
        description: merged.description,
        instrument: merged.instrument,
        exchange: merged.exchange,
        segment: merged.segment,
        timeframe: merged.timeframe,
        broker: merged.broker,
        executionMode: merged.executionMode,
        language,
        entryConditions: merged.entry ?? null,
        exitConditions: merged.exit ?? null,
        pythonCode: merged.pythonCode ?? null,
        riskConfig: merged.risk,
        currentVersion: nextVersion,
        lastValidatedAt: new Date(),
      },
      { transaction: t },
    );

    await StrategyVersion.create(
      {
        strategyId: strategy.id,
        version: nextVersion,
        name: merged.name,
        language,
        entryConditions: merged.entry ?? null,
        exitConditions: merged.exit ?? null,
        pythonCode: merged.pythonCode ?? null,
        riskConfig: merged.risk,
        changeNote: merged.changeNote,
        createdBy: userId,
      },
      { transaction: t },
    );

    await AuditLog.create(
      { userId, action: 'strategy.updated', entityType: 'strategy', entityId: strategy.id, metadata: { version: nextVersion } },
      { transaction: t },
    );

    return strategy;
  });
}

export async function activateStrategy(userId: string, strategyId: string) {
  const strategy = await getOwnedStrategy(userId, strategyId);
  if (strategy.status === 'archived') throw ApiError.badRequest('Cannot activate an archived strategy');

  // Re-run the validator against the live definition before flipping it on —
  // guards against stale/corrupted rows and gives a fresh lastValidatedAt.
  if (strategy.language === 'python') {
    await assertValidPythonStrategy(strategy.pythonCode!, strategy.riskConfig);
  } else {
    assertValidStrategyDefinition(strategy.toStrategyDefinition());
  }

  await sequelize.transaction(async (t) => {
    await strategy.update({ status: 'active', lastValidatedAt: new Date() }, { transaction: t });
    await AuditLog.create({ userId, action: 'strategy.activated', entityType: 'strategy', entityId: strategy.id }, { transaction: t });
  });

  return strategy;
}

export async function pauseStrategy(userId: string, strategyId: string) {
  const strategy = await getOwnedStrategy(userId, strategyId);
  if (strategy.status !== 'active') throw ApiError.badRequest('Only an active strategy can be paused');

  await sequelize.transaction(async (t) => {
    await strategy.update({ status: 'paused' }, { transaction: t });
    await AuditLog.create({ userId, action: 'strategy.paused', entityType: 'strategy', entityId: strategy.id }, { transaction: t });
  });

  return strategy;
}

/** Soft-deletes the strategy (paranoid — recoverable at the DB level, excluded from all normal queries). */
export async function archiveStrategy(userId: string, strategyId: string) {
  const strategy = await getOwnedStrategy(userId, strategyId);
  if (strategy.status === 'active') {
    throw ApiError.badRequest('Pause the strategy before archiving it');
  }

  await sequelize.transaction(async (t) => {
    await strategy.update({ status: 'archived' }, { transaction: t });
    await strategy.destroy({ transaction: t }); // paranoid: sets deleted_at, doesn't hard-delete
    await AuditLog.create({ userId, action: 'strategy.archived', entityType: 'strategy', entityId: strategy.id }, { transaction: t });
  });

  return { archived: true };
}

/** Clones a strategy's current definition into a brand-new draft strategy with its own version-1 history. */
export async function duplicateStrategy(userId: string, strategyId: string) {
  const source = await getOwnedStrategy(userId, strategyId);

  return createStrategy(userId, {
    name: `${source.name} (Copy)`,
    description: source.description,
    instrument: source.instrument,
    exchange: source.exchange,
    segment: source.segment,
    timeframe: source.timeframe,
    broker: source.broker,
    executionMode: 'paper', // duplicates always start in paper mode as a safety default
    language: source.language,
    entry: source.entryConditions ?? undefined,
    exit: source.exitConditions ?? undefined,
    pythonCode: source.pythonCode ?? undefined,
    risk: source.riskConfig,
    changeNote: `Duplicated from "${source.name}" (v${source.currentVersion})`,
  });
}

export async function listVersions(userId: string, strategyId: string) {
  await getOwnedStrategy(userId, strategyId); // ownership check
  return StrategyVersion.findAll({ where: { strategyId }, order: [['version', 'DESC']] });
}

export async function getVersion(userId: string, strategyId: string, version: number) {
  await getOwnedStrategy(userId, strategyId);
  const row = await StrategyVersion.findOne({ where: { strategyId, version } });
  if (!row) throw ApiError.notFound(`Version ${version} not found for this strategy`);
  return row;
}

/** Dry-run validation for the builder UI — same rules as create/update, but nothing is persisted. */
export async function validateDefinitionOnly(
  input: Pick<StrategyInput, 'instrument' | 'exchange' | 'timeframe' | 'entry' | 'exit' | 'risk' | 'language' | 'pythonCode'>,
) {
  try {
    await assertLanguagePayload(input);
    return { valid: true, issues: [] as { path: string; message: string }[] };
  } catch (err) {
    if (err instanceof ApiError && Array.isArray(err.details)) {
      return { valid: false, issues: err.details as { path: string; message: string }[] };
    }
    if (err instanceof ApiError) {
      return { valid: false, issues: [{ path: 'pythonCode', message: err.message }] };
    }
    throw err;
  }
}
