import { dokuAdapter } from "../lib/payments/adapters/doku";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const dokuWebhookRoutes = paymentWebhookRoutes(dokuAdapter);
