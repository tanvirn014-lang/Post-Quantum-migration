export interface Pot {
  id: string;
  name: string;
  targetMinorUnits: string;
  currentMinorUnits: string;
  currency: string;
}

const MOCK_POTS: Pot[] = [
  { id: "pot_1", name: "Emergency Fund", targetMinorUnits: "10000000", currentMinorUnits: "4200000", currency: "BDT" },
  { id: "pot_2", name: "Vacation", targetMinorUnits: "5000000", currentMinorUnits: "1250000", currency: "BDT" },
  { id: "pot_3", name: "New Laptop", targetMinorUnits: "15000000", currentMinorUnits: "9000000", currency: "BDT" },
];

/** No backend concept exists for savings pots - this is fully mocked, not a real API. */
export async function getSavingsPots(_customerId: string): Promise<Pot[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return MOCK_POTS;
}
