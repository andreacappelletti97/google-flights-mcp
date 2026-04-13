// Pure formatting utilities.

export const formatPrice = (price: number, currency: string | null): string =>
  currency === "USD" || currency === null
    ? `$${price}`
    : `${price} ${currency}`;
