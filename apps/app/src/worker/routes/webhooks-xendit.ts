import { xenditAdapter } from "../lib/payments/adapters/xendit";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const xenditWebhookRoutes = paymentWebhookRoutes(xenditAdapter);
