import { lemonSqueezyAdapter } from "../lib/payments/adapters/lemonsqueezy";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const lemonsqueezyWebhookRoutes = paymentWebhookRoutes(lemonSqueezyAdapter);
