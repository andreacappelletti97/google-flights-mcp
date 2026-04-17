// Pure formatting utilities.

// Currencies that use a leading symbol instead of a trailing code.
const SYMBOL_CURRENCIES: Readonly<Record<string, string>> = {
  USD: "$",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  HKD: "HK$",
  SGD: "S$",
  EUR: "\u20AC",
  GBP: "\u00A3",
  JPY: "\u00A5",
  CNY: "\u00A5",
  KRW: "\u20A9",
  INR: "\u20B9",
  BRL: "R$",
  MXN: "MX$",
};

export const formatPrice = (price: number, currency: string | null): string => {
  if (currency === null) return `$${price}`;
  const symbol = SYMBOL_CURRENCIES[currency];
  return symbol !== undefined ? `${symbol}${price}` : `${price} ${currency}`;
};
