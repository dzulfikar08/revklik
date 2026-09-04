import { env } from "@revklik-new/env/server";
import { drizzle } from "drizzle-orm/d1";

export function createDb() {
  return drizzle(env.DB);
}
