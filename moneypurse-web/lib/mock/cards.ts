export interface Card {
  id: string;
  last4: string;
  brand: "visa" | "mastercard";
  frozen: boolean;
  spendLimitMinorUnits: string;
}

const MOCK_CARDS: Card[] = [{ id: "card_1", last4: "4821", brand: "visa", frozen: false, spendLimitMinorUnits: "5000000" }];

/** No card-issuance backend exists yet (a later platform module) - this is fully mocked. */
export async function getCards(_customerId: string): Promise<Card[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return MOCK_CARDS;
}
