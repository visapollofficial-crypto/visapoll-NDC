import { defineSecret } from "firebase-functions/params";
export const IDENTITY_HMAC_PEPPER = defineSecret("IDENTITY_HMAC_PEPPER");
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const PAYMENT_WEBHOOK_SECRET = defineSecret("PAYMENT_WEBHOOK_SECRET");
