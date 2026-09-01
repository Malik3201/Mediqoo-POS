/**
 * Analytics financial calculation library.
 *
 * ONE canonical formula for all dashboard calculations.
 * Portal must match POS semantics exactly.
 *
 * Gross Sales         = sum of finalized sale gross_sales values
 * Sales Returns       = sum of return_amount from sale.returned events
 * Net Sales           = Gross Sales - Sales Returns
 * Sale COGS           = sum of cogs from sale.completed events
 * Returned COGS       = sum of cogs_reversed from sale.returned events
 * Net COGS            = Sale COGS - Returned COGS
 * Gross Profit        = Net Sales - Net COGS
 * Purchases           = sum of purchase_total from purchase.received events
 * Expenses            = sum of non-deleted CloudExpense.amount in period
 * Net Profit          = Gross Profit - Expenses
 */

export interface FinancialSummary {
  gross_sales: number;
  sales_returns: number;
  net_sales: number;
  sale_cogs: number;
  returned_cogs: number;
  net_cogs: number;
  gross_profit: number;
  purchases: number;
  cash_sales: number;
  credit_sales: number;
  expenses: number;
  net_profit: number;
}

/**
 * Aggregation result from MongoDB pipeline (per event type).
 */
export interface EventTypeAgg {
  _id: string; // event type
  gross_sales: number;
  cogs: number;
  return_amount: number;
  cogs_reversed: number;
  purchase_total: number;
  cash_sales: number;
  credit_sales: number;
  count: number;
}

/**
 * Computes the canonical financial summary from aggregated event data
 * and the current expense total.
 *
 * @param aggByType - MongoDB aggregation results grouped by event type
 * @param expenseTotal - sum of current non-deleted CloudExpense amounts in period
 */
export function computeFinancialSummary(
  aggByType: EventTypeAgg[],
  expenseTotal: number
): FinancialSummary {
  const byType = Object.fromEntries(aggByType.map((a) => [a._id, a]));

  const sales = byType["sale.completed"];
  const returns = byType["sale.returned"];
  const purchases = byType["purchase.received"];

  const gross_sales = round2(sales?.gross_sales ?? 0);
  const sales_returns = round2(returns?.return_amount ?? 0);
  const net_sales = round2(gross_sales - sales_returns);

  const sale_cogs = round2(sales?.cogs ?? 0);
  const returned_cogs = round2(returns?.cogs_reversed ?? 0);
  const net_cogs = round2(sale_cogs - returned_cogs);

  const gross_profit = round2(net_sales - net_cogs);

  const purchasesTotal = round2(purchases?.purchase_total ?? 0);

  const cash_sales = round2(sales?.cash_sales ?? 0);
  const credit_sales = round2(sales?.credit_sales ?? 0);

  const expenses = round2(expenseTotal);
  const net_profit = round2(gross_profit - expenses);

  return {
    gross_sales,
    sales_returns,
    net_sales,
    sale_cogs,
    returned_cogs,
    net_cogs,
    gross_profit,
    purchases: purchasesTotal,
    cash_sales,
    credit_sales,
    expenses,
    net_profit,
  };
}

/**
 * Rounds a number to 2 decimal places (currency precision).
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the UTC date range for a given period in a client's IANA timezone.
 *
 * "Today" in Asia/Karachi means:
 *   00:00:00 Asia/Karachi → UTC equivalent
 *   23:59:59.999 Asia/Karachi → UTC equivalent
 *
 * This correctly handles:
 * - Local midnight (transactions around 00:00 local time)
 * - Daylight saving time transitions (IANA handles automatically via Intl)
 * - Clients in different timezones
 *
 * @param timezone - IANA timezone string (e.g., "Asia/Karachi")
 * @param period - "today" | "7d" | "30d" | custom range
 */
export function getClientDateRange(
  timezone: string,
  period: "today" | "7d" | "30d",
  customStart?: Date,
  customEnd?: Date
): { start: Date; end: Date } {
  if (period === "today" || period === "7d" || period === "30d") {
    // Get "now" in client timezone
    const now = new Date();

    // Compute "today" boundaries in the client timezone using Intl
    const todayStart = startOfDayInTz(now, timezone);
    const todayEnd = endOfDayInTz(now, timezone);

    if (period === "today") {
      return { start: todayStart, end: todayEnd };
    }

    const days = period === "7d" ? 7 : 30;
    // Start = beginning of (today - (days-1) days) in client timezone
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - (days - 1));
    const rangeStart = startOfDayInTz(pastDate, timezone);

    return { start: rangeStart, end: todayEnd };
  }

  // Custom range
  return {
    start: customStart ?? new Date(0),
    end: customEnd ?? new Date(),
  };
}

