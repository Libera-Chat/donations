import path from 'node:path'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(44300),
  LOG_LEVEL: z.string().default('info'),
  DATA_DIRECTORY: z.string().default(path.join(process.cwd(), 'data')),

  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),

  SPIRIS_IDENTITY_BASE_URI: z.string().default('https://identity.vismaonline.com'),
  SPIRIS_API_BASE_URI: z.string().default('https://eaccountingapi.vismaonline.com/'),
  SPIRIS_CLIENT_ID: z.string(),
  SPIRIS_CLIENT_SECRET: z.string(),
  SPIRIS_DEV_REDIRECT_URI: z.string().optional(),
  SPIRIS_LIBERAPAY_PROJECT_NUMBER: z.string().default('1'),
})
const env = envSchema.parse(process.env)

export const {
  PORT,
  LOG_LEVEL,
  DATA_DIRECTORY,

  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,

  SPIRIS_IDENTITY_BASE_URI,
  SPIRIS_API_BASE_URI,
  SPIRIS_CLIENT_ID,
  SPIRIS_CLIENT_SECRET,
  SPIRIS_DEV_REDIRECT_URI,
  SPIRIS_LIBERAPAY_PROJECT_NUMBER,
} = env
