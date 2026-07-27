import { z } from 'zod'
import { SYSTEM_MAX_SATANG, SYSTEM_MIN_SATANG } from './money.js'

/**
 * Layer 1 validation only: shape and absolute system bounds.
 *
 * This schema CANNOT enforce Streamer.minAmount / maxAmount -- it has no idea
 * which streamer the request is for. That is layer 2, after the streamer row is
 * loaded. See DESIGN.md 7.1.1. Skipping layer 2 means T7 (1-baht spam) is not
 * actually prevented.
 */
export const createDonationSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase letters, digits and dashes'),
  donorName: z.string().trim().min(1).max(40),
  // Empty message is fine -- plenty of people donate without saying anything.
  message: z.string().trim().max(200).default(''),
  amount: z
    .number()
    .int('amount must be an integer number of satang')
    .min(SYSTEM_MIN_SATANG)
    .max(SYSTEM_MAX_SATANG),
  /** Honeypot: real users never fill this. Same trick as the portfolio contact form. */
  website: z.string().max(0).optional(),
})

export type CreateDonationInput = z.infer<typeof createDonationSchema>

export const alertSettingSchema = z.object({
  template: z.string().trim().min(1).max(120),
  durationMs: z.number().int().min(2_000).max(20_000),
  soundUrl: z.string().url().max(500).nullable(),
  imageUrl: z.string().url().max(500).nullable(),
  ttsEnabled: z.boolean(),
  minAlertAmount: z.number().int().min(0).max(SYSTEM_MAX_SATANG),
  profanityFilter: z.boolean(),
})

export type AlertSettingInput = z.infer<typeof alertSettingSchema>
