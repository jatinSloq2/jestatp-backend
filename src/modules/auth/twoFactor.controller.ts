import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import * as authService from './auth.service';

export const twoFactorStatusHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const status = await authService.getTwoFactorStatus(req.user!.id);
  res.json({ success: true, data: status });
});

export const totpSetupHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await authService.initiateTotpSetup(req.user!.id);
  res.json({ success: true, data: result });
});

export const totpEnableHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.body;
  const result = await authService.confirmTotpSetup(req.user!.id, code);
  res.json({ success: true, data: result });
});

export const emailTwoFaSetupHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await authService.initiateEmailTwoFactorSetup(req.user!.id);
  res.json({ success: true, data: result });
});

export const emailTwoFaEnableHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.body;
  const result = await authService.confirmEmailTwoFactorSetup(req.user!.id, code);
  res.json({ success: true, data: result });
});

export const disableTwoFaHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { password } = req.body;
  const result = await authService.disableTwoFactor(req.user!.id, password);
  res.json({ success: true, data: result });
});
