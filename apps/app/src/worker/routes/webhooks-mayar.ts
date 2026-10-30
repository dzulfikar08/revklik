import { mayarAdapter } from "../lib/payments/adapters/mayar";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const mayarWebhookRoutes = paymentWebhookRoutes(mayarAdapter);
