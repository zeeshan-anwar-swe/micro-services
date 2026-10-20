import { z } from 'zod';

const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  status: z.enum(['pending', 'in_progress', 'completed']),
  dueDate: z.string().datetime({ offset: true }).transform((value) => new Date(value)).nullable(),
};
export const createBody = z.object({
  ...fields, description: fields.description.default(''), status: fields.status.default('pending'), dueDate: fields.dueDate.optional(),
}).strict();
export const updateBody = z.object(fields).partial().strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
