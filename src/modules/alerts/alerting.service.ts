import { Alert, AlertSeverity, AlertType } from '../../models/alert.model';
import { User } from '../../models/user.model';
import { sendMail } from '../../utils/mailer';
import { logger } from '../../utils/logger';

export interface RaiseAlertParams {
  userId: string;
  strategyId?: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records an alert and, for `severity: 'critical'`, emails the user
 * immediately — critical alerts are specifically the cases where the
 * automated engine can no longer guarantee its own state matches reality
 * with real money involved (a live exit order rejected while still holding
 * the position, a live entry that failed outright), so "check the
 * dashboard next time you look" isn't good enough.
 *
 * Never throws — a failure to raise an alert (bad SMTP config, DB hiccup)
 * must not also take down whatever operation triggered it. Errors are
 * logged instead.
 */
export async function raiseAlert(params: RaiseAlertParams): Promise<void> {
  try {
    const alert = await Alert.create({
      userId: params.userId,
      strategyId: params.strategyId ?? null,
      severity: params.severity,
      type: params.type,
      message: params.message,
      metadata: params.metadata ?? null,
    });

    logger.warn(`[ALERT:${params.severity}] ${params.type} (user ${params.userId}): ${params.message}`);

    if (params.severity === 'critical') {
      await emailCriticalAlert(params.userId, alert.id, params.message);
    }
  } catch (err) {
    logger.error(`Failed to raise alert (${params.type}) for user ${params.userId}: ${(err as Error).message}`);
  }
}

async function emailCriticalAlert(userId: string, alertId: string, message: string): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) return;

  await sendMail({
    to: user.email,
    subject: '⚠️ Action needed on your trading strategy',
    text: `${message}\n\nAlert ID: ${alertId}\n\nCheck your strategy's live activity panel for details.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color: #c0392b;">⚠️ Action needed</h2>
        <p>${message}</p>
        <p style="color: #888; font-size: 12px;">Alert ID: ${alertId}</p>
        <p>Check your strategy's live activity panel for details.</p>
      </div>
    `,
  });
}
