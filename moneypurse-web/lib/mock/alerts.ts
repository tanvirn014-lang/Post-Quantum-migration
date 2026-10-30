export interface Alert {
  id: string;
  kind: "low_balance" | "upcoming_bill" | "unusual_spending";
  message: string;
  createdAt: string;
}

const MOCK_ALERTS: Alert[] = [
  {
    id: "alert_1",
    kind: "upcoming_bill",
    message: "Your electricity bill of ৳1,450 is due in 3 days",
    createdAt: new Date().toISOString(),
  },
  {
    id: "alert_2",
    kind: "unusual_spending",
    message: "Your dining spend this week is 40% higher than usual",
    createdAt: new Date().toISOString(),
  },
];

/**
 * No fraud/monitoring backend exists yet - these two are fully mocked. The low-balance
 * alert is NOT stored here: it's computed for real against the account's actual balance
 * (see lib/low-balance.ts and components/alerts).
 */
export async function getAlerts(_customerId: string): Promise<Alert[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return MOCK_ALERTS;
}
