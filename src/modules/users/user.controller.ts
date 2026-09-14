import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/ApiError';
import { User } from '../../models';

export const getProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await User.findByPk(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: user.toSafeJSON() });
});

export const updateProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await User.findByPk(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');

  const { fullName } = req.body;
  if (fullName) user.fullName = fullName;
  await user.save();

  res.json({ success: true, data: user.toSafeJSON() });
});
