import { stripeAdapter } from "../lib/payments/adapters/stripe";
import { paymentWebhookRoutes } from "../lib/payments/pipeline";

export const stripeWebhookRoutes = paymentWebhookRoutes(stripeAdapter);