/**
 * Returns the UTC Date representing the start of the day (00:00:00.000)
 * for a given moment in a specific IANA timezone.
 *
 * Uses Intl.DateTimeFormat to extract local year/month/day,
 * then constructs the UTC equivalent without a library dependency.
 */
export function startOfDayInTz(date: Date, timezone: string): Date {
  const parts = getDatePartsInTz(date, timezone);
  // Construct "midnight in that timezone" by parsing an ISO string with tz offset
  // Strategy: format the date in TZ, append T00:00:00, then parse
  return new Date(
    Date.UTC(...utcPartsForLocalMidnight(parts.year, parts.month, parts.day, timezone))
  );
}

/**
 * Returns the UTC Date representing the end of the day (23:59:59.999)
 * for a given moment in a specific IANA timezone.
 */
export function endOfDayInTz(date: Date, timezone: string): Date {
  const parts = getDatePartsInTz(date, timezone);
  const start = new Date(
    Date.UTC(...utcPartsForLocalMidnight(parts.year, parts.month, parts.day, timezone))
  );
  // Add 24 hours - 1 millisecond
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Gets the local year, month (1-12), and day for a UTC date in a given timezone.
 */
function getDatePartsInTz(
  date: Date,
  timezone: string
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Returns [year, month-1, day, 0, 0, 0] UTC equivalent for midnight in timezone.
 * Requires iterating to find the UTC time that corresponds to TZ midnight.
 */
function utcPartsForLocalMidnight(
  year: number,
  month: number, // 1-based
  day: number,
  timezone: string
): [number, number, number, number, number, number] {
  // Build a candidate UTC date for this local date
  // We estimate by parsing the date as if UTC, then adjusting for TZ offset
  const candidate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  // Find the actual UTC time by subtracting the TZ offset at that moment
  // The offset is determined by formatting a test UTC time and comparing
  const offset = getTzOffsetMs(candidate, timezone);

  // Midnight in the TZ = candidate UTC - offset
  const midnight = new Date(candidate.getTime() - offset);

  // Verify it's correct (Intl gives us the same date back)
  const check = getDatePartsInTz(midnight, timezone);
  if (check.year === year && check.month === month && check.day === day) {
    return [
      midnight.getUTCFullYear(),
      midnight.getUTCMonth(),
      midnight.getUTCDate(),
      midnight.getUTCHours(),
      midnight.getUTCMinutes(),
      midnight.getUTCSeconds(),
    ];
  }

  // DST transition: adjust by one hour and retry
  const adjusted = new Date(midnight.getTime() + 60 * 60 * 1000);
  return [
    adjusted.getUTCFullYear(),
    adjusted.getUTCMonth(),
    adjusted.getUTCDate(),
    adjusted.getUTCHours(),
    adjusted.getUTCMinutes(),
    adjusted.getUTCSeconds(),
  ];
}

/**
 * Gets the UTC offset in milliseconds for a given IANA timezone at a specific moment.
 * Positive = east of UTC (e.g., Asia/Karachi = +5h = +18000000ms)
 */
function getTzOffsetMs(date: Date, timezone: string): number {
  // Format the UTC time as local time in the timezone
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });

  const utcMs = new Date(utcStr).getTime();
  const tzMs = new Date(tzStr).getTime();

  return tzMs - utcMs;
}

/**
 * Returns N calendar days in a client timezone as an array of { date, start, end }.
 * Used for trend charts (daily bucketing in local timezone).
 *
 * @param timezone - IANA timezone
 * @param days - number of days (7 or 30)
 */
export function getDailyBuckets(
  timezone: string,
  days: number
): Array<{ date: string; start: Date; end: Date }> {
  const buckets: Array<{ date: string; start: Date; end: Date }> = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const parts = getDatePartsInTz(d, timezone);
    const dateStr = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    buckets.push({
      date: dateStr,
      start: startOfDayInTz(d, timezone),
      end: endOfDayInTz(d, timezone),
    });
  }

  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap cutover helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a UTC Date to a local "YYYY-MM-DD" string in a given timezone.
 * Used to convert UTC event timestamps to local business dates for bucketing.
 */
