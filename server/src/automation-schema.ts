import { z } from "zod";

export const automationFields = {
  name: z.string().trim().min(1, "Escribe un nombre").max(80, "Máximo 80 caracteres"),
  variable: z.enum(["temperature", "humidity"]),
  direction: z.enum(["gt", "gte", "lt", "lte"]),
  threshold: z.number().finite(),
  recipient: z.email("Escribe un correo válido").max(254),
  enabled: z.boolean().default(true),
};

export const automationSchema = z.strictObject(automationFields).superRefine((rule, ctx) => {
  const [min, max] = rule.variable === "temperature" ? [-20, 80] : [0, 100];
  if (rule.threshold < min || rule.threshold > max) {
    ctx.addIssue({ code: "custom", path: ["threshold"], message: `El umbral debe estar entre ${min} y ${max}` });
  }
});

export const automationPatchFields = { ...automationFields, enabled: z.boolean() };
export const automationPatchSchema = z.strictObject(automationPatchFields).partial().refine(
  (patch) => Object.keys(patch).length > 0,
  "Indica al menos un cambio",
);

export type AutomationInput = z.infer<typeof automationSchema>;
export type AutomationPatch = z.infer<typeof automationPatchSchema>;
export type RunStatus = "queued" | "sending" | "sent" | "failed" | "unknown";

export interface Automation extends AutomationInput {
  id: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  name: string;
  triggeredAt: string;
  variable: AutomationInput["variable"];
  direction: AutomationInput["direction"];
  threshold: number;
  value: number;
  recipient: string;
  status: RunStatus;
  error: string | null;
  sentAt: string | null;
}
