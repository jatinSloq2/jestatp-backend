import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/users/user.routes';
import brokerRoutes from '../modules/brokers/broker.routes';
import orderRoutes from '../modules/orders/order.routes';
import positionRoutes from '../modules/positions/position.routes';
import fundRoutes from '../modules/funds/fund.routes';
import strategyRoutes from '../modules/strategies/strategy.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/brokers', brokerRoutes);
router.use('/orders', orderRoutes);
router.use('/positions', positionRoutes);
router.use('/funds', fundRoutes);
router.use('/strategies', strategyRoutes);

export default router;
