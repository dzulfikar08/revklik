import { paywuzAdapter } from "../lib/payments/adapters/paywuz";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const paywuzWebhookRoutes = paymentWebhookRoutes(paywuzAdapter);
