import { z } from 'zod';

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface PaginatedEnvelope<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function paginated<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedEnvelope<T> {
  return { data, page, pageSize, total };
}
