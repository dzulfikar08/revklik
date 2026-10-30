import { midtransAdapter } from "../lib/payments/adapters/midtrans";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const midtransWebhookRoutes = paymentWebhookRoutes(midtransAdapter);
