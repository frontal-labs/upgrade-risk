import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    GH_TOKEN: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    GH_REPOSITORY: z.string().optional(),
    GITHUB_REPOSITORY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