export function formatLocalDate(date: Date, timezone: string): string {
  const parts = getDatePartsInTz(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Given a UTC [start, end] range and a bootstrap cutoff UTC boundary,
 * returns the portions that should be served from historical data
 * vs live AnalyticsEvent data.
 *
 * Historical = dates <= bootstrap_cutoff_date (in client timezone)
 *   → use HistoricalDailyAnalytics (date string comparison)
 *
 * Live = dates > bootstrap_cutoff_date
 *   → use AnalyticsEvent.occurred_at (UTC timestamp comparison)
 *
 * cutoffUtc = start of (cutoff_date + 1 day) in client timezone.
 * Example: cutoff_date = "2026-08-31", cutoffUtc = 2026-09-01T00:00:00+05:00 as UTC.
 *
 * @param start        - UTC start of query range
 * @param end          - UTC end of query range
 * @param cutoffUtc    - UTC boundary (null if no bootstrap exists)
 * @param timezone     - Client IANA timezone (for date-string conversion)
 */
export function splitDateRange(
  start: Date,
  end: Date,
  cutoffUtc: Date | null,
  timezone: string
): {
  historical: { startDate: string; endDate: string } | null;
  live: { start: Date; end: Date } | null;
} {
  if (!cutoffUtc) {
    // No bootstrap → all data from live AnalyticsEvent
    return { historical: null, live: { start, end } };
  }

  const cutoffMs = cutoffUtc.getTime();
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (endMs <= cutoffMs) {
    // Entire range is before cutoff → all historical
    return {
      historical: {
        startDate: formatLocalDate(start, timezone),
        endDate: formatLocalDate(new Date(endMs), timezone),
      },
      live: null,
    };
  }

  if (startMs >= cutoffMs) {
    // Entire range is after cutoff → all live
    return { historical: null, live: { start, end } };
  }

  // Range spans the cutoff — split into historical + live
  const cutoffMinus1ms = new Date(cutoffMs - 1); // last ms before cutoff = last instant of cutoff_date
  return {
    historical: {
      startDate: formatLocalDate(start, timezone),
      endDate: formatLocalDate(cutoffMinus1ms, timezone),
    },
    live: { start: cutoffUtc, end },
  };
}

/**
 * Merges two FinancialSummary objects (adds all fields).
 * Used to combine historical + live dashboard contributions.
 */
export function mergeFinancialSummaries(
  a: FinancialSummary,
  b: FinancialSummary
): FinancialSummary {
  return {
    gross_sales: round2(a.gross_sales + b.gross_sales),
    sales_returns: round2(a.sales_returns + b.sales_returns),
    net_sales: round2(a.net_sales + b.net_sales),
    sale_cogs: round2(a.sale_cogs + b.sale_cogs),
    returned_cogs: round2(a.returned_cogs + b.returned_cogs),
    net_cogs: round2(a.net_cogs + b.net_cogs),
    gross_profit: round2(a.gross_profit + b.gross_profit),
    purchases: round2(a.purchases + b.purchases),
    cash_sales: round2(a.cash_sales + b.cash_sales),
    credit_sales: round2(a.credit_sales + b.credit_sales),
    expenses: round2(a.expenses + b.expenses),
    net_profit: round2(a.net_profit + b.net_profit),
  };
}

export const ZERO_FINANCIAL_SUMMARY: FinancialSummary = {
  gross_sales: 0,
  sales_returns: 0,
  net_sales: 0,
  sale_cogs: 0,
  returned_cogs: 0,
  net_cogs: 0,
  gross_profit: 0,
  purchases: 0,
  cash_sales: 0,
  credit_sales: 0,
  expenses: 0,
  net_profit: 0,
};

/**
 * Builds a FinancialSummary from HistoricalDailyAnalytics aggregate result.
 * Note: historical data does not distinguish cash_sales vs credit_sales.
 */
export function historicalToFinancialSummary(agg: {
  gross_sales: number;
  sales_returns: number;
  cogs: number;
  cogs_reversed: number;
  gross_profit: number;
  net_profit: number;
  expenses: number;
  purchases: number;
}): FinancialSummary {
  const net_cogs = round2((agg.cogs ?? 0) - (agg.cogs_reversed ?? 0));
  return {
    gross_sales: round2(agg.gross_sales ?? 0),
    sales_returns: round2(agg.sales_returns ?? 0),
    net_sales: round2((agg.gross_sales ?? 0) - (agg.sales_returns ?? 0)),
    sale_cogs: round2(agg.cogs ?? 0),
    returned_cogs: round2(agg.cogs_reversed ?? 0),
    net_cogs,
    gross_profit: round2(agg.gross_profit ?? 0),
    purchases: round2(agg.purchases ?? 0),
    cash_sales: 0,   // not available in historical daily summaries
    credit_sales: 0, // not available in historical daily summaries
    expenses: round2(agg.expenses ?? 0),
    net_profit: round2(agg.net_profit ?? 0),
  };
}



