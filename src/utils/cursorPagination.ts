import { ApiError } from "../middleware/apiError";

export interface CursorPage {
  cursor?: string;
  limit: number;
}

export interface CursorPageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const queryString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const parseCursorPage = (
  cursorValue: unknown,
  limitValue: unknown,
  defaultLimit = 10,
): CursorPage => {
  const cursor = queryString(cursorValue);
  const rawLimit = queryString(limitValue);
  const limit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError("limit must be an integer between 1 and 100", 400);
  }
  return { ...(cursor ? { cursor } : {}), limit };
};

export const cursorPageArgs = (page: CursorPage) => ({
  take: page.limit + 1,
  ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
});

export const cursorPageResult = <T extends { id: string }>(
  records: T[],
  page: CursorPage,
): { data: T[]; pagination: CursorPageInfo } => {
  const hasMore = records.length > page.limit;
  const data = hasMore ? records.slice(0, page.limit) : records;
  return {
    data,
    pagination: {
      limit: page.limit,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
};
